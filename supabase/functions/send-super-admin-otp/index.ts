// supabase/functions/send-super-admin-otp/index.ts
// Generates a 6-digit OTP, stores a SHA-256 hash in the DB,
// and sends the code to the admin's email via Resend.

import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY")!;

    // Verify caller is an authenticated admin/super_admin
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check user is super_admin
    const { data: roleRow } = await supabaseClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();

    if (!roleRow || !["super_admin", "admin"].includes(roleRow.role)) {
      return new Response(JSON.stringify({ error: "Forbidden: super_admin required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action } = await req.json();
    if (!action) {
      return new Response(JSON.stringify({ error: "action is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const tokenHash = await sha256Hex(`${user.id}:${action}:${otp}`);

    // Expire any previous unused OTPs for this admin+action
    await supabaseClient
      .from("super_admin_otp_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("admin_id", user.id)
      .eq("action", action)
      .is("used_at", null);

    // Store hashed OTP
    const { error: insertError } = await supabaseClient
      .from("super_admin_otp_tokens")
      .insert({
        admin_id: user.id,
        action,
        token_hash: tokenHash,
      });

    if (insertError) {
      return new Response(JSON.stringify({ error: "Failed to store OTP: " + insertError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action labels for email
    const actionLabels: Record<string, string> = {
      enrolled_import: "Import Enrolled Students",
      role_management: "Manage Admin Roles",
      finalize_election: "Finalize Election",
    };
    const actionLabel = actionLabels[action] || action;

    // Send OTP via Resend
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "BotoVeritas <noreply@botoveritas.info>",
        to: [user.email!],
        subject: `BotoVeritas Admin OTP: ${otp}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
            <h2 style="color:#14532d;margin-bottom:8px;">BotoVeritas Admin Verification</h2>
            <p style="color:#374151;">A sensitive admin action requires your confirmation:</p>
            <p style="font-weight:600;color:#14532d;font-size:15px;">${actionLabel}</p>
            <div style="margin:24px 0;text-align:center;">
              <span style="font-size:36px;font-weight:800;letter-spacing:10px;color:#14532d;background:#f0fdf4;padding:16px 28px;border-radius:10px;display:inline-block;">${otp}</span>
            </div>
            <p style="color:#6b7280;font-size:13px;">This code expires in <strong>10 minutes</strong>. If you did not request this, someone may be attempting to access your admin account — contact your system administrator immediately.</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
            <p style="color:#9ca3af;font-size:12px;">BotoVeritas · FEU Alabang Election System</p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      const emailErr = await emailRes.text();
      return new Response(JSON.stringify({ error: "Failed to send email: " + emailErr }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, masked_email: user.email!.replace(/(.{2}).+(@.+)/, "$1***$2") }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
