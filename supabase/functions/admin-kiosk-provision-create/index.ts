// supabase/functions/admin-kiosk-provision-create/index.ts
// Admin-only: generate a short-lived provisioning token + numeric code, and return provisioning token + code.
// Token lifetime: 10 minutes.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Database } from "../_shared/database.types.ts";

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  };
}

function json(origin: string, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function randomToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

function randomCode6(): string {
  // 6-digit numeric code
  const n = Math.floor(Math.random() * 900000) + 100000;
  return String(n);
}

serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "*";

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json(origin, 405, { ok: false, error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error("[admin-kiosk-provision-create] Server misconfigured", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasAnonKey: Boolean(anonKey),
      hasServiceKey: Boolean(serviceKey),
    });
    return json(origin, 500, { ok: false, error: "Server misconfigured" });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(origin, 401, { ok: false, error: "Missing Authorization header" });

  // Authed client (caller JWT)
  const authed = createClient<Database>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) {
    return json(origin, 401, { ok: false, error: "Invalid token" });
  }
  const caller = userData.user;

  // Verify admin role
  const { data: roleRow, error: roleErr } = await authed
    .from("user_roles")
    .select("role")
    .eq("user_id", caller.id)
    .maybeSingle();

  if (roleErr) return json(origin, 500, { ok: false, error: roleErr.message });
  if (!roleRow || !["admin", "super_admin"].includes(roleRow.role)) return json(origin, 403, { ok: false, error: "Not authorized" });

  const service = createClient<Database>(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Generate unique token + code with a few retries on conflict
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  let tokenRow: any = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = randomToken();
    const code = randomCode6();

    const { data, error } = await service
      .from("kiosk_provision_tokens" as any)
      .insert({
        token,
        code,
        created_by: caller.id,
        expires_at: expiresAt,
      } as any)
      .select("id, token, code, expires_at, created_at")
      .maybeSingle();

    if (!error && data) {
      tokenRow = data;
      break;
    }

    // retry on unique conflict; otherwise fail
    const pgCode = (error as any)?.code as string | undefined;
    if (pgCode !== "23505") {
      console.error("[admin-kiosk-provision-create] insert failed", { message: error?.message, code: pgCode });
      return json(origin, 500, { ok: false, error: error?.message ?? "Failed to create token" });
    }
  }

  if (!tokenRow) {
    return json(origin, 500, { ok: false, error: "Failed to create unique provisioning token" });
  }

  const provisionUrl = `${(origin === "*" ? "https://botoveritas.info" : origin).replace(/\/$/, "")}/kiosk/provision?token=${encodeURIComponent(tokenRow.token)}`;


  // Write admin audit log (service_role insert policy exists)
  await service.from("admin_audit_logs").insert({
    admin_id: caller.id,
    action: "KIOSK_PROVISION_TOKEN_CREATED",
    entity_type: "kiosk_provision_tokens",
    entity_id: tokenRow.id,
    details: {
      expires_at: tokenRow.expires_at,
      code: tokenRow.code,
      provision_url: provisionUrl,
      admin_email: caller.email ?? null,
    },
  } as any);

  return json(origin, 200, {
    ok: true,
    token_id: tokenRow.id,
    token: tokenRow.token,
    code: tokenRow.code,
    expires_at: tokenRow.expires_at,
    provision_url: provisionUrl,
  });
});
