/**
 * zk/scripts/prove-tally.ts
 *
 * Generates a proof for the universal tally circuit.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type WitnessFile = {
  witness?: {
    publicInputs?: {
      electionIdHashField?: string | number;
      electionVoteRootField?: string | number;
      manifestHashField?: string | number;
      resultsHashField?: string | number;
    };
    circuitInputs?: {
      positionCount?: string | number;
      candidateCounts?: (string | number)[];
      abstain?: (string | number)[];
      tallies?: (string | number)[][];
    };
  };
};

function resolveSnarkJS(repoRoot: string) { return process.platform === "win32" ? path.join(repoRoot, "node_modules", ".bin", "snarkjs.cmd") : path.join(repoRoot, "node_modules", ".bin", "snarkjs"); }
function run(cmd: string, args: string[]) { const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" }); if (r.error) { console.error("Spawn error:", r.error); process.exit(1);} if (r.status !== 0) { console.error(`Command failed: ${cmd} ${args.join(" ")}`); process.exit(r.status ?? 1);} }

function main() {
  const witnessFile = process.argv[2];
  if (!witnessFile) { console.error("Usage: npx tsx zk/scripts/prove-tally.ts <witness.json>"); process.exit(1); }
  const repoRoot = process.cwd();
  const buildDir = path.join(repoRoot, "zk", "build", "tally");
  const snarkjs = resolveSnarkJS(repoRoot);
  const wasm = path.join(buildDir, "tally_js", "tally.wasm");
  const zkey = path.join(buildDir, "tally_final.zkey");
  const inputJson = path.join(buildDir, "input.json");
  const witnessWtns = path.join(buildDir, "witness.wtns");
  const proofJson = path.join(buildDir, "proof.json");
  const publicJson = path.join(buildDir, "publicSignals.json");
  if (!fs.existsSync(witnessFile)) { console.error("Witness file not found:", witnessFile); process.exit(1); }
  const witnessData: WitnessFile = JSON.parse(fs.readFileSync(witnessFile, "utf8"));
  const pub = witnessData.witness?.publicInputs;
  const cir = witnessData.witness?.circuitInputs;
  if (!pub || !cir) { console.error("Invalid witness structure."); process.exit(1); }
  if (!pub.resultsHashField) { console.error("resultsHashField missing. Run compute-results-hash.ts first."); process.exit(1); }
  const input: Record<string, unknown> = {
    electionIdHash: pub.electionIdHashField,
    electionVoteRoot: pub.electionVoteRootField,
    manifestHash: pub.manifestHashField,
    resultsHash: pub.resultsHashField,
    positionCount: cir.positionCount ?? 0,
    candidateCounts: cir.candidateCounts ?? [],
    abstain: cir.abstain ?? [],
    tallies: cir.tallies ?? [],
  };
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(inputJson, JSON.stringify(input, null, 2));
  console.log("\n[1/3] Calculating witness...");
  run(snarkjs, ["wtns", "calculate", wasm, inputJson, witnessWtns]);
  console.log("\n[2/3] Generating Groth16 proof...");
  run(snarkjs, ["groth16", "prove", zkey, witnessWtns, proofJson, publicJson]);
  console.log("\n[3/3] Proof created:");
  console.log("  proof:", proofJson);
  console.log("  publicSignals:", publicJson);
}

main();
