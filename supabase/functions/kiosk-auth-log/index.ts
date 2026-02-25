// supabase/functions/kiosk-auth-log/index.ts
// Option 3: kiosk-gated security/auth logging into public.auth_logs using the service role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Database } from "../_shared/database.types.ts";
import { json, kioskCorsHeaders, requireKioskAuth } from "../_shared/kioskAuth.ts";

type Body = {
  event_type?: string;
  rfid_tag?: string | null;
  distance_score?: number | null;
  voter_id?: string | null;
};

async function handler(req: Request): Promise<Response> {
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

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const event_type = String(body.event_type ?? "").trim().slice(0, 64);
  const rfid_tag = body.rfid_tag ? String(body.rfid_tag).trim().slice(0, 64) : null;
  const distance_score =
    typeof body.distance_score === "number" ? body.distance_score : null;
  const voter_id = body.voter_id ? String(body.voter_id).trim() : null;

  if (!event_type) {
    return json(400, { ok: false, error: "Missing event_type" });
  }

  const { error } = await service.from("auth_logs").insert([
    {
      event_type,
      rfid_tag,
      distance_score,
      voter_id,
    } as any,
  ]);

  if (error) {
    return json(400, { ok: false, error: error.message });
  }

  return json(200, { ok: true });
}

Deno.serve(handler);
