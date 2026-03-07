#!/usr/bin/env node
/**
 * Build a canonical results.json payload for the universal tally circuit.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

type Meta = { maxPositions: number; maxCandidatesPerPosition: number };
type WitnessJson = { witness?: { publicInputs?: any; circuitInputs?: any; tally?: any } };
function parseArgs(argv: string[]) { const args: { witness?: string; out?: string } = {}; for (let i = 2; i < argv.length; i++) { const a = argv[i]; if (a === "--witness") args.witness = argv[++i]; else if (a === "--out") args.out = argv[++i]; } return args; }
function readJson<T>(p: string): T { return JSON.parse(fs.readFileSync(p, "utf8")) as T; }
function writeJson(p: string, v: unknown) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf8"); }
function toBigIntDec(x: string | number) { return BigInt(String(x).trim()); }
function toBytes32Hex(n: bigint) { let hex = n.toString(16); if (hex.length > 64) throw new Error(`Value too large for bytes32 (hex len=${hex.length})`); return `0x${hex.padStart(64, "0")}`; }

function main() {
  const { witness, out } = parseArgs(process.argv);
  if (!witness || !out) { console.error("Usage: build-results-json --witness <witness.json> --out <results.json>"); process.exit(1); }
  const meta = readJson<Meta>(path.join("zk", "circuits", "tally.meta.json"));
  const w = readJson<WitnessJson>(witness);
  const pub = w.witness?.publicInputs ?? {};
  const cir = w.witness?.circuitInputs ?? {};
  const tally = w.witness?.tally ?? {};
  if (!pub.electionIdHashField || !pub.electionVoteRootField || !pub.manifestHashField || !pub.resultsHashField) throw new Error("Missing witness.publicInputs.* fields");
  if (typeof cir.positionCount === "undefined" || !Array.isArray(cir.candidateCounts) || !Array.isArray(cir.abstain) || !Array.isArray(cir.tallies) || !Array.isArray(cir.foldVector)) throw new Error("Missing universal circuitInputs fields");
  const payload = {
    schema: "BV_RESULTS_JSON_V2",
    circuitVersion: "BV_TALLY_UNIVERSAL_V1",
    createdAt: new Date().toISOString(),
    anchors: {
      electionIdHashBytes32: toBytes32Hex(toBigIntDec(pub.electionIdHashField)),
      electionVoteRootBytes32: toBytes32Hex(toBigIntDec(pub.electionVoteRootField)),
      manifestHashBytes32: toBytes32Hex(toBigIntDec(pub.manifestHashField)),
      resultsHashBytes32: toBytes32Hex(toBigIntDec(pub.resultsHashField)),
    },
    publicSignalsFieldDecimals: [String(pub.electionIdHashField), String(pub.electionVoteRootField), String(pub.manifestHashField), String(pub.resultsHashField)],
    resultsCommitDomainField: String(pub.resultsCommitDomainField ?? "223344556"),
    tally: {
      positionCount: Number(cir.positionCount),
      candidateCounts: cir.candidateCounts.map((x: string | number) => String(x)),
      abstainCounts: cir.abstain.map((x: string | number) => String(x)),
      tallies: (cir.tallies as Array<Array<string | number>>).map((row) => row.map((x) => String(x))),
      positions: tally.positions ?? [],
      maxPositions: meta.maxPositions,
      maxCandidatesPerPosition: meta.maxCandidatesPerPosition,
    },
    foldVector: cir.foldVector.map((x: string | number) => String(x)),
  };
  writeJson(out, payload);
  console.log(`Wrote: ${out}`);
}
main();
