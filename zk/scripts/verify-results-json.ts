#!/usr/bin/env node
/**
 * zk/scripts/verify-results-json.ts
 *
 * Step 2.12: Offline verifier for results.json binding.
 *
 * Verifies that:
 * - results.json publicSignalsFieldDecimals[3] matches Poseidon-fold(domain,electionIdHash,root,manifestHash,foldVector)
 * - anchors.resultsHashBytes32 matches that computed hash
 *
 * Usage:
 *   node zk/scripts/verify-results-json.ts --results <results.json>
 *
 * Dependency:
 *   circomlibjs (runtime). Install once: npm i -D circomlibjs
 */

import fs from "node:fs";

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
  // optional: include domain if you want; otherwise we use the current constant
  resultsCommitDomainField?: string;
};

function parseArgs(argv: string[]) {
  const args: { results?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--results") args.results = argv[++i];
  }
  return args;
}

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function toBigIntDec(x: string): bigint {
  const s = String(x).trim();
  if (s.startsWith("0x")) return BigInt(s);
  return BigInt(s);
}

function toBytes32Hex(n: bigint): string {
  if (n < 0n) throw new Error("Cannot encode negative bigint as bytes32");
  let hex = n.toString(16);
  if (hex.length > 64) throw new Error(`Value too large for bytes32 (hex len=${hex.length})`);
  hex = hex.padStart(64, "0");
  return `0x${hex}`;
}

async function main() {
  const { results } = parseArgs(process.argv);
  if (!results) {
    console.error("Usage: verify-results-json --results <results.json>");
    process.exit(1);
  }

  const r = readJson<ResultsJson>(results);
  if (r.schema !== "BV_RESULTS_JSON_V1") throw new Error("Unsupported schema");

  const [electionIdHashField, rootField, manifestHashField, resultsHashField] = r.publicSignalsFieldDecimals;
  const foldVector = r.foldVector;

  // Lazy import for TS + runtime
  let poseidon: any;
  try {
    // @ts-ignore - circomlibjs may not ship TS types; runtime import is valid once installed.
    const circomlibjs: any = await import("circomlibjs");
    const poseidonFactory = circomlibjs.buildPoseidon;
    if (typeof poseidonFactory !== "function") throw new Error("circomlibjs.buildPoseidon not found");
    poseidon = await poseidonFactory();
  } catch (e) {
    console.error("Missing dependency: circomlibjs");
    console.error("Install: npm i -D circomlibjs");
    throw e;
  }

  // Must match the circuit generator constant (BV_TALLY_RESULT_COMMIT_V1)
  const domain = toBigIntDec(r.resultsCommitDomainField ?? "123456789");

  let h: bigint = BigInt(poseidon([domain, toBigIntDec(electionIdHashField)]));
  h = BigInt(poseidon([h, toBigIntDec(rootField)]));
  h = BigInt(poseidon([h, toBigIntDec(manifestHashField)]));

  for (const v of foldVector) {
    h = BigInt(poseidon([h, toBigIntDec(v)]));
  }

  const computedField = h.toString(10);
  const computedBytes32 = toBytes32Hex(h);

  const okField = computedField === String(resultsHashField);
  const okBytes32 = computedBytes32.toLowerCase() === r.anchors.resultsHashBytes32.toLowerCase();

  if (!okField || !okBytes32) {
    console.error("❌ Results binding FAILED");
    console.error("computed resultsHashField:", computedField);
    console.error("claimed   resultsHashField:", resultsHashField);
    console.error("computed resultsHashBytes32:", computedBytes32);
    console.error("claimed   resultsHashBytes32:", r.anchors.resultsHashBytes32);
    process.exit(1);
  }

  console.log("✅ Results binding OK");
  console.log("resultsHashField:", computedField);
  console.log("resultsHashBytes32:", computedBytes32);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
