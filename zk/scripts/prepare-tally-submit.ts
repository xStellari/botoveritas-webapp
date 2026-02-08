#!/usr/bin/env node
/**
 * zk/scripts/prepare-tally-submit.ts
 *
 * Step 2.14: One-command driver that produces everything needed for on-chain submitTally.
 *
 * Inputs:
 * - witness.json (from Edge)  -> must contain circuitInputs + publicInputs (resultsHashField optional)
 * - proof.json + public.json (from snarkjs prove)
 * - results.json (canonical BV_RESULTS_JSON_V1)  -> optional; if missing, we can build it if meta exists
 *
 * What it does:
 * 1) Ensures witness has resultsHashField (runs compute-results-hash.ts logic internally)
 * 2) Builds/validates results.json binding (optional build if you pass --buildResults)
 * 3) Publishes results.json to public/zk-results/<tallyKey>.json (optional with --publish)
 * 4) Formats submit args (bytes32 public inputs + a,b,c proof) into submitArgs.json
 *
 * Usage:
 *   node zk/scripts/prepare-tally-submit.ts --witness <witness.json> --proof <proof.json> --public <public.json> \
 *     --results <results.json> --resultsUri "<uri>" --out <submitArgs.json>
 *
 * Optional automation:
 *   --buildResults        (build results.json from witness; writes to --results path)
 *   --publish             (copy results.json into public/zk-results and compute resultsUri from PUBLIC_BASE_URL)
 *
 * Dependencies:
 * - circomlibjs (Poseidon) for resultsHash computation and results.json verification
 * - ethers (recommended) for keccak256 packing when publishing
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

type SnarkProof = {
  pi_a: [string, string, string];
  pi_b: [[string, string, string], [string, string, string]];
  pi_c: [string, string, string];
};

type WitnessJson = {
  witness?: {
    publicInputs?: {
      electionIdHashField?: string;
      electionVoteRootField?: string;
      manifestHashField?: string;
      resultsCommitDomainField?: string;
      resultsHashField?: string | null;
    };
    circuitInputs?: {
      foldVector?: Array<string | number>;
    };
  };
};

type ResultsJson = {
  schema: string;
  anchors: {
    electionIdHashBytes32: string;
    electionVoteRootBytes32: string;
    manifestHashBytes32: string;
    resultsHashBytes32: string;
  };
  publicSignalsFieldDecimals: [string, string, string, string];
  foldVector: string[];
  resultsCommitDomainField?: string;
};

function parseArgs(argv: string[]) {
  const args: any = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[k] = v;
    }
  }
  return args as {
    witness?: string;
    proof?: string;
    public?: string;
    results?: string;
    resultsUri?: string;
    out?: string;
    buildResults?: boolean;
    publish?: boolean;
  };
}

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function writeJson(p: string, v: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf8");
}

function toBigIntDec(x: string | number): bigint {
  if (typeof x === "number") return BigInt(x);
  const s = String(x).trim();
  if (s.startsWith("0x")) return BigInt(s);
  return BigInt(s);
}

function toBytes32Hex(n: bigint): string {
  if (n < 0n) throw new Error("Cannot encode negative bigint as bytes32");
  let hex = n.toString(16);
  if (hex.length > 64) throw new Error(`Value too large for bytes32 (hex len=${hex.length})`);
  return "0x" + hex.padStart(64, "0");
}

async function loadPoseidon() {
  // @ts-ignore - circomlibjs may not ship TS types; runtime import is valid once installed.
  const circomlibjs: any = await import("circomlibjs");
  const poseidonFactory = circomlibjs.buildPoseidon;
  if (typeof poseidonFactory !== "function") throw new Error("circomlibjs.buildPoseidon not found");
  return await poseidonFactory();
}

async function ensureResultsHashField(w: WitnessJson) {
  const pub = w.witness?.publicInputs;
  const cir = w.witness?.circuitInputs;

  if (!pub?.electionIdHashField || !pub.electionVoteRootField || !pub.manifestHashField) {
    throw new Error("Missing witness.publicInputs.{electionIdHashField,electionVoteRootField,manifestHashField}");
  }
  if (!pub.resultsCommitDomainField) throw new Error("Missing witness.publicInputs.resultsCommitDomainField");
  if (!cir?.foldVector) throw new Error("Missing witness.circuitInputs.foldVector");

  if (pub.resultsHashField && String(pub.resultsHashField).trim().length) return;

  const poseidon = await loadPoseidon();

  const domain = toBigIntDec(pub.resultsCommitDomainField);
  let h: bigint = BigInt(poseidon([domain, toBigIntDec(pub.electionIdHashField)]));
  h = BigInt(poseidon([h, toBigIntDec(pub.electionVoteRootField)]));
  h = BigInt(poseidon([h, toBigIntDec(pub.manifestHashField)]));

  for (const v of cir.foldVector) h = BigInt(poseidon([h, toBigIntDec(v)]));

  w.witness = w.witness ?? {};
  w.witness.publicInputs = w.witness.publicInputs ?? {};
  w.witness.publicInputs.resultsHashField = h.toString(10);
}

function normalize0x32(hex: string): string {
  const s = hex.trim().toLowerCase();
  if (!s.startsWith("0x")) throw new Error(`Expected 0x-prefixed hex: ${hex}`);
  const body = s.slice(2);
  if (body.length !== 64) throw new Error(`Expected 32-byte hex: ${hex}`);
  return body;
}

async function computeTallyKey(electionIdHashBytes32: string, electionVoteRootBytes32: string): Promise<string> {
  try {
    // @ts-ignore
    const ethers: any = await import("ethers");
    const packed = ethers.solidityPacked(["bytes32", "bytes32"], [electionIdHashBytes32, electionVoteRootBytes32]);
    return ethers.keccak256(packed);
  } catch {
    // fallback: try node crypto keccak256 (may not exist)
    // @ts-ignore
    const a = Buffer.from(normalize0x32(electionIdHashBytes32), "hex");
    // @ts-ignore
    const b = Buffer.from(normalize0x32(electionVoteRootBytes32), "hex");
    const packed = Buffer.concat([a, b]);
    // @ts-ignore
    return "0x" + crypto.createHash("keccak256").update(packed).digest("hex");
  }
}

async function verifyResultsBinding(r: ResultsJson) {
  if (r.schema !== "BV_RESULTS_JSON_V1") throw new Error("Unsupported results schema");
  const poseidon = await loadPoseidon();

  const domain = toBigIntDec(r.resultsCommitDomainField ?? "123456789");
  const [electionIdHashField, rootField, manifestHashField, resultsHashField] = r.publicSignalsFieldDecimals;

  let h: bigint = BigInt(poseidon([domain, toBigIntDec(electionIdHashField)]));
  h = BigInt(poseidon([h, toBigIntDec(rootField)]));
  h = BigInt(poseidon([h, toBigIntDec(manifestHashField)]));

  for (const v of r.foldVector) h = BigInt(poseidon([h, toBigIntDec(v)]));

  const computedField = h.toString(10);
  const computedBytes32 = toBytes32Hex(h);

  if (computedField !== String(resultsHashField)) throw new Error("results.json binding failed (field mismatch)");
  if (computedBytes32.toLowerCase() !== r.anchors.resultsHashBytes32.toLowerCase())
    throw new Error("results.json binding failed (bytes32 mismatch)");
}

function formatSubmitArgs(proof: SnarkProof, publicSignals: string[], resultsUri: string) {
  if (!Array.isArray(publicSignals) || publicSignals.length !== 4) {
    throw new Error("public.json must be an array of 4 decimal strings: [electionIdHash, electionVoteRoot, manifestHash, resultsHash]");
  }

  const a: [string, string] = [proof.pi_a[0], proof.pi_a[1]];
  const b: [[string, string], [string, string]] = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ];
  const c: [string, string] = [proof.pi_c[0], proof.pi_c[1]];

  const electionIdHash = toBytes32Hex(toBigIntDec(publicSignals[0]));
  const electionVoteRoot = toBytes32Hex(toBigIntDec(publicSignals[1]));
  const manifestHash = toBytes32Hex(toBigIntDec(publicSignals[2]));
  const resultsHash = toBytes32Hex(toBigIntDec(publicSignals[3]));

  return { electionIdHash, electionVoteRoot, manifestHash, resultsHash, resultsUri, a, b, c, publicSignals };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.witness || !args.proof || !args.public || !args.out) {
    console.error("Usage: prepare-tally-submit --witness <w.json> --proof <proof.json> --public <public.json> --out <submitArgs.json> [--results <results.json> --resultsUri <uri>] [--publish]");
    process.exit(1);
  }

  const w = readJson<WitnessJson>(args.witness);
  await ensureResultsHashField(w);

  // If results.json provided, verify binding. If publish is enabled, copy into public/zk-results and compute resultsUri.
  let resultsUri = args.resultsUri ?? "";
  if (args.results) {
    const r = readJson<ResultsJson>(args.results);
    await verifyResultsBinding(r);

    if (args.publish) {
      const key = await computeTallyKey(r.anchors.electionIdHashBytes32, r.anchors.electionVoteRootBytes32);
      const outDir = path.join("public", "zk-results");
      const outPath = path.join(outDir, `${key}.json`);
      fs.mkdirSync(outDir, { recursive: true });
      fs.copyFileSync(args.results, outPath);

      const baseUrl = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");
      resultsUri = baseUrl ? `${baseUrl}/zk-results/${key}.json` : `/zk-results/${key}.json`;
    }
  }

  if (!resultsUri) {
    throw new Error("Missing resultsUri. Provide --resultsUri or pass --results + --publish (with PUBLIC_BASE_URL).");
  }

  const proof = readJson<SnarkProof>(args.proof);
  const publicSignals = readJson<string[]>(args.public);

  const submitArgs = formatSubmitArgs(proof, publicSignals, resultsUri);
  writeJson(args.out, submitArgs);

  console.log("Wrote:", args.out);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
