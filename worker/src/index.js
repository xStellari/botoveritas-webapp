import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const INTERNAL_WORKER_KEY = process.env.INTERNAL_WORKER_KEY;

const REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS;
const AMOY_RPC_URL = process.env.AMOY_RPC_URL;
const SUBMITTER_PRIVATE_KEY = process.env.SUBMITTER_PRIVATE_KEY;

const RESULTS_BUCKET = process.env.ZK_RESULTS_BUCKET || "zk-results";
const ARTIFACTS_BUCKET = process.env.ZK_ARTIFACTS_BUCKET || "zk-artifacts";

if (!SUPABASE_URL || !SERVICE_ROLE || !INTERNAL_WORKER_KEY) {
  throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / INTERNAL_WORKER_KEY");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function downloadWitness(electionId) {
  const url = `${SUPABASE_URL}/functions/v1/internal-generate-zk-tally-witness`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-key": INTERNAL_WORKER_KEY,
      "apikey": SERVICE_ROLE
    },
    body: JSON.stringify({ electionId }),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`witness fetch failed: ${res.status} ${txt}`);
  return txt;
}

async function upload(bucket, key, bytes, contentType) {
  const { error } = await supabase.storage.from(bucket).upload(key, bytes, {
    upsert: true,
    contentType,
  });
  if (error) throw new Error(`upload failed ${bucket}/${key}: ${error.message}`);
  const { data } = supabase.storage.from(bucket).getPublicUrl(key);
  return data.publicUrl;
}
async function downloadStorage(bucket, key) {
  const { data, error } = await supabase.storage.from(bucket).download(key);
  if (error) throw new Error(`download failed ${bucket}/${key}: ${error.message}`);
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}

async function fetchManifest(electionId) {
  const { data, error } = await supabase
    .from("election_manifests")
    .select("manifest,manifest_hash")
    .eq("election_id", electionId)
    .maybeSingle();
  if (error) throw new Error(`manifest fetch failed: ${error.message}`);
  if (!data) throw new Error("Missing election manifest. Generate manifest first.");
  return data;
}

function getArtifactsFromManifest(manifest) {
  const artifacts = manifest?.artifacts;
  if (!artifacts) return null;
  const wasm = artifacts?.wasm;
  const zkey = artifacts?.zkey;
  const vkey = artifacts?.vkey;
  if (!wasm?.bucket || !wasm?.key || !wasm?.sha256) return null;
  if (!zkey?.bucket || !zkey?.key || !zkey?.sha256) return null;
  if (!vkey?.bucket || !vkey?.key || !vkey?.sha256) return null;
  return { wasm, zkey, vkey, circuit: artifacts?.circuit ?? null };
}

async function ensureArtifactsOnDisk(electionId, manifest) {
  const a = getArtifactsFromManifest(manifest);
  if (!a) {
    throw new Error("Missing ZK artifacts in manifest. Upload/pin artifacts first.");
  }

  const buildDir = "/app/zk/build/tally";
  const wasmPath = "/app/zk/build/tally/tally_js/tally.wasm";
  const zkeyPath = "/app/zk/build/tally/tally_final.zkey";
  const vkeyPath = "/app/zk/build/tally/verification_key.json";

  fs.mkdirSync(path.dirname(wasmPath), { recursive: true });
  fs.mkdirSync(buildDir, { recursive: true });

  // Download + verify sha256 before writing (prevents corrupt artifacts)
  const wasmBytes = await downloadStorage(a.wasm.bucket, a.wasm.key);
  const wasmHash = sha256Hex(wasmBytes);
  if (wasmHash !== a.wasm.sha256) throw new Error(`WASM sha256 mismatch. expected=${a.wasm.sha256} got=${wasmHash}`);
  fs.writeFileSync(wasmPath, wasmBytes);

  const zkeyBytes = await downloadStorage(a.zkey.bucket, a.zkey.key);
  const zkeyHash = sha256Hex(zkeyBytes);
  if (zkeyHash !== a.zkey.sha256) throw new Error(`ZKEY sha256 mismatch. expected=${a.zkey.sha256} got=${zkeyHash}`);
  fs.writeFileSync(zkeyPath, zkeyBytes);

  const vkeyBytes = await downloadStorage(a.vkey.bucket, a.vkey.key);
  const vkeyHash = sha256Hex(vkeyBytes);
  if (vkeyHash !== a.vkey.sha256) throw new Error(`VKEY sha256 mismatch. expected=${a.vkey.sha256} got=${vkeyHash}`);
  fs.writeFileSync(vkeyPath, vkeyBytes);

  return { wasmPath, zkeyPath, vkeyPath, buildDir };
}

function parseTxInfo(stdout) {
  const txMatch = stdout.match(/submitTally tx:\s*(0x[a-fA-F0-9]{64})/);
  const blockMatch = stdout.match(/confirmed in block:\s*([0-9]+)/);
  return {
    txHash: txMatch ? txMatch[1] : null,
    blockNumber: blockMatch ? Number(blockMatch[1]) : null,
  };
}



