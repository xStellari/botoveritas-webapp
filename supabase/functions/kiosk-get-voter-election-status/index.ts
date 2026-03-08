import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Database } from "../_shared/database.types.ts";
import { json, kioskCorsHeaders, requireKioskAuth } from "../_shared/kioskAuth.ts";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

type Body = {
  voter_id?: string;
  election_ids?: string[];
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

  const auth = await requireKioskAuth(req, service as any);
  if (auth instanceof Response) return auth;
  const rotateSecret = (auth as any).rotate_secret as string | undefined;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const voterId = (body.voter_id ?? "").trim();
  const electionIds = Array.isArray(body.election_ids)
    ? body.election_ids.map((id) => String(id).trim()).filter(Boolean)
    : [];

  if (!voterId || !isUuid(voterId)) {
    return json(400, { ok: false, error: "voter_id (UUID) is required" });
  }

  if (electionIds.length === 0) {
    return json(200, { ok: true, statuses: [], rotate_secret: rotateSecret ?? null });
  }

  if (electionIds.some((id) => !isUuid(id))) {
    return json(400, { ok: false, error: "All election_ids must be UUIDs" });
  }

  const { data, error } = await service
    .from("voter_election_status")
    .select("election_id, has_voted")
    .eq("voter_id", voterId)
    .in("election_id", electionIds);

  if (error) {
    return json(500, { ok: false, error: "Failed to read voter election status" });
  }

  return json(200, {
    ok: true,
    statuses: data ?? [],
    rotate_secret: rotateSecret ?? null,
  });
}

Deno.serve(handler);
