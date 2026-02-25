// supabase/functions/kiosk-heartbeat/index.ts
// Records kiosk liveness and updates kiosk_devices.last_seen_at.
// Uses shared kiosk auth (Asia/Manila daily secret with graceful midnight rollover).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Database } from "../_shared/database.types.ts";
import { json, kioskCorsHeaders, requireKioskAuth } from "../_shared/kioskAuth.ts";

async function handler(req: Request): Promise<Response> {
  // CORS preflight
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

  const service = createClient<Database>(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const auth = await requireKioskAuth(req, service);
  if (auth instanceof Response) return auth;

  // Insert a heartbeat record (best-effort; should not fail the request)
  try {
    await (service as any)
      .from("kiosk_heartbeats")
      .insert({
        kiosk_id: auth.kiosk_id,
        ip_address: req.headers.get("x-forwarded-for") ?? null,
        user_agent: req.headers.get("user-agent") ?? null,
        status: "OK",
      });
  } catch {
    // ignore
  }

  return json(200, {
    ok: true,
    // If auth performed a midnight rollover, return the new secret so the client can persist it.
    rotate_secret: auth.rotate_secret ?? null,
  });
}

Deno.serve(handler);
