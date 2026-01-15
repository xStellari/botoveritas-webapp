// supabase/functions/send-email-verification-link/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = {
  voter_id?: string;
  email?: string;

  // OPTIONAL: if passed, we can avoid extra DB reads
  fullName?: string;
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requireEnv(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required secret: ${name}`);
  return v;
}

function safeStr(v: unknown, fallback = "") {
  return typeof v === "string" ? v : fallback;
}

function escapeHtml(str: string) {
  return str.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#039;";
      default:
        return m;
    }
  });
}

function base64Url(bytes: Uint8Array) {
  // base64url without padding
  let b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(input: string) {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildVerifyEmailHtml(params: {
  subject: string;
  logoUrl: string;
  fullName: string;
  verifyUrl: string;
  expiresText: string;
}) {
  const { subject, logoUrl, fullName, verifyUrl, expiresText } = params;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>

<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;line-height:1.6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 0;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0"
          style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">

          <tr>
            <td style="background:#064e3b;padding:18px 22px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:56px;vertical-align:middle;">
                    <img src="${escapeHtml(logoUrl)}" width="44" alt="FEU" style="display:block;border-radius:8px;" />
                  </td>

                  <td style="vertical-align:middle;">
                    <div style="color:#ffffff;font-weight:800;font-size:18px;letter-spacing:.3px;">
                      BotoVeritas
                    </div>
                    <div style="color:#d1fae5;font-size:12px;margin-top:2px;">
                      Secure Student Election System • FEU Alabang
                    </div>
                  </td>

                  <td align="right" style="vertical-align:middle;">
                    <div style="
                      display:inline-block;
                      background:rgba(255,255,255,0.12);
                      border:1px solid rgba(255,255,255,0.18);
                      color:#ffffff;
                      padding:6px 10px;
                      border-radius:999px;
                      font-size:11px;
                      font-weight:700;
                      letter-spacing:.2px;
                    ">
                      Email Verification
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:26px 22px;">
              <p style="margin:0 0 14px 0;font-size:14px;color:#0f172a;line-height:1.7;">
                Hello <strong>${escapeHtml(fullName)}</strong>,
              </p>

              <p style="margin:0 0 14px 0;font-size:14px;color:#0f172a;line-height:1.7;">
                Please verify your FEU email address to <strong>activate your voter eligibility</strong> in
                <strong>BotoVeritas</strong>.
              </p>

              <div style="
                margin:18px 0 18px 0;
                padding:14px 14px;
                background:#f0fdf4;
                border:1px solid #bbf7d0;
                border-radius:12px;
                color:#064e3b;
                font-size:13px;
                line-height:1.7;
              ">
                <strong>Important:</strong> Email verification is required <strong>before election day</strong>.
                Unverified registrations will not be able to vote at the kiosk.
              </div>

              <div style="margin:18px 0 22px 0;">
                <a href="${escapeHtml(verifyUrl)}" style="
                  display:inline-block;
                  background:#064e3b;
                  color:#ffffff;
                  text-decoration:none;
                  font-weight:800;
                  padding:12px 16px;
                  border-radius:12px;
                  font-size:14px;
                  letter-spacing:.2px;
                ">
                  Verify Email Address
                </a>
              </div>

              <p style="margin:0 0 14px 0;font-size:12px;color:#64748b;line-height:1.6;">
                This verification link expires ${escapeHtml(expiresText)}.
              </p>

              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.6;">
                If you did not initiate this request, you may safely ignore this email.
              </p>

              <p style="margin:18px 0 0 0;font-size:12px;color:#64748b;line-height:1.6;">
                This is an automated message. Please do not reply.
              </p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:12px;font-size:12px;color:#94a3b8;background:#f8fafc;">
              © ${new Date().getFullYear()} BotoVeritas
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  console.log("send-email-verification-link invoked", req.method);

  try {
    if (req.method !== "POST") {
      return json(405, { ok: false, message: "Method not allowed. Use POST." });
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json(400, { ok: false, message: "Invalid JSON body." });
    }

    if (!body?.voter_id && !body?.email) {
      return json(400, {
        ok: false,
        message: "Provide either voter_id or email.",
      });
    }

    // Secrets
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceRoleKey = requireEnv("SERVICE_ROLE_KEY");
    const resendKey = requireEnv("RESEND_API_KEY");

    const fromEmail =
      Deno.env.get("FROM_EMAIL") || "BotoVeritas <no-reply@botoveritas.info>";

    const appUrl = Deno.env.get("APP_URL") || "https://botoveritas.info";

    const logoUrl =
      Deno.env.get("LOGO_URL") || `${appUrl}/FEU_Alabang_logo.png`;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch voter (retry a bit, like your other function)
    const voterQuery = supabase
      .from("voters")
      .select("id, email, first_name, middle_name, last_name, suffix, email_verified_at");

    const tryFetchVoter = async () => {
      if (body.voter_id) {
        const res = await voterQuery.eq("id", body.voter_id).maybeSingle();
        if (res.error) throw new Error(res.error.message);
        if (res.data) return res.data;
      }
      if (body.email) {
        const res = await voterQuery.eq("email", body.email).maybeSingle();
        if (res.error) throw new Error(res.error.message);
        if (res.data) return res.data;
      }
      return null;
    };

    let voter: any = await tryFetchVoter();
    if (!voter) {
      await sleep(250);
      voter = await tryFetchVoter();
    }
    if (!voter) {
      await sleep(500);
      voter = await tryFetchVoter();
    }

    if (!voter) {
      return json(404, { ok: false, message: "Voter not found." });
    }

    // If already verified, keep behavior simple: return ok (no spam)
    if (voter.email_verified_at) {
      return json(200, {
        ok: true,
        message: "Email already verified.",
        to: voter.email,
      });
    }

    const voterEmail = safeStr(voter.email);
    if (!voterEmail) {
      return json(400, { ok: false, message: "Missing target email address." });
    }

    const fullName =
      safeStr(body.fullName) ||
      [
        voter.first_name,
        voter.middle_name ? `${voter.middle_name}.` : "",
        voter.last_name,
        voter.suffix || "",
      ]
        .filter(Boolean)
        .join(" ") ||
      "Student";

    // Generate token + hash
    const rawBytes = new Uint8Array(32);
    crypto.getRandomValues(rawBytes);
    const token = base64Url(rawBytes);
    const tokenHash = await sha256Hex(token);

    // Expires in 3 days (can adjust via env)
    const expiryHours = Number(Deno.env.get("VERIFY_LINK_EXPIRES_HOURS") || "72");
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);


    const { error: insErr } = await supabase
      .from("email_verification_tokens")
      .insert({
        voter_id: voter.id,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
      });

    if (insErr) throw new Error(insErr.message);

    const verifyUrl = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;

    const subject = "BotoVeritas — Verify Your FEU Email";
    const html = buildVerifyEmailHtml({
      subject,
      logoUrl,
      fullName,
      verifyUrl,
      expiresText: `in ${expiryHours} hours`,
    });

    const minifiedHtml = html
      .replace(/\r?\n/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: voterEmail,
        subject,
        html: minifiedHtml,
      }),
    });

    if (!resendResp.ok) {
      const text = await resendResp.text();
      console.error("Resend error:", text);
      return json(500, { ok: false, message: "Resend failed", details: text });
    }

    console.log("Verification email sent to:", voterEmail);
    return json(200, { ok: true, to: voterEmail });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("send-email-verification-link error:", msg);
    return json(500, { ok: false, message: msg });
  }
});
