// supabase/functions/kiosk-get-voter-by-rfid/index.ts
// Option 3: service-only voter lookup gated by kiosk approval.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Database } from "../_shared/database.types.ts";
import { json, kioskCorsHeaders, requireKioskAuth } from "../_shared/kioskAuth.ts";

type Body = { rfid_tag?: string };

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

  const rfid = (body.rfid_tag ?? "").trim();
  if (!rfid) {
    return json(400, { ok: false, error: "rfid_tag is required" });
  }

  // Keep payload minimal; only fields required by the kiosk flow.
  const { data, error } = await service
    .from("voters")
    .select(
      [
        "id",
        "email",
        "first_name",
        "middle_name",
        "last_name",
        "suffix",
        "year_level",
        "org_affiliations",
        "rfid_tag",
        "voter_audience",
        "face_descriptor",
        "email_verified_at",
        "created_at",
      ].join(",")
    )
    .eq("rfid_tag", rfid)
    .maybeSingle();

  if (error) {
    return json(500, { ok: false, error: "Failed to lookup voter" });
  }

  return json(200, { ok: true, voter: data ?? null });
}
