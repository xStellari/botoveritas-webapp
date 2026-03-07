#!/usr/bin/env node
/**
 * zk/scripts/format-tally-submit.ts
 *
 * Step 2.10 helper: Formats snarkjs outputs into calldata-ready args for
 * ElectionTallyRegistry.submitTally(...).
 *
 * Inputs:
 * - proof.json   (snarkjs groth16 prove output)
 * - public.json  (snarkjs public signals; MUST be [electionIdHash, electionVoteRoot, manifestHash, resultsHash] as decimal strings)
 *
 * Output:
 * - Prints a JSON object you can paste into an ethers call.
 *
 * Usage:
 *   node zk/scripts/format-tally-submit.ts --proof zk/build/tally/proof.json --public zk/build/tally/public.json --resultsUri "<uri>"
 *
 * Notes:
 * - This script converts public signals (field decimals) into bytes32 hex (0x padded 32 bytes)
 *   so they can be stored on-chain and match your registry ABI.
 * - Snarkjs proof points are rearranged to match the standard Solidity verifier ABI:
 *     a = [pi_a[0], pi_a[1]]
 *     b = [[pi_b[0][1], pi_b[0][0]], [pi_b[1][1], pi_b[1][0]]]
 *     c = [pi_c[0], pi_c[1]]
 */
import "dotenv/config";
import fs from "node:fs";
import "dotenv/config";

type SnarkProof = {
  pi_a: [string, string, string];
  pi_b: [[string, string, string], [string, string, string]];
  pi_c: [string, string, string];
  protocol?: string;
  curve?: string;
};

function parseArgs(argv: string[]) {
  const args: { proof?: string; public?: string; resultsUri?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--proof") args.proof = argv[++i];
    else if (a === "--public") args.public = argv[++i];
    else if (a === "--resultsUri") args.resultsUri = argv[++i];
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

function main() {
  const { proof, public: pub, resultsUri } = parseArgs(process.argv);
  if (!proof || !pub || !resultsUri) {
    console.error('Usage: format-tally-submit --proof <proof.json> --public <public.json> --resultsUri "<uri>"');
    process.exit(1);
  }

  const p = readJson<SnarkProof>(proof);
  const publicSignals = readJson<string[]>(pub);

  if (!Array.isArray(publicSignals) || publicSignals.length !== 4) {
    throw new Error("public.json must be an array of 4 decimal strings: [electionIdHash, electionVoteRoot, manifestHash, resultsHash]");
  }

  // Reorder proof for Solidity verifier ABI
  const a: [string, string] = [p.pi_a[0], p.pi_a[1]];

  const b: [[string, string], [string, string]] = [
    [p.pi_b[0][1], p.pi_b[0][0]],
    [p.pi_b[1][1], p.pi_b[1][0]],
  ];

  const c: [string, string] = [p.pi_c[0], p.pi_c[1]];

  // Convert public field elements to bytes32 hex for registry storage
  const electionIdHash = toBytes32Hex(toBigIntDec(publicSignals[0]));
  const electionVoteRoot = toBytes32Hex(toBigIntDec(publicSignals[1]));
  const manifestHash = toBytes32Hex(toBigIntDec(publicSignals[2]));
  const resultsHash = toBytes32Hex(toBigIntDec(publicSignals[3]));

  const out = {
    // Registry args
    electionIdHash,
    electionVoteRoot,
    manifestHash,
    resultsHash,
    resultsUri,

    // Proof args (Solidity verifier ABI)
    a,
    b,
    c,

    // Also include raw public signals (field decimals) for debugging
    publicSignals,
  };

  console.log(JSON.stringify(out, null, 2));
}

main();
