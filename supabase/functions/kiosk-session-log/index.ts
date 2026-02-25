// supabase/functions/kiosk-session-log/index.ts
// BotoVeritas — service-only writer for voter_session_logs
//
// Security model:
// - Client/kiosk calls this Edge Function with a shared secret header.
// - Function inserts to voter_session_logs using SERVICE_ROLE.
//
// Required env vars:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-kiosk-secret, x-kiosk-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}


async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type KioskSessionLogBody = {
  voter_id: string;
  action: string;
  kiosk_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
};

function normalizeAction(action: string): string {
  // Allow a conservative charset to reduce log poisoning.
  // Examples allowed: "session_start", "session_end", "force_end", "rfid_scan"
  return action.trim().toLowerCase();
}

function isValidAction(action: string): boolean {
  if (!action) return false;
  if (action.length > 50) return false;
  return /^[a-z0-9_:-]+$/.test(action);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return json(500, { ok: false, error: "Server misconfigured" });
  }


const service = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

const headerKioskId = req.headers.get("x-kiosk-id")?.trim() ?? "";
const headerKioskSecret = req.headers.get("x-kiosk-secret")?.trim() ?? "";

if (!headerKioskId || !headerKioskSecret) {
  return json(401, { ok: false, error: "Unauthorized" });
}

const { data: kiosk, error: kioskError } = await service
  .from("kiosk_devices")
  .select("secret_sha256, is_approved")
  .eq("kiosk_id", headerKioskId)
  .maybeSingle();

if (kioskError || !kiosk?.is_approved) {
  return json(401, { ok: false, error: "Unauthorized" });
}

const providedHash = await sha256Hex(headerKioskSecret);
const expectedHash = String(kiosk.secret_sha256 ?? "").toLowerCase();

if (!expectedHash || providedHash !== expectedHash) {
  return json(401, { ok: false, error: "Unauthorized" });
}

  let body: KioskSessionLogBody;
  try {
    body = (await req.json()) as KioskSessionLogBody;
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const voterId = (body.voter_id ?? "").trim();
  const action = normalizeAction(body.action ?? "");

  if (!voterId || !action) {
    return json(400, { ok: false, error: "voter_id and action are required" });
  }

  if (!isUuid(voterId)) {
    return json(400, { ok: false, error: "voter_id must be a UUID" });
  }

  if (!isValidAction(action)) {
    return json(400, {
      ok: false,
      error: "Invalid action (allowed: a-z0-9_:-, max 50 chars)",
    });
  }

  const kioskId = (body.kiosk_id ?? null)?.toString().trim() || null;
  const ipAddress = (body.ip_address ?? null)?.toString().trim() || null;
  const userAgent = (body.user_agent ?? null)?.toString().trim() || null;

  // Trim oversized fields to protect storage (and avoid index bloat if added later).
  const kioskIdSafe = kioskId && kioskId.length > 80 ? kioskId.slice(0, 80) : kioskId;
  const ipSafe = ipAddress && ipAddress.length > 64 ? ipAddress.slice(0, 64) : ipAddress;
  const uaSafe = userAgent && userAgent.length > 256 ? userAgent.slice(0, 256) : userAgent;

  const { error } = await service.from("voter_session_logs").insert({
    voter_id: voterId,
    action,
    kiosk_id: kioskIdSafe,
    ip_address: ipSafe,
    user_agent: uaSafe,
  });

  if (error) {
    return json(500, { ok: false, error: error.message });
  }

  return json(200, { ok: true });
}

// Supabase Edge Functions entrypoint
Deno.serve((req) => handler(req));
