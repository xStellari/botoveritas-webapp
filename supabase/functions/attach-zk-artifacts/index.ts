import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "../_shared/requireAdmin.ts";

type Body = {
  electionId: string;
  // Storage keys (paths) to pinned artifacts
  wasmKey: string; // e.g. tally/BV_TALLY_V1/<manifest_hash>/tally_js/tally.wasm
  zkeyKey: string; // e.g. tally/BV_TALLY_V1/<manifest_hash>/tally_final.zkey
  vkeyKey: string; // e.g. tally/BV_TALLY_V1/<manifest_hash>/verification_key.json
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-kiosk-id, x-kiosk-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function downloadBytes(supabase: ReturnType<typeof createClient>, bucket: string, key: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(bucket).download(key);
  if (error || !data) throw new Error(`download failed ${bucket}/${key}: ${error?.message ?? "no data"}`);
  const ab = await data.arrayBuffer();
  return new Uint8Array(ab);
}

serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });

    const supabaseUrl = requireEnv("SUPABASE_URL");
    const anonKey = requireEnv("SUPABASE_ANON_KEY");
    const serviceRole = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    try {
      await requireAdmin({ req, supabaseUrl, anonKey, serviceRoleKey: serviceRole });
    } catch (e: any) {
      const status = e?.status ?? 500;
      return json(status, { error: e?.message ?? String(e) });
    }

    const body = (await req.json()) as Body;
    if (!body?.electionId) return json(400, { error: "Missing electionId" });
    if (!body?.wasmKey || !body?.zkeyKey || !body?.vkeyKey) return json(400, { error: "Missing artifact storage keys" });

    const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

    // Load manifest row
    const { data: mRow, error: mErr } = await supabase
      .from("election_manifests")
      .select("id,election_id,manifest_hash,manifest")
      .eq("election_id", body.electionId)
      .maybeSingle();

    if (mErr) return json(500, { error: "Failed to load manifest", details: mErr.message });
    if (!mRow) return json(409, { error: "Missing manifest. Generate manifest first." });

    const bucket = "zk-artifacts";

    // Download + hash (server-verified)
    const wasmBytes = await downloadBytes(supabase, bucket, body.wasmKey);
    const zkeyBytes = await downloadBytes(supabase, bucket, body.zkeyKey);
    const vkeyBytes = await downloadBytes(supabase, bucket, body.vkeyKey);

    const wasmSha = await sha256Hex(wasmBytes);
    const zkeySha = await sha256Hex(zkeyBytes);
    const vkeySha = await sha256Hex(vkeyBytes);

    const nextManifest = {
      ...(mRow.manifest ?? {}),
      artifacts: {
        circuit: { id: "tally", version: "BV_TALLY_V1" },
        wasm: { bucket, key: body.wasmKey, sha256: wasmSha },
        zkey: { bucket, key: body.zkeyKey, sha256: zkeySha },
        vkey: { bucket, key: body.vkeyKey, sha256: vkeySha },
        pinnedAt: new Date().toISOString(),
      },
    };

    const { error: uErr } = await supabase
      .from("election_manifests")
      .update({ manifest: nextManifest, updated_at: new Date().toISOString() })
      .eq("election_id", body.electionId);

    if (uErr) return json(500, { error: "Failed to attach artifacts to manifest", details: uErr.message });

    return json(200, {
      ok: true,
      electionId: body.electionId,
      manifestHash: mRow.manifest_hash,
      artifacts: nextManifest.artifacts,
    });
  } catch (e: any) {
    console.error("[attach-zk-artifacts] error", e);
    return json(500, { error: e?.message ?? String(e) });
  }
});
