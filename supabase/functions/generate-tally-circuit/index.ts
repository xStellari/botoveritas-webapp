import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "../_shared/requireAdmin.ts";

type Body = { electionId: string };
const MAX_POSITIONS = 20;
const MAX_CANDIDATES_PER_POSITION = 5;
const CIRCUIT_VERSION = "BV_TALLY_UNIVERSAL_V1";
const RESULTS_COMMIT_DOMAIN = "223344556";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-id, x-kiosk-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, payload: Record<string, unknown>) { return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function envAny(...names: string[]) { for (const n of names) { const v = Deno.env.get(n); if (v) return v; } return null; }
function requireEnvAny(...names: string[]) { const v = envAny(...names); if (!v) throw new Error(`Missing required secret: ${names.join(" OR ")}`); return v; }
function isUuid(v: string) { return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v); }

type ManifestRow = { election_id: string; spec_version: string; manifest_hash: string; manifest: any; };
function normalizePositions(manifestRaw: any): { name: string; candidateCount: number }[] {
  const inner = (manifestRaw?.manifest ?? manifestRaw) as any;
  const positions = Array.isArray(inner?.positions) ? inner.positions : [];
  if (!positions.length) throw new Error("Manifest missing positions[]");
  return positions.map((p: any, idx: number) => ({
    name: String(p?.name ?? p?.position ?? p?.title ?? `Position_${idx}`),
    candidateCount: Array.isArray(p?.candidates) ? p.candidates.length : 0,
  }));
}
function assertWithinUniversalBounds(positions: { name: string; candidateCount: number }[]) {
  if (positions.length > MAX_POSITIONS) throw new Error(`Manifest has ${positions.length} positions; universal circuit supports at most ${MAX_POSITIONS}`);
  for (const p of positions) if (p.candidateCount > MAX_CANDIDATES_PER_POSITION) throw new Error(`Position "${p.name}" has ${p.candidateCount} candidates; universal circuit supports at most ${MAX_CANDIDATES_PER_POSITION}`);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const supabaseUrl = requireEnvAny("SUPABASE_URL");
    const anonKey = requireEnvAny("SUPABASE_ANON_KEY", "SUPABASE_ANON_PUBLIC_KEY");
    const serviceRoleKey = requireEnvAny("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY");
    await requireAdmin({ req, supabaseUrl, anonKey, serviceRoleKey });
    const body = (await req.json()) as Body;
    if (!body?.electionId || !isUuid(body.electionId)) return json(400, { error: "Invalid electionId" });
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: manifestRow, error: manErr } = await supabase.from("election_manifests").select("election_id,spec_version,manifest_hash,manifest").eq("election_id", body.electionId).maybeSingle<ManifestRow>();
    if (manErr) return json(500, { error: "Failed to read manifest", details: manErr.message });
    if (!manifestRow) return json(404, { error: "Manifest not found. Generate manifest first." });
    const positions = normalizePositions(manifestRow.manifest);
    assertWithinUniversalBounds(positions);
    const meta = {
      specVersion: CIRCUIT_VERSION,
      electionId: manifestRow.election_id,
      manifestHash: manifestRow.manifest_hash,
      maxPositions: MAX_POSITIONS,
      maxCandidatesPerPosition: MAX_CANDIDATES_PER_POSITION,
      resultsCommitDomain: RESULTS_COMMIT_DOMAIN,
      positions,
      generatedAt: new Date().toISOString(),
    };
    const circom = await Deno.readTextFile("zk/circuits/tally.circom");
    return json(200, { status: "ok", meta, circom });
  } catch (e) {
    console.error("generate-tally-circuit error:", e);
    return json(500, { error: "Unexpected error", details: e instanceof Error ? e.message : String(e) });
  }
});
