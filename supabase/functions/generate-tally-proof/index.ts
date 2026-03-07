import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "../_shared/requireAdmin.ts";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type Body = {
  electionId: string; // UUID
  status?: string; // e.g. "proved"
  manifestHash: string;
  electionVoteRoot: string;
  resultsHash: string; // bytes32 hex recommended
  proofJsonUrl?: string; // storage key in zk-proofs
  publicSignalsJsonUrl?: string; // storage key in zk-proofs
  proof?: JsonValue;
  publicSignals?: JsonValue;
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

    const admin = await requireAdmin({
      req,
      supabaseUrl,
      anonKey,
      serviceRoleKey,
    });

    const body = (await req.json()) as Partial<Body>;
    const electionId = body.electionId;
    if (!electionId) return json(400, { error: "Missing electionId" });
    if (!body.manifestHash || !body.electionVoteRoot || !body.resultsHash) {
      return json(400, { error: "Missing manifestHash/electionVoteRoot/resultsHash" });
    }
    const hasInlineArtifacts = typeof body.proof !== "undefined" && typeof body.publicSignals !== "undefined";
    const hasStorageKeys = !!body.proofJsonUrl && !!body.publicSignalsJsonUrl;
    if (!hasInlineArtifacts && !hasStorageKeys) {
      return json(400, {
        error: "Missing proof/publicSignals payload or proofJsonUrl/publicSignalsJsonUrl",
      });
    }
    if (Array.isArray(body.publicSignals) && body.publicSignals.length < 4) {
      return json(409, {
        error:
          "publicSignals must contain at least 4 public inputs. The uploaded tally.wasm/tally_final.zkey artifacts were likely compiled from a stale circuit that did not expose electionIdHash, electionVoteRoot, manifestHash, and resultsHash as public inputs. Regenerate the tally circuit, rebuild the artifacts, upload them again, then retry proof generation.",
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const base = `tally/BV_TALLY_UNIVERSAL_V1/${body.electionId}`;
    const proofJsonUrl = body.proofJsonUrl ?? `${base}/proof.json`;
    const publicSignalsJsonUrl = body.publicSignalsJsonUrl ?? `${base}/publicSignals.json`;

    if (hasInlineArtifacts) {
      const proofUpload = await supabase.storage.from("zk-proofs").upload(
        proofJsonUrl,
        JSON.stringify(body.proof, null, 2),
        { upsert: true, contentType: "application/json" },
      );
      if (proofUpload.error) return json(500, { error: proofUpload.error.message });

      const publicSignalsUpload = await supabase.storage.from("zk-proofs").upload(
        publicSignalsJsonUrl,
        JSON.stringify(body.publicSignals, null, 2),
        { upsert: true, contentType: "application/json" },
      );
      if (publicSignalsUpload.error) {
        return json(500, { error: publicSignalsUpload.error.message });
      }
    }

    const now = new Date().toISOString();
    const row = {
      election_id: electionId,
      status: body.status ?? "proved",
      manifest_hash: body.manifestHash,
      election_vote_root: body.electionVoteRoot,
      results_hash: body.resultsHash,
      proof_json_url: proofJsonUrl,
      public_signals_json_url: publicSignalsJsonUrl,
      error_message: null,
      created_by: admin.userId,
      updated_at: now,
    };

    const { error } = await supabase
      .from("election_tally_proofs")
      .upsert(row as any, { onConflict: "election_id" });

    if (error) return json(500, { error: error.message });

    return json(200, { ok: true });
  } catch (e) {
    console.error("[generate-tally-proof] error", e);
    const status = typeof (e as { status?: unknown })?.status === "number"
      ? (e as { status: number }).status
      : 500;
    return json(status, { error: (e as { message?: string })?.message ?? String(e) });
  }
});
