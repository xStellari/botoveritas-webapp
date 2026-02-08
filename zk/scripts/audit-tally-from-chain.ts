#!/usr/bin/env node
/**
 * zk/scripts/audit-tally-from-chain.ts
 *
 * Step 2.16: End-to-end audit helper.
 * Given:
 * - on-chain anchors (manifestHash/resultsHash/electionVoteRoot/electionIdHash)
 * - a local results.json
 * It verifies:
 * 1) results.json binding (Poseidon fold) matches resultsHash
 * 2) results.json anchors match the on-chain anchors exactly
 *
 * Usage:
 *   node zk/scripts/audit-tally-from-chain.ts --results results.json \
 *     --electionIdHash 0x.. --electionVoteRoot 0x.. --manifestHash 0x.. --resultsHash 0x..
 *
 * Dependency: circomlibjs (Poseidon). Install once: npm i -D circomlibjs
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
    results?: string;
    electionIdHash?: string;
    electionVoteRoot?: string;
    manifestHash?: string;
    resultsHash?: string;
  };
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
  return "0x" + hex.padStart(64, "0");
}

async function loadPoseidon() {
  // @ts-ignore - circomlibjs may not ship TS types; runtime import is valid once installed.
  const circomlibjs: any = await import("circomlibjs");
  const poseidonFactory = circomlibjs.buildPoseidon;
  if (typeof poseidonFactory !== "function") throw new Error("circomlibjs.buildPoseidon not found");
  return await poseidonFactory();
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

function eq32(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.results) throw new Error("Missing --results results.json");
  if (!args.electionIdHash || !args.electionVoteRoot || !args.manifestHash || !args.resultsHash) {
    throw new Error("Missing one of: --electionIdHash --electionVoteRoot --manifestHash --resultsHash");
  }

  const r = readJson<ResultsJson>(args.results);

  // 1) Check anchors match on-chain
  if (!eq32(r.anchors.electionIdHashBytes32, args.electionIdHash)) throw new Error("Anchor mismatch: electionIdHash");
  if (!eq32(r.anchors.electionVoteRootBytes32, args.electionVoteRoot)) throw new Error("Anchor mismatch: electionVoteRoot");
  if (!eq32(r.anchors.manifestHashBytes32, args.manifestHash)) throw new Error("Anchor mismatch: manifestHash");
  if (!eq32(r.anchors.resultsHashBytes32, args.resultsHash)) throw new Error("Anchor mismatch: resultsHash");

  // 2) Check Poseidon binding => resultsHash
  await verifyResultsBinding(r);

  console.log("✅ Audit OK");
  console.log("Anchors match chain AND results.json binds to resultsHash.");
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
