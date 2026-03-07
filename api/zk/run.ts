import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

// snarkjs ships without reliable TS declarations in some serverless setups; runtime import is safe.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const snarkjs: any = require("snarkjs");

// circomlibjs ships without TS types; runtime import is safe.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const circomlibjs: any = require("circomlibjs");

type ZkRunResponse = {
  ok: boolean;
  electionId: string;
  proofGenerated: boolean;
  proofVerified: boolean;
  genMs: number;
  verifyMs: number;
  proofSha256?: string;
  publicSignalsSha256?: string;
  proofJsonUrl?: string;
  publicSignalsJsonUrl?: string;
  manifestHash?: string;
  electionVoteRoot?: string;
  resultsHash?: string;
  positionsTotal?: number;
  positionsMatched?: number;
  mismatchCount?: number;
  accuracy?: number;
  notes?: string;
  error?: string;
  details?: string;
};

function envAny(...names: string[]) {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return null;
}

function requireEnvAny(...names: string[]) {
  const v = envAny(...names);
  if (!v) throw new Error(`Missing required env: ${names.join(" OR ")}`);
  return v;
}

function isUuid(v: string) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);
}

async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return "0x" + createHash("sha256").update(data).digest("hex");
}

function toBigIntDec(x: string | number): bigint {
  if (typeof x === "number") return BigInt(x);
  const s = String(x).trim();
  if (s.startsWith("0x")) return BigInt(s);
  return BigInt(s);
}

async function computeResultsHashField(witness: any): Promise<string> {
  const pub = witness?.publicInputs;
  const cir = witness?.circuitInputs;

  if (!pub?.electionIdHashField || !pub?.electionVoteRootField || !pub?.manifestHashField) {
    throw new Error("Missing witness.publicInputs.{electionIdHashField,electionVoteRootField,manifestHashField}");
  }
  if (!pub?.resultsCommitDomainField) {
    throw new Error("Missing witness.publicInputs.resultsCommitDomainField");
  }
  if (!cir?.foldVector || !Array.isArray(cir.foldVector)) {
    throw new Error("Missing witness.circuitInputs.foldVector[]");
  }

  const poseidon = await circomlibjs.buildPoseidon();
  const domain = toBigIntDec(pub.resultsCommitDomainField);
  const electionIdHash = toBigIntDec(pub.electionIdHashField);
  const root = toBigIntDec(pub.electionVoteRootField);
  const manifestHash = toBigIntDec(pub.manifestHashField);

  let h: bigint = BigInt(poseidon([domain, electionIdHash]));
  h = BigInt(poseidon([h, root]));
  h = BigInt(poseidon([h, manifestHash]));
  for (const v of cir.foldVector) {
    h = BigInt(poseidon([h, toBigIntDec(v)]));
  }
  return h.toString(10);
}

function buildSnarkjsInputFromWitness(witness: any) {
  const pub = witness?.publicInputs;
  const cir = witness?.circuitInputs;
  const tallyPositions = witness?.tally?.positions;
  if (!pub?.electionIdHashField || !pub?.electionVoteRootField || !pub?.manifestHashField || !pub?.resultsHashField) {
    throw new Error("Missing witness.publicInputs fields for proving");
  }
  if (typeof cir?.positionCount === "undefined" || !Array.isArray(cir?.candidateCounts) || !Array.isArray(cir?.abstain) || !Array.isArray(cir?.tallies)) {
    throw new Error("Missing witness.circuitInputs.{positionCount,candidateCounts,abstain,tallies}");
  }
  if (!Array.isArray(tallyPositions) || tallyPositions.length === 0) {
    throw new Error("Missing witness.tally.positions[]");
  }

  const candidateCounts = (cir.candidateCounts as Array<string | number>).map((x) => String(x));
  const tallies = (cir.tallies as Array<Array<string | number>>).map((row) => (row ?? []).map((x) => String(x)));

  return {
    electionIdHash: String(pub.electionIdHashField),
    electionVoteRoot: String(pub.electionVoteRootField),
    manifestHash: String(pub.manifestHashField),
    resultsHash: String(pub.resultsHashField),
    positionCount: String(cir.positionCount),
    candidateCounts,
    abstain: (cir.abstain as Array<string | number>).map((x) => String(x)),
    tallies,
  };
}

