// supabase/functions/kiosk-session/index.ts
// Option 3: kiosk-gated wrapper around voter_sessions RPCs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Database } from "../_shared/database.types.ts";
import { json, kioskCorsHeaders, requireKioskAuth } from "../_shared/kioskAuth.ts";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

type Body = {
  action?: "has_active" | "get_active" | "upsert" | "extend" | "end";
  voter_id?: string;
  expires_at?: string;
  seconds?: number;
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: kioskCorsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(500, { ok: false, error: "Server misconfigured" });
  }

  const service = createClient<Database>(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const auth = await requireKioskAuth(req, service as any);
  if (auth instanceof Response) return auth;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const action = body.action;
  const voterId = (body.voter_id ?? "").trim();
  if (!action || !voterId || !isUuid(voterId)) {
    return json(400, { ok: false, error: "action and voter_id (UUID) are required" });
  }

  // Note: we pass kiosk_id from the validated header to preserve kiosk binding.
  const kioskId = auth.kiosk_id;

  if (action === "has_active") {
    const { data, error } = await service.rpc("has_active_voter_session" as any, { p_voter_id: voterId } as any);
    if (error) return json(500, { ok: false, error: "Failed to check session" });
    return json(200, { ok: true, hasActive: Boolean(data) });
  }

  if (action === "get_active") {
    const { data, error } = await service.rpc(
      "kiosk_get_active_voter_session" as any,
      { p_voter_id: voterId } as any
    );
    if (error) return json(500, { ok: false, error: "Failed to read session" });
    const row = Array.isArray(data) ? data[0] : data;
    return json(200, { ok: true, session: row ?? null });
  }

  if (action === "upsert") {
    const expiresAt = (body.expires_at ?? "").trim();
    if (!expiresAt) return json(400, { ok: false, error: "expires_at is required" });

    const { error } = await service.rpc(
      "kiosk_upsert_voter_session" as any,
      { p_voter_id: voterId, p_expires_at: expiresAt, p_kiosk_id: kioskId } as any
    );

    if (error) return json(500, { ok: false, error: "Failed to upsert session" });
    return json(200, { ok: true });
  }

  if (action === "extend") {
    const seconds = Number(body.seconds ?? 0);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) {
      return json(400, { ok: false, error: "seconds must be between 1 and 600" });
    }

    const { error } = await service.rpc(
      "kiosk_extend_voter_session" as any,
      { p_voter_id: voterId, p_kiosk_id: kioskId, p_seconds: seconds } as any
    );
    if (error) return json(500, { ok: false, error: "Failed to extend session" });
    return json(200, { ok: true });
  }

  if (action === "end") {
    const { error } = await service.rpc(
      "kiosk_end_voter_session" as any,
      { p_voter_id: voterId, p_kiosk_id: kioskId } as any
    );
    if (error) return json(500, { ok: false, error: "Failed to end session" });
    return json(200, { ok: true });
  }

  return json(400, { ok: false, error: "Unknown action" });
}
