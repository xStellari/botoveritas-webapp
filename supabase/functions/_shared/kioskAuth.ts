// supabase/functions/_shared/kioskAuth.ts
// Shared kiosk authorization helper for Option 3 (Edge Functions + service role).
//
// Model:
// - Kiosk must send headers:
//   - x-kiosk-id
//   - x-kiosk-secret
// - Server validates against public.kiosk_devices (approved=true and secret hash match).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const kioskCorsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-kiosk-id, x-kiosk-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...kioskCorsHeaders,
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

export async function requireKioskAuth(
  req: Request,
  service: SupabaseClient,
): Promise<{ kiosk_id: string } | Response> {
  const kioskId = (req.headers.get("x-kiosk-id") ?? "").trim();
  const kioskSecret = (req.headers.get("x-kiosk-secret") ?? "").trim();

  if (!kioskId || !kioskSecret) {
    return json(401, { ok: false, error: "Missing kiosk credentials" });
  }

  const secretHash = await sha256Hex(kioskSecret);

  const { data, error } = await service
    .from("kiosk_devices")
    .select("kiosk_id, secret_sha256, approved")
    .eq("kiosk_id", kioskId)
    .maybeSingle();

  if (error) {
    return json(500, { ok: false, error: "Failed to validate kiosk" });
  }

  if (!data || !data.approved) {
    return json(403, { ok: false, error: "Kiosk not approved" });
  }

  if ((data as any).secret_sha256 !== secretHash) {
    return json(403, { ok: false, error: "Invalid kiosk secret" });
  }

  return { kiosk_id: kioskId };
}