function run(cmd, args, opts = {}) {
  const capture = Boolean(opts.capture);
  const spawnOpts = { shell: process.platform === "win32", ...opts };
  delete spawnOpts.capture;

  const res = spawnSync(cmd, args, {
    ...spawnOpts,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: capture ? "utf-8" : undefined,
  });

  if (res.status !== 0) {
    const out = capture ? String(res.stdout ?? "") + String(res.stderr ?? "") : "";
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}${out ? `\n${out}` : ""}`);
  }

  if (capture) return String(res.stdout ?? "");
  return "";
}

async function processJob(job) {
  const electionId = job.election_id;
  const workDir = fs.mkdtempSync(path.join("/tmp", `bvzk-${electionId}-`));
  const witnessPath = path.join(workDir, "witness.json");
  const resultsPath = path.join(workDir, "results.json");

  // 1) Fetch witness (includes resultsHashField and circuitInputs)
  const witnessJson = await downloadWitness(electionId);
  fs.writeFileSync(witnessPath, witnessJson, "utf-8");

  // 2) Build results.json (human/machine verifiable)
  run("node", ["zk/scripts/build-results-json.ts", witnessPath, "--out", resultsPath], { cwd: "/app" });

  const resultsBytes = fs.readFileSync(resultsPath);
  const resultsKeyBase = `zk-results/${electionId}/${Date.now()}`;
  const resultsJsonUrl = await upload(RESULTS_BUCKET, `${resultsKeyBase}.json`, resultsBytes, "application/json");

  // 3) Ensure pinned circuit artifacts exist (downloaded from Storage via manifest)
const { manifest, manifest_hash } = await fetchManifest(electionId);
await ensureArtifactsOnDisk(electionId, manifest);

// 4) Prove (uses /app/zk/build/tally artifacts)
run("node", ["zk/scripts/prove-tally.ts", witnessPath, "--outDir", "/app/zk/build/tally"], { cwd: "/app" });

const proofPath = "/app/zk/build/tally/proof.json";
const publicPath = "/app/zk/build/tally/public.json";
// 5) Prepare submit args from witness + proof/public
  const submitArgsPath = path.join(workDir, "submitArgs.json");
  run("node", ["zk/scripts/prepare-tally-submit.ts", witnessPath, "--proof", proofPath, "--public", publicPath, "--out", submitArgsPath], { cwd: "/app" });

  // 6) Submit on-chain (Amoy) + confirm
  if (!REGISTRY_ADDRESS || !AMOY_RPC_URL || !SUBMITTER_PRIVATE_KEY) {
    throw new Error("Missing REGISTRY_ADDRESS / AMOY_RPC_URL / SUBMITTER_PRIVATE_KEY for on-chain submission");
  }

const submitStdout = run("npx", [
  "hardhat",
  "run",
  "scripts/submit-and-confirm-tally.ts",
  "--network",
  "amoy",
], {
  cwd: "/app/blockchain",
  capture: true,
  env: {
    ...process.env,
    REGISTRY_ADDRESS,
    AMOY_RPC_URL,
    PRIVATE_KEY: SUBMITTER_PRIVATE_KEY,
    SUBMIT_ARGS: submitArgsPath,
  },
});

const { txHash, blockNumber } = parseTxInfo(submitStdout);
if (!txHash) throw new Error(`Could not parse tx hash from submission output:\n${submitStdout}`);

// hardhat script waits for confirmation; we persist both "submitted" and (later) loop will mark confirmed.
await supabase.from("election_tally_proofs").update({
  status: "submitted",
  tx_hash: txHash,
  registry_address: REGISTRY_ADDRESS,
  updated_at: new Date().toISOString(),
  // block number is useful for audit even if we don't store it separately today
}).eq("election_id", electionId);

if (blockNumber != null) {
  // Keep a human-friendly breadcrumb in error_message-free form (optional); we don't have a column for block number.
  console.log(`Confirmed on-chain in block ${blockNumber}`);
};

  }

async function loop() {
  // simple loop
  for (;;) {
    const { data: jobs, error } = await supabase
      .from("election_tally_proofs")
      .select("*")
      .eq("status", "queued")
      .order("updated_at", { ascending: true })
      .limit(1);

    if (error) {
      console.error("queue fetch error:", error.message);
      await sleep(3000);
      continue;
    }

    const job = jobs?.[0];
    if (!job) {
      await sleep(2000);
      continue;
    }

    // claim
    const { data: claimed, error: claimErr } = await supabase
      .from("election_tally_proofs")
      .update({ status: "proving", updated_at: new Date().toISOString() })
      .eq("election_id", job.election_id)
      .eq("status", "queued")
      .select("*")
      .maybeSingle();

    if (claimErr || !claimed) continue;

    try {
      await processJob(claimed);
      await supabase.from("election_tally_proofs").update({
        status: "confirmed",
        updated_at: new Date().toISOString(),
      }).eq("election_id", claimed.election_id).eq("status", "submitted");
    } catch (e) {
      console.error("job failed:", e);
      await supabase.from("election_tally_proofs").update({
        status: "failed",
        error_message: String(e?.message ?? e),
        updated_at: new Date().toISOString(),
      }).eq("election_id", claimed.election_id).eq("status", "submitted");
    }
  }
}

loop().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
// Mark proved (proof artifacts persisted). Final PDF can be generated as "Draft" at this stage.
await supabase.from("election_tally_proofs").update({
  status: "proved",
  manifest_hash,
  results_json_url: resultsJsonUrl,
  proof_json_url: proofUrl,
  public_signals_json_url: publicUrl,
  updated_at: new Date().toISOString(),
}).eq("election_id", electionId);


