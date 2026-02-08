#!/usr/bin/env node
/**
 * zk/scripts/compute-results-hash.ts
 *
 * Computes the Poseidon-fold `resultsHashField` that must match the constraint in
 * zk/circuits/tally.circom (BV_TALLY_RESULT_COMMIT_V1).
 *
 * Input: a witness JSON produced by the Edge Function `generate-zk-tally-witness`
 * (Step 2.7), containing:
 *   witness.publicInputs.{electionIdHashField,electionVoteRootField,manifestHashField,resultsCommitDomainField}
 *   witness.circuitInputs.foldVector[]
 *
 * Output:
 *  - prints:
 *      resultsHashField (decimal string)
 *      resultsHashBytes32 (0x.. 32-byte hex; uint256 padded)
 *  - writes an updated witness json with witness.publicInputs.resultsHashField filled in
 *    (unless --dryRun)
 *
 * Usage:
 *   node zk/scripts/compute-results-hash.ts <witness.json> [--out <out.json>] [--dryRun]
 *
 * Notes:
 * - Requires dependency: circomlibjs (Poseidon implementation)
 *   Install (once): npm i -D circomlibjs
 */

import fs from "node:fs";
import path from "node:path";

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

function parseArgs(argv: string[]) {
  const args: { file?: string; out?: string; dryRun?: boolean } = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!args.file && !a.startsWith("--")) args.file = a;
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--dryRun") args.dryRun = true;
  }
  return args;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
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
  hex = hex.padStart(64, "0");
  return `0x${hex}`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error("Usage: compute-results-hash <witness.json> [--out <out.json>] [--dryRun]");
    process.exit(1);
  }

  const data = readJson<WitnessJson>(args.file);

  const pub = data.witness?.publicInputs;
  const cir = data.witness?.circuitInputs;

  if (!pub?.electionIdHashField || !pub.electionVoteRootField || !pub.manifestHashField) {
    throw new Error("Missing witness.publicInputs.{electionIdHashField,electionVoteRootField,manifestHashField}");
  }
  if (!pub.resultsCommitDomainField) {
    throw new Error("Missing witness.publicInputs.resultsCommitDomainField");
  }
  if (!cir?.foldVector || !Array.isArray(cir.foldVector)) {
    throw new Error("Missing witness.circuitInputs.foldVector[]");
  }

  // Lazy import so the script can show a helpful error if dependency is missing.
  let poseidon: any;
  try {
    // @ts-ignore - circomlibjs has no bundled TS types; runtime import is valid once installed.
    const circomlibjs: any = await import("circomlibjs");
    const poseidonFactory = circomlibjs.buildPoseidon;
    if (typeof poseidonFactory !== "function") throw new Error("circomlibjs.buildPoseidon not found");
    poseidon = await poseidonFactory();
  } catch (e) {
    console.error("Missing dependency: circomlibjs");
    console.error("Install: npm i -D circomlibjs");
    throw e;
  }

  const domain = toBigIntDec(pub.resultsCommitDomainField);
  const electionIdHash = toBigIntDec(pub.electionIdHashField);
  const root = toBigIntDec(pub.electionVoteRootField);
  const manifestHash = toBigIntDec(pub.manifestHashField);

  // Poseidon fold: h = Poseidon(domain, electionIdHash) -> Poseidon(h, root) -> Poseidon(h, manifestHash)
  let h: bigint = BigInt(poseidon([domain, electionIdHash]));
  h = BigInt(poseidon([h, root]));
  h = BigInt(poseidon([h, manifestHash]));

  for (const v of cir.foldVector) {
    const x = toBigIntDec(v);
    h = BigInt(poseidon([h, x]));
  }

  const resultsHashField = h.toString(10);
  const resultsHashBytes32 = toBytes32Hex(h);

  console.log(`resultsHashField:   ${resultsHashField}`);
  console.log(`resultsHashBytes32: ${resultsHashBytes32}`);

  // Patch output unless dry-run
  if (!args.dryRun) {
    const outPath = args.out ?? args.file;
    data.witness = data.witness ?? {};
    data.witness.publicInputs = data.witness.publicInputs ?? {};
    data.witness.publicInputs.resultsHashField = resultsHashField;
    writeJson(outPath, data);
    console.log(`Patched witness written: ${outPath}`);
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});