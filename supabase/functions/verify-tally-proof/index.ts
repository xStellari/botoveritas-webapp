import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";
import * as snarkjs from "snarkjs";
import { requireAdmin } from "../_shared/requireAdmin.ts";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type Body = {
  electionId: string;
  persistResult?: boolean;
};

type ProofRow = {
  election_id: string;
  status: string | null;
  manifest_hash: string;
  election_vote_root: string;
  results_hash: string;
  proof_json_url: string | null;
  public_signals_json_url: string | null;
};

type ManifestRow = {
  manifest_hash: string;
  manifest: {
    artifacts?: {
      vkey?: {
        bucket?: string;
        key?: string;
      };
    };
  } | null;
};

type StorageCapableClient = {
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{
        data: Blob | null;
        error: { message?: string } | null;
      }>;
    };
  };
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

function envAny(...names: string[]) {
  for (const n of names) {
    const v = Deno.env.get(n);
    if (v) return v;
  }
  return null;
}

function normalizeField(v: unknown): string {
  if (typeof v === "bigint") return v.toString(10);
  if (typeof v === "number") return BigInt(v).toString(10);
  const s = String(v ?? "").trim();
  if (!s) throw new Error("Encountered empty field while normalizing public signal");
  return (s.startsWith("0x") || s.startsWith("0X") ? BigInt(s) : BigInt(s)).toString(10);
}

async function blobToJson(data: Blob): Promise<JsonValue> {
  const text = await data.text();
  try {
    return JSON.parse(text) as JsonValue;
  } catch (error) {
    throw new Error(
      `Failed to parse downloaded JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function downloadJson(
  supabase: StorageCapableClient,
  bucket: string,
  key: string,
): Promise<JsonValue> {
  const { data, error } = await supabase.storage.from(bucket).download(key);
  if (error || !data) throw new Error(`download failed ${bucket}/${key}: ${error?.message ?? "no data"}`);
  return await blobToJson(data);
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });

    const supabaseUrl = envAny("SUPABASE_URL", "SUPABASE_PROJECT_URL");
    const anonKey = envAny("SUPABASE_ANON_KEY", "SUPABASE_ANON_PUBLIC_KEY");
    const serviceRoleKey = envAny("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json(500, { error: "Missing Supabase env (url/anon/service)" });
    }

    await requireAdmin({
      req,
      supabaseUrl,
      anonKey,
      serviceRoleKey,
    });

    const body = (await req.json()) as Partial<Body>;
    if (!body.electionId) return json(400, { error: "Missing electionId" });

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: proofRow, error: proofErr } = await supabase
      .from("election_tally_proofs")
      .select("election_id,status,manifest_hash,election_vote_root,results_hash,proof_json_url,public_signals_json_url")
      .eq("election_id", body.electionId)
      .maybeSingle();

    if (proofErr) return json(500, { error: proofErr.message });
    const proofRowData = proofRow as ProofRow | null;
    if (!proofRowData) return json(404, { error: "No proof row found for election" });
    if (!proofRowData.proof_json_url || !proofRowData.public_signals_json_url) {
      return json(409, { error: "Proof row is missing proof_json_url or public_signals_json_url" });
    }

    const { data: manifestRow, error: manifestErr } = await supabase
      .from("election_manifests")
      .select("manifest_hash,manifest")
      .eq("election_id", body.electionId)
      .maybeSingle();

    if (manifestErr) return json(500, { error: manifestErr.message });
    const manifestRowData = manifestRow as ManifestRow | null;
    if (!manifestRowData) return json(404, { error: "No manifest row found for election" });

    const vkeyBucket = manifestRowData.manifest?.artifacts?.vkey?.bucket ?? "zk-artifacts";
    const vkeyKey = manifestRowData.manifest?.artifacts?.vkey?.key ??
      `tally/BV_TALLY_UNIVERSAL_V1/verification_key.json`;

    const proof = await downloadJson(supabase, "zk-proofs", proofRowData.proof_json_url);
    const publicSignalsRaw = await downloadJson(supabase, "zk-proofs", proofRowData.public_signals_json_url);
    const verificationKey = await downloadJson(supabase, vkeyBucket, vkeyKey);

    if (!Array.isArray(publicSignalsRaw)) {
      return json(500, { error: "publicSignals.json is not an array" });
    }
    if (publicSignalsRaw.length < 4) {
      return json(500, { error: "publicSignals.json must contain at least 4 entries" });
    }

    const publicSignals = publicSignalsRaw.map((v) => normalizeField(v));
    const rowSignals = {
      electionIdHash: normalizeField(publicSignals[0]),
      electionVoteRoot: normalizeField(proofRowData.election_vote_root),
      manifestHash: normalizeField(proofRowData.manifest_hash),
      resultsHash: normalizeField(proofRowData.results_hash),
    };

    const signalChecks = {
      electionVoteRootMatches: publicSignals[1] === rowSignals.electionVoteRoot,
      manifestHashMatches: publicSignals[2] === rowSignals.manifestHash,
      resultsHashMatches: publicSignals[3] === rowSignals.resultsHash,
    };

    if (!signalChecks.electionVoteRootMatches || !signalChecks.manifestHashMatches || !signalChecks.resultsHashMatches) {
      return json(409, {
        error: "Stored proof metadata does not match public signals",
        signalChecks,
        publicSignals: {
          electionIdHash: publicSignals[0],
          electionVoteRoot: publicSignals[1],
          manifestHash: publicSignals[2],
          resultsHash: publicSignals[3],
        },
        rowSignals,
      });
    }

    const verified = await snarkjs.groth16.verify(
      verificationKey as Record<string, unknown>,
      publicSignals,
      proof as Record<string, unknown>,
    );

    if (body.persistResult) {
      const nextStatus = verified ? "verified" : "verify_failed";
      const { error: updateErr } = await supabase
        .from("election_tally_proofs")
        .update({
          status: nextStatus,
          error_message: verified ? null : "Groth16 verification failed",
          updated_at: new Date().toISOString(),
        } as never)
        .eq("election_id", body.electionId);
      if (updateErr) return json(500, { error: updateErr.message });
    }

    return json(200, {
      ok: true,
      verified,
      electionId: proofRowData.election_id,
      status: proofRowData.status,
      persistedStatus: body.persistResult ? (verified ? "verified" : "verify_failed") : null,
      manifestHash: proofRowData.manifest_hash,
      electionVoteRoot: proofRowData.election_vote_root,
      resultsHash: proofRowData.results_hash,
      proofJsonUrl: proofRowData.proof_json_url,
      publicSignalsJsonUrl: proofRowData.public_signals_json_url,
      verificationKey: { bucket: vkeyBucket, key: vkeyKey },
      publicSignals: {
        electionIdHash: publicSignals[0],
        electionVoteRoot: publicSignals[1],
        manifestHash: publicSignals[2],
        resultsHash: publicSignals[3],
      },
      signalChecks,
    });
  } catch (e) {
    console.error("[verify-tally-proof] error", e);
    const status = typeof (e as { status?: unknown })?.status === "number"
      ? (e as { status: number }).status
      : 500;
    return json(status, { error: (e as { message?: string })?.message ?? String(e) });
  }
});