async function recountDbTallies(service: any, electionId: string, witness: any) {
  // Recount from DB as the independent ground truth.
  const { data: voteRows, error } = await service
    .from("votes")
    .select("position,candidate_id,is_abstain")
    .eq("election_id", electionId);
  if (error) throw new Error(`Failed to load votes for recount: ${error.message}`);

  const posList: any[] = witness?.tally?.positions ?? [];
  const posByTitle = new Map<string, any>();
  for (const p of posList) posByTitle.set(String(p?.title ?? ""), p);

  const counts: Record<string, { abstain: number; byCandidate: Record<string, number> }> = {};
  for (const r of voteRows ?? []) {
    const position = String((r as any).position ?? "");
    if (!counts[position]) counts[position] = { abstain: 0, byCandidate: {} };
    const isAbstain = Boolean((r as any).is_abstain);
    if (isAbstain) {
      counts[position].abstain += 1;
      continue;
    }
    const cand = (r as any).candidate_id ? String((r as any).candidate_id) : "";
    if (!cand) continue;
    counts[position].byCandidate[cand] = (counts[position].byCandidate[cand] ?? 0) + 1;
  }

  let positionsMatched = 0;
  let mismatchCount = 0;

  for (const p of posList) {
    const title = String(p?.title ?? "");
    const db = counts[title] ?? { abstain: 0, byCandidate: {} };
    const wAbstain = Number(p?.abstain ?? 0);
    if (db.abstain !== wAbstain) mismatchCount += 1;

    const candidates: any[] = p?.candidates ?? [];
    let posOk = db.abstain === wAbstain;
    for (const c of candidates) {
      const cid = String(c?.id ?? "");
      const wVotes = Number(c?.votes ?? 0);
      const dbVotes = Number(db.byCandidate[cid] ?? 0);
      if (dbVotes !== wVotes) {
        mismatchCount += 1;
        posOk = false;
      }
    }
    if (posOk) positionsMatched += 1;
  }

  const positionsTotal = posList.length;
  const accuracy = positionsTotal > 0 ? (positionsMatched / positionsTotal) * 100 : 0;
  return { positionsTotal, positionsMatched, mismatchCount, accuracy };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" } satisfies Partial<ZkRunResponse>);

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ ok: false, error: "Missing Authorization header" } satisfies Partial<ZkRunResponse>);

  const electionId = typeof req.body?.electionId === "string" ? req.body.electionId : "";
  if (!electionId || !isUuid(electionId)) {
    return res.status(400).json({ ok: false, error: "Invalid electionId" } satisfies Partial<ZkRunResponse>);
  }

  try {
    const supabaseUrl = requireEnvAny("SUPABASE_URL");
    const anonKey = requireEnvAny("SUPABASE_ANON_KEY");
    const serviceKey = requireEnvAny("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE");

    // 1) Verify caller + admin role
    const authed = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await authed.auth.getUser();
    if (userErr || !userData?.user) {
      return res.status(401).json({ ok: false, electionId, error: "Invalid token" } satisfies Partial<ZkRunResponse>);
    }

    const { data: roleRow, error: roleErr } = await authed
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (roleErr) {
      return res
        .status(500)
        .json({ ok: false, electionId, error: "Failed to verify admin role", details: roleErr.message } satisfies Partial<ZkRunResponse>);
    }
    if (!roleRow || roleRow.role !== "admin") {
      return res.status(403).json({ ok: false, electionId, error: "Forbidden: admin role required" } satisfies Partial<ZkRunResponse>);
    }

    const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // 2) Call witness generator as the authenticated admin user
    const witnessUrl = `${supabaseUrl}/functions/v1/generate-zk-tally-witness`;
    const witnessRes = await fetch(witnessUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        electionId,
        strict_chunks_match: true,
        check_onchain: true,
      }),
    });

    const witnessJson = await witnessRes.json().catch(() => null);
    if (!witnessRes.ok || !witnessJson?.witness) {
      return res.status(500).json({
        ok: false,
        electionId,
        error: "Failed to generate ZK witness",
        details: witnessJson?.error || witnessJson?.details || `HTTP ${witnessRes.status}`,
      } satisfies Partial<ZkRunResponse>);
    }

    const witness = witnessJson.witness;

    // 3) Compute resultsHashField (Poseidon fold) and patch witness in-memory
    witness.publicInputs = witness.publicInputs ?? {};
    witness.publicInputs.resultsHashField = await computeResultsHashField(witness);

    // 4) Build snarkjs circuit input
    const snarkInput = buildSnarkjsInputFromWitness(witness);

    // 5) Download proving artifacts from Supabase Storage
    const bucket = envAny("ZK_ARTIFACTS_BUCKET") ?? "zk-artifacts";
    const wasmKey = envAny("ZK_TALLY_WASM_KEY") ?? "tally/BV_TALLY_UNIVERSAL_V1/tally_js/tally.wasm";
    const zkeyKey = envAny("ZK_TALLY_ZKEY_KEY") ?? "tally/BV_TALLY_UNIVERSAL_V1/tally_final.zkey";
    const vkeyKey = envAny("ZK_TALLY_VKEY_KEY") ?? "tally/BV_TALLY_UNIVERSAL_V1/verification_key.json";

    const download = async (key: string) => {
      const { data, error } = await service.storage.from(bucket).download(key);
      if (error) throw new Error(`Failed to download artifact ${bucket}/${key}: ${error.message}`);
      const ab = await data.arrayBuffer();
      return Buffer.from(ab);
    };

    const [wasmBytes, zkeyBytes, vkeyBytes] = await Promise.all([download(wasmKey), download(zkeyKey), download(vkeyKey)]);

    // Write to /tmp for snarkjs
    const fs = require("node:fs");
    const path = require("node:path");
    const tmpDir = process.env.TMPDIR || "/tmp";
    const runDir = path.join(tmpDir, `bv-zk-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    fs.mkdirSync(runDir, { recursive: true });
    const wasmPath = path.join(runDir, "tally.wasm");
    const zkeyPath = path.join(runDir, "tally_final.zkey");
    const vkeyPath = path.join(runDir, "verification_key.json");
    fs.writeFileSync(wasmPath, wasmBytes);
    fs.writeFileSync(zkeyPath, zkeyBytes);
    fs.writeFileSync(vkeyPath, vkeyBytes);

    // 6) Prove + verify
    const genStart = Date.now();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(snarkInput, wasmPath, zkeyPath);
    const genMs = Date.now() - genStart;

    const vKey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
    const verifyStart = Date.now();
    const proofVerified = await snarkjs.groth16.verify(vKey, publicSignals, proof);
    const verifyMs = Date.now() - verifyStart;

    const proofSha256 = await sha256Hex(JSON.stringify(proof));
    const publicSignalsSha256 = await sha256Hex(JSON.stringify(publicSignals));

    const manifestHash = String(witness.publicInputs.manifestHashField);
    const electionVoteRoot = String(witness.publicInputs.electionVoteRootField);
    const resultsHash = String(witness.publicInputs.resultsHashField);
    const proofJsonUrl = `tally/BV_TALLY_UNIVERSAL_V1/${electionId}/proof.json`;
    const publicSignalsJsonUrl = `tally/BV_TALLY_UNIVERSAL_V1/${electionId}/publicSignals.json`;

    const proofUpload = await service.storage.from("zk-proofs").upload(
      proofJsonUrl,
      JSON.stringify(proof, null, 2),
      { upsert: true, contentType: "application/json" },
    );
    if (proofUpload.error) {
      throw new Error(`Failed to upload proof.json: ${proofUpload.error.message}`);
    }

    const publicSignalsUpload = await service.storage.from("zk-proofs").upload(
      publicSignalsJsonUrl,
      JSON.stringify(publicSignals, null, 2),
      { upsert: true, contentType: "application/json" },
    );
    if (publicSignalsUpload.error) {
      throw new Error(`Failed to upload publicSignals.json: ${publicSignalsUpload.error.message}`);
    }

    const now = new Date().toISOString();
    const proofRow = {
      election_id: electionId,
      status: proofVerified ? "proved" : "prove_failed",
      manifest_hash: manifestHash,
      election_vote_root: electionVoteRoot,
      results_hash: resultsHash,
      proof_json_url: proofJsonUrl,
      public_signals_json_url: publicSignalsJsonUrl,
      error_message: proofVerified ? null : "Backend self-verification failed",
      updated_at: now,
    };
    const { error: proofRowErr } = await service
      .from("election_tally_proofs")
      .upsert(proofRow as any, { onConflict: "election_id" });
    if (proofRowErr) {
      throw new Error(`Failed to upsert election_tally_proofs row: ${proofRowErr.message}`);
    }

    // 7) Tally accuracy (DB recount vs witness tally)
    const { positionsTotal, positionsMatched, mismatchCount, accuracy } = await recountDbTallies(service, electionId, witness);

    const out: ZkRunResponse = {
      ok: true,
      electionId,
      proofGenerated: true,
      proofVerified: Boolean(proofVerified),
      genMs,
      verifyMs,
      proofSha256,
      publicSignalsSha256,
      proofJsonUrl,
      publicSignalsJsonUrl,
      manifestHash,
      electionVoteRoot,
      resultsHash,
      positionsTotal,
      positionsMatched,
      mismatchCount,
      accuracy,
      notes: proofVerified ? "Verifier accepted proof." : "Verifier rejected proof.",
    };

    return res.status(200).json(out);
  } catch (e: any) {
    const out: ZkRunResponse = {
      ok: false,
      electionId,
      proofGenerated: false,
      proofVerified: false,
      genMs: 0,
      verifyMs: 0,
      error: "ZK run failed",
      details: e?.message ?? String(e),
    };
    return res.status(500).json(out);
  }
}
