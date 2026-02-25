// supabase/functions/kiosk-provision-exchange/index.ts
// Public: kiosk exchanges a short-lived token or numeric code for kiosk credentials.
//
// Updated model (fixed kiosk_id + daily secret):
// - kiosk_id is fixed per physical kiosk (persisted client-side after first provisioning).
// - kiosk_secret is a DAILY secret valid only for the current local date in Asia/Manila (00:00–23:59).
// - provisioning token/code is single-use and expires in minutes.
//
// Behavior:
// - If kiosk_id is provided and exists, issues today's daily secret for that kiosk_id.
// - If kiosk_id is not provided (first-time provisioning), creates a new kiosk_id and kiosk_devices row, then issues today's secret.
// - Auto-approves kiosk immediately (keeps existing approval fields for compatibility).

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

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSecret(length = 48): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

// YYYY-MM-DD for Asia/Manila
function getManilaDateString(now = new Date()): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(now);
}

type Body = {
  token?: string;
  code?: string;
  kiosk_id?: string; // optional: existing fixed kiosk_id
  kiosk_name?: string;
};

serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "*";

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json(origin, 405, { ok: false, error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(origin, 500, { ok: false, error: "Server misconfigured" });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(origin, 400, { ok: false, error: "Invalid JSON body" });
  }

  const token = (body.token ?? "").trim();
  const code = (body.code ?? "").trim();
  const kioskName = (body.kiosk_name ?? "").trim() || null;
  const requestedKioskId = (body.kiosk_id ?? "").trim() || null;

  if (!token && !code) {
    return json(origin, 400, { ok: false, error: "token or code is required" });
  }

  const service = createClient<Database>(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // 1) Find valid, unused token row
  const nowIso = new Date().toISOString();
  let tokenRow: any = null;

  if (token) {
    const { data, error } = await service
      .from("kiosk_provision_tokens" as any)
      .select("id, token, code, created_by, expires_at, used_at")
      .eq("token", token)
      .maybeSingle();
    if (error) return json(origin, 500, { ok: false, error: "Failed to validate token" });
    tokenRow = data;
  } else {
    const { data, error } = await service
      .from("kiosk_provision_tokens" as any)
      .select("id, token, code, created_by, expires_at, used_at")
      .eq("code", code)
      .maybeSingle();
    if (error) return json(origin, 500, { ok: false, error: "Failed to validate code" });
    tokenRow = data;
  }

  if (!tokenRow) {
    return json(origin, 400, { ok: false, error: "Invalid provisioning token/code" });
  }

  if (tokenRow.used_at) {
    return json(origin, 400, { ok: false, error: "Provisioning token/code already used" });
  }

  if (String(tokenRow.expires_at) <= nowIso) {
    return json(origin, 400, { ok: false, error: "Provisioning token/code expired" });
  }

  // 2) Resolve kiosk_id (fixed)
  let kioskId = requestedKioskId;
  let kioskDeviceRow: any = null;

  if (kioskId) {
    const { data, error } = await service
      .from("kiosk_devices")
      .select("id, kiosk_id")
      .eq("kiosk_id", kioskId)
      .maybeSingle();
    if (error) return json(origin, 500, { ok: false, error: "Failed to lookup kiosk device" });
    kioskDeviceRow = data;
    if (!kioskDeviceRow) {
      // provided kiosk_id not found
      return json(origin, 400, { ok: false, error: "Unknown kiosk_id" });
    }
  } else {
    kioskId = crypto.randomUUID();

    // Create kiosk device and auto-approve (identity only; daily secret is stored in kiosk_daily_secrets)
    const { data: inserted, error: insErr } = await service
      .from("kiosk_devices")
      .insert({
        kiosk_id: kioskId,
        // legacy columns kept for compatibility; do not rely on these for auth anymore
        secret_sha256: "LEGACY_UNUSED",
        approved: true,
        is_approved: true,
        approved_by: tokenRow.created_by ?? null,
        kiosk_name: kioskName,
      } as any)
      .select("id, kiosk_id, created_at")
      .maybeSingle();

    if (insErr || !inserted) {
      return json(origin, 500, { ok: false, error: "Failed to create kiosk device" });
    }
    kioskDeviceRow = inserted;
  }

  // 3) Issue today's daily secret (00:00–23:59 Asia/Manila)
  const today = getManilaDateString();
  const kioskSecret = randomSecret(48);
  const secretHash = await sha256Hex(kioskSecret);

  // Keep legacy columns in kiosk_devices in sync so older code paths don't break
  // (Auth is enforced via kiosk_daily_secrets + date, but this avoids null/placeholder issues.)
  try {
    const { data: cur } = await service
      .from("kiosk_devices")
      .select("secret_issued_at")
      .eq("kiosk_id", kioskId)
      .maybeSingle();

    await service
      .from("kiosk_devices")
      .update({
        secret_sha256: secretHash,
        kiosk_secret_hash: secretHash,
        prev_secret_issued_at: (cur as any)?.secret_issued_at ?? null,
        secret_issued_at: nowIso,
        kiosk_name: kioskName,
      } as any)
      .eq("kiosk_id", kioskId);
  } catch {
    // ignore
  }

  const { data: dailyInserted, error: dailyErr } = await service
    .from("kiosk_daily_secrets" as any)
    .upsert(
      {
        kiosk_id: kioskId,
        valid_date: today,
        secret_hash: secretHash,
        issued_at: nowIso,
        issued_by: tokenRow.created_by ?? null,
        revoked_at: null,
      } as any,
      { onConflict: "kiosk_id,valid_date" } as any,
    )
    .select("id")
    .maybeSingle();

  if (dailyErr || !dailyInserted) {
    return json(origin, 500, { ok: false, error: "Failed to issue daily kiosk secret" });
  }

  // TS note: Supabase generated types may not include kiosk_daily_secrets in some dev setups.
  // We explicitly cast to access the inserted id without editor errors.
  const dailySecretId = (dailyInserted as any).id as string;

  // 4) Mark token as used
  const ua = req.headers.get("User-Agent") ?? null;
  await service
    .from("kiosk_provision_tokens" as any)
    .update({
      used_at: nowIso,
      used_kiosk_id: kioskId,
      used_user_agent: ua,
    } as any)
    .eq("id", tokenRow.id);

  // 5) Audit log attribution: admin who generated the token
  const adminId = tokenRow.created_by ?? null;
  if (adminId) {
    await service.from("admin_audit_logs").insert({
      admin_id: adminId,
      action: "KIOSK_DAILY_SECRET_ISSUED",
      entity_type: "kiosk_daily_secrets",
      entity_id: dailySecretId,
      details: {
        kiosk_id: kioskId,
        token_id: tokenRow.id,
        code: tokenRow.code,
        valid_date: today,
      },
    } as any);
  }

  return json(origin, 200, {
    ok: true,
    kiosk_id: kioskId,
    kiosk_secret: kioskSecret,
    valid_date: today,
    kiosk_secret_valid_days: 1,
  });
});
