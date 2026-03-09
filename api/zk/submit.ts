import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const snarkjs: any = require("snarkjs");

type SubmitProofResponse = {
  ok: boolean;
  electionId: string;
  submitted: boolean;
  txHash?: string;
  blockNumber?: number;
  registryAddress?: string;
  verifierAddress?: string;
  resultsUri?: string;
  error?: string;
  details?: string;
};

type ManifestRow = {
  manifest_hash: string;
  manifest?: {
    artifacts?: {
      vkey?: { bucket?: string; key?: string; sha256?: string };
      zkey?: { bucket?: string; key?: string; sha256?: string };
      wasm?: { bucket?: string; key?: string; sha256?: string };
    };
  } | null;
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

function toBytes32FromDecString(value: string | number | bigint): string {
  const bi = typeof value === "bigint" ? value : BigInt(String(value).trim());
  return ethers.toBeHex(bi, 32);
}

function normalizeForUint(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  const s = String(v ?? "").trim();
  if (!s) throw new Error("Encountered empty proof coordinate");
  return BigInt(s);
}

function normalizeField(v: unknown): string {
  if (typeof v === "bigint") return v.toString(10);
  if (typeof v === "number") return BigInt(v).toString(10);
  const s = String(v ?? "").trim();
  if (!s) throw new Error("Encountered empty field while normalizing public signal");
  return BigInt(s).toString(10);
}

function extractGroth16Calldata(proof: any) {
  if (!proof?.pi_a || !proof?.pi_b || !proof?.pi_c) {
    throw new Error("proof.json is missing pi_a / pi_b / pi_c");
  }

  const a: [bigint, bigint] = [normalizeForUint(proof.pi_a[0]), normalizeForUint(proof.pi_a[1])];
  const b: [[bigint, bigint], [bigint, bigint]] = [
    [normalizeForUint(proof.pi_b[0][1]), normalizeForUint(proof.pi_b[0][0])],
    [normalizeForUint(proof.pi_b[1][1]), normalizeForUint(proof.pi_b[1][0])],
  ];
  const c: [bigint, bigint] = [normalizeForUint(proof.pi_c[0]), normalizeForUint(proof.pi_c[1])];
  return { a, b, c };
}

async function downloadJsonFromStorage(service: any, bucket: string, key: string) {
  const { data, error } = await service.storage.from(bucket).download(key);
  if (error) throw new Error(`Failed to download ${bucket}/${key}: ${error.message}`);
  return JSON.parse(await data.text());
}

function expectedPublicSignalsFromWitness(witness: any): string[] {
  return [
    normalizeField(witness?.publicInputs?.electionIdHashField),
    normalizeField(witness?.publicInputs?.electionVoteRootField),
    normalizeField(witness?.publicInputs?.manifestHashField),
    normalizeField(witness?.publicInputs?.resultsHashField),
  ];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, submitted: false, error: "Method not allowed" } satisfies Partial<SubmitProofResponse>);

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ ok: false, submitted: false, error: "Missing Authorization header" } satisfies Partial<SubmitProofResponse>);

  const electionId = typeof req.body?.electionId === "string" ? req.body.electionId : "";
  if (!electionId || !isUuid(electionId)) {
    return res.status(400).json({ ok: false, submitted: false, error: "Invalid electionId" } satisfies Partial<SubmitProofResponse>);
  }

  try {
    const supabaseUrl = requireEnvAny("SUPABASE_URL");
    const anonKey = requireEnvAny("SUPABASE_ANON_KEY");
    const serviceKey = requireEnvAny("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE");

    const authed = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await authed.auth.getUser();
    if (userErr || !userData?.user) {
      return res.status(401).json({ ok: false, electionId, submitted: false, error: "Invalid token" } satisfies Partial<SubmitProofResponse>);
    }

    const { data: roleRow, error: roleErr } = await authed
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (roleErr) {
      return res.status(500).json({ ok: false, electionId, submitted: false, error: "Failed to verify admin role", details: roleErr.message } satisfies Partial<SubmitProofResponse>);
    }
    if (!roleRow || roleRow.role !== "admin") {
      return res.status(403).json({ ok: false, electionId, submitted: false, error: "Forbidden: admin role required" } satisfies Partial<SubmitProofResponse>);
    }

    const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: proofRowData, error: proofErr } = await service
      .from("election_tally_proofs")
      .select("election_id,status,tx_hash,manifest_hash,election_vote_root,results_hash,proof_json_url,public_signals_json_url,results_json_url")
      .eq("election_id", electionId)
      .maybeSingle();
    if (proofErr) throw new Error(`Failed to load proof row: ${proofErr.message}`);
    if (!proofRowData) throw new Error("No proof row found for this election");
    if (proofRowData.tx_hash) {
      return res.status(409).json({ ok: false, electionId, submitted: false, error: "Proof already submitted on-chain", details: String(proofRowData.tx_hash) } satisfies Partial<SubmitProofResponse>);
    }
    if (!proofRowData.proof_json_url || !proofRowData.public_signals_json_url) {
      throw new Error("Proof row is missing proof_json_url or public_signals_json_url");
    }

    const { data: manifestRowData, error: manifestErr } = await service
      .from("election_manifests")
      .select("manifest_hash,manifest")
      .eq("election_id", electionId)
      .maybeSingle();
    if (manifestErr) throw new Error(`Failed to load manifest row: ${manifestErr.message}`);
    const manifestRow = manifestRowData as ManifestRow | null;
    if (!manifestRow) throw new Error("No manifest row found for this election");

    const witnessUrl = `${supabaseUrl}/functions/v1/generate-zk-tally-witness`;
    const witnessRes = await fetch(witnessUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ electionId, strict_chunks_match: true, check_onchain: true }),
    });
    const witnessJson = await witnessRes.json().catch(() => null);
    if (!witnessRes.ok || !witnessJson?.witness) {
      throw new Error(witnessJson?.error || witnessJson?.details || `Failed to generate witness for submitTally (HTTP ${witnessRes.status})`);
    }
    const witness = witnessJson.witness;

    const electionIdBytes32 = String(witness?.commitments?.electionIdBytes32 ?? "");
    const electionVoteRootBytes32 = String(witness?.commitments?.electionRoot ?? "");
    const manifestHashBytes32 = String(witness?.commitments?.manifestHash ?? "");
    const resultsHashField = String(witness?.publicInputs?.resultsHashField ?? proofRowData.results_hash ?? "");
    if (!electionIdBytes32 || !electionVoteRootBytes32 || !manifestHashBytes32 || !resultsHashField) {
      throw new Error("Witness is missing canonical on-chain submission fields");
    }

    const resultsHashBytes32 = toBytes32FromDecString(resultsHashField);
    const storedManifestField = String(proofRowData.manifest_hash ?? "");
    const storedRootField = String(proofRowData.election_vote_root ?? "");
    const storedResultsField = String(proofRowData.results_hash ?? "");
    if (storedManifestField && storedManifestField !== String(witness.publicInputs.manifestHashField)) {
      throw new Error("Stored manifest_hash does not match regenerated witness");
    }
    if (storedRootField && storedRootField !== String(witness.publicInputs.electionVoteRootField)) {
      throw new Error("Stored election_vote_root does not match regenerated witness");
    }
    if (storedResultsField && storedResultsField !== resultsHashField) {
      throw new Error("Stored results_hash does not match regenerated witness");
    }

    const proof = await downloadJsonFromStorage(service, "zk-proofs", proofRowData.proof_json_url);
    const publicSignalsRaw = await downloadJsonFromStorage(service, "zk-proofs", proofRowData.public_signals_json_url);
    if (!Array.isArray(publicSignalsRaw) || publicSignalsRaw.length < 4) {
      throw new Error("Stored publicSignals.json must contain at least 4 entries");
    }

    const expectedSignals = expectedPublicSignalsFromWitness(witness);
    const actualSignals = publicSignalsRaw.map((value: unknown) => normalizeField(value));
    for (let i = 0; i < expectedSignals.length; i += 1) {
      if (actualSignals[i] !== expectedSignals[i]) {
        throw new Error(`publicSignals[${i}] does not match the regenerated witness; regenerate proof with the current artifacts and witness`);
      }
    }

    const vkeyBucket = String(manifestRow.manifest?.artifacts?.vkey?.bucket ?? envAny("ZK_ARTIFACTS_BUCKET") ?? "zk-artifacts");
    const vkeyKey = String(manifestRow.manifest?.artifacts?.vkey?.key ?? envAny("ZK_TALLY_VKEY_KEY") ?? "tally/BV_TALLY_UNIVERSAL_V1/verification_key.json");
    const verificationKey = await downloadJsonFromStorage(service, vkeyBucket, vkeyKey);
    const locallyVerified = await snarkjs.groth16.verify(verificationKey, actualSignals, proof);
    if (!locallyVerified) {
      throw new Error("Proof does not verify against the current verification_key.json; redeploy/publish matching artifacts and regenerate proof");
    }

    const { a, b, c } = extractGroth16Calldata(proof);

    const registryAddress = requireEnvAny(
      "ELECTION_TALLY_REGISTRY_ADDRESS",
      "TALLY_REGISTRY_ADDRESS",
      "NEXT_PUBLIC_ELECTION_TALLY_REGISTRY_ADDRESS",
      "VITE_ELECTION_TALLY_REGISTRY_ADDRESS"
    );
    const rpcUrl = requireEnvAny("AMOY_RPC_URL");
    const submitPk = requireEnvAny(
      "TALLY_OWNER_PRIVATE_KEY",
      "ANCHOR_OWNER_PRIVATE_KEY",
      "MINTER_PRIVATE_KEY",
      "DEPLOYER_PRIVATE_KEY"
    );

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(submitPk, provider);
    const registry = new ethers.Contract(
      registryAddress,
      [
        "function submitTally(bytes32 electionIdHash, bytes32 electionVoteRoot, bytes32 manifestHash, bytes32 resultsHash, string resultsUri, uint256[2] a, uint256[2][2] b, uint256[2] c) external",
        "function verifier() external view returns (address)",
      ],
      wallet,
    );

    const preferredUri = String(proofRowData.results_json_url ?? "").trim();
    const fallbackKey = String(proofRowData.public_signals_json_url ?? proofRowData.proof_json_url ?? "").trim();
    const resultsUri = preferredUri
      ? preferredUri
      : service.storage.from("zk-proofs").getPublicUrl(fallbackKey).data.publicUrl;
    if (!resultsUri) throw new Error("Could not determine resultsUri for on-chain submitTally");

    const tx = await registry.submitTally(
      electionIdBytes32,
      electionVoteRootBytes32,
      manifestHashBytes32,
      resultsHashBytes32,
      resultsUri,
      a,
      b,
      c,
    );
    const receipt = await tx.wait();
    const verifierAddress = String(await registry.verifier());

    const now = new Date().toISOString();
    const { error: updateErr } = await service
      .from("election_tally_proofs")
      .update({
        status: "submitted",
        tx_hash: tx.hash,
        chain: "polygon-amoy",
        registry_address: registryAddress,
        verifier_address: verifierAddress,
        error_message: null,
        updated_at: now,
      } as any)
      .eq("election_id", electionId);
    if (updateErr) throw new Error(`Failed to update proof row after submitTally: ${updateErr.message}`);

    return res.status(200).json({
      ok: true,
      electionId,
      submitted: true,
      txHash: tx.hash,
      blockNumber: Number(receipt?.blockNumber ?? 0),
      registryAddress,
      verifierAddress,
      resultsUri,
    } satisfies SubmitProofResponse);
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      electionId,
      submitted: false,
      error: e?.message || "submitTally failed",
      details: e?.stack || String(e),
    } satisfies SubmitProofResponse);
  }
}
