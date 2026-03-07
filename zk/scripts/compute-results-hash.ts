#!/usr/bin/env node
/**
 * Production-safe results hash computation matching the universal tally circuit.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
// @ts-ignore
import { buildPoseidon } from "circomlibjs";

type WitnessJson = {
  witness?: {
    publicInputs?: Record<string, any>;
    circuitInputs?: {
      foldVector?: any[];
      positionCount?: any;
      candidateCounts?: any[];
      abstain?: any[];
      tallies?: any[][];
      countsByPosition?: any[][];
    };
  };
};

const RESULTS_COMMIT_DOMAIN = 223344556n;
const MAX_POSITIONS = 20;
const MAX_CANDIDATES = 5;

function parseArgs(argv: string[]) {
  const args: { file?: string; out?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!args.file && !a.startsWith("--")) args.file = a;
    else if (a === "--out") args.out = argv[++i];
  }
  return args;
}

function readJson<T>(p: string): T { return JSON.parse(fs.readFileSync(p, "utf8")) as T; }
function writeJson(p: string, v: unknown) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf8"); }
function bytesToBigIntBE(bytes: Uint8Array): bigint { const hex = Buffer.from(bytes).toString("hex"); return BigInt("0x" + (hex.length ? hex : "00")); }
function toBigIntAny(x: any): bigint { if (typeof x === "bigint") return x; if (typeof x === "number") return BigInt(x); if (typeof x === "string") { const s = x.trim(); return BigInt(s.startsWith("0x") || s.startsWith("0X") ? s : s); } if (x instanceof Uint8Array) return bytesToBigIntBE(x); if (Array.isArray(x)) return bytesToBigIntBE(Uint8Array.from(x.map(Number))); return BigInt(String(x)); }
function toBytes32Hex(n: bigint): string { let hex = n.toString(16); if (hex.length > 64) hex = hex.slice(-64); return "0x" + hex.padStart(64, "0"); }

function buildUniversalFoldVector(cir: NonNullable<WitnessJson['witness']>['circuitInputs']) {
  const positionCount = toBigIntAny(cir?.positionCount ?? 0).toString(10);
  const candidateCounts = Array.isArray(cir?.candidateCounts) ? cir!.candidateCounts : [];
  const abstain = Array.isArray(cir?.abstain) ? cir!.abstain : [];
  const tallies = Array.isArray(cir?.tallies) ? cir!.tallies : [];
  const out: bigint[] = [toBigIntAny(positionCount)];
  for (let i = 0; i < MAX_POSITIONS; i++) out.push(toBigIntAny(candidateCounts[i] ?? 0));
  for (let i = 0; i < MAX_POSITIONS; i++) out.push(toBigIntAny(abstain[i] ?? 0));
  for (let i = 0; i < MAX_POSITIONS; i++) {
    const row = Array.isArray(tallies[i]) ? tallies[i] : [];
    for (let j = 0; j < MAX_CANDIDATES; j++) out.push(toBigIntAny(row[j] ?? 0));
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error("Usage: npx tsx zk/scripts/compute-results-hash.ts <witness.json> --out <out.json>");
    process.exit(2);
  }

  const inputPath = path.resolve(args.file);
  const outPath = path.resolve(args.out ?? inputPath);
  const w = readJson<WitnessJson>(inputPath);
  const pub = w.witness?.publicInputs ?? {};
  const cir = w.witness?.circuitInputs ?? {};

  const electionIdHash = toBigIntAny(pub.electionIdHashField);
  const root = toBigIntAny(pub.electionVoteRootField);
  const manifestHash = toBigIntAny(pub.manifestHashField);

  let foldVector: bigint[] = [];
  if (Array.isArray(cir.foldVector) && cir.foldVector.length) {
    foldVector = cir.foldVector.map(toBigIntAny);
  } else if (typeof cir.positionCount !== "undefined" && Array.isArray(cir.candidateCounts) && Array.isArray(cir.abstain) && Array.isArray(cir.tallies)) {
    foldVector = buildUniversalFoldVector(cir);
  } else if (Array.isArray(cir.abstain) && Array.isArray(cir.countsByPosition)) {
    for (let i = 0; i < cir.abstain.length; i++) {
      foldVector.push(toBigIntAny(cir.abstain[i]));
      for (const c of cir.countsByPosition[i] ?? []) foldVector.push(toBigIntAny(c));
    }
  } else {
    throw new Error("Missing foldVector or universal tally vectors in witness JSON");
  }

  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const pose2 = (a: bigint, b: bigint): bigint => F.toObject(poseidon([a, b])) as bigint;

  let h = pose2(RESULTS_COMMIT_DOMAIN, electionIdHash);
  h = pose2(h, root);
  h = pose2(h, manifestHash);
  for (const x of foldVector) h = pose2(h, x);

  w.witness = w.witness ?? {};
  w.witness.publicInputs = w.witness.publicInputs ?? {};
  w.witness.publicInputs.resultsCommitDomainField = RESULTS_COMMIT_DOMAIN.toString(10);
  w.witness.publicInputs.resultsHashField = h.toString(10);
  if (!Array.isArray(w.witness.circuitInputs?.foldVector)) {
    w.witness.circuitInputs = w.witness.circuitInputs ?? {};
    w.witness.circuitInputs.foldVector = foldVector.map((x) => x.toString(10));
  }

  console.log("resultsHashField:", h.toString(10));
  console.log("resultsHashBytes32:", toBytes32Hex(h));
  writeJson(outPath, w);
  console.log("Wrote:", outPath);
}

main().catch((e) => { console.error(e); process.exit(1); });
