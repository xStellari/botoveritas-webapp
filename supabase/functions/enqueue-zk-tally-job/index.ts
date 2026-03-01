import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";


type Body = { electionId: string };

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function envAny(...names: string[]) {
  for (const n of names) {
    const v = Deno.env.get(n);
    if (v) return v;
  }
  return null;
}

function requireEnvAny(...names: string[]) {
  const v = envAny(...names);
  if (!v) throw new Error(`Missing required secret: ${names.join(" OR ")}`);
  return v;
}

async function requireAdmin(req: Request, supabaseUrl: string, anonKey: string, serviceRoleKey: string) {
  const authz = req.headers.get("Authorization") ?? "";

  const anon = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authz } },
  });

  const { data: u, error: uErr } = await anon.auth.getUser();
  if (uErr || !u?.user) return { ok: false, userId: null };

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: roleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", u.user.id)
    .maybeSingle();

  if (roleRow?.role !== "admin") return { ok: false, userId: u.user.id };

  return { ok: true, userId: u.user.id };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const supabaseUrl = requireEnvAny("SUPABASE_URL");
    const anonKey = requireEnvAny("SUPABASE_ANON_KEY");
    const serviceRoleKey = requireEnvAny("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY");

    const { ok, userId } = await requireAdmin(req, supabaseUrl, anonKey, serviceRoleKey);
    if (!ok) return json(401, { error: "Unauthorized" });

    const body = (await req.json().catch(() => null)) as Body | null;
    const electionId = body?.electionId;
    if (!electionId) return json(400, { error: "Missing electionId" });

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Require manifest + root to exist (locked pipeline)
    const { data: man } = await admin
      .from("election_manifests")
      .select("manifest_hash")
      .eq("election_id", electionId)
      .maybeSingle();
    if (!man?.manifest_hash) return json(409, { error: "Manifest missing. Generate manifest first." });

    const { data: root } = await admin
      .from("election_vote_roots")
      .select("election_vote_root,chunk_count")
      .eq("election_id", electionId)
      .maybeSingle();
    if (!root?.election_vote_root) return json(409, { error: "Root missing. Anchor root first." });

    // Create/update job row
    const { error: upErr } = await admin
      .from("election_tally_proofs")
      .upsert({
        election_id: electionId,
        status: "queued",
        manifest_hash: man.manifest_hash,
        election_vote_root: root.election_vote_root,
        created_by: userId,
        chain: "polygon-amoy",
        updated_at: new Date().toISOString(),
      }, { onConflict: "election_id" });

    if (upErr) return json(500, { error: "Failed to enqueue job", details: errMsg(upErr) });

    return json(200, { ok: true, electionId, status: "queued" });
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    return json(500, { error: "Internal error", details: errorMessage });
  }
});
