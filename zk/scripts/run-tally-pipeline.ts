#!/usr/bin/env node
/**
 * zk/scripts/run-tally-pipeline.ts
 *
 * Step 2.17: Dry-run (default) orchestrator for the full pipeline.
 *
 * Why:
 * - During demo/defense, you want a *single* place that shows the exact commands in order.
 * - This script does NOT force execution unless you pass --run.
 *
 * Usage (dry-run):
 *   node zk/scripts/run-tally-pipeline.ts --electionId <uuid> --witness <witness.json> --resultsOut results.json
 *
 * Usage (execute):
 *   PUBLIC_BASE_URL="https://<domain>" REGISTRY_ADDRESS=0x... VERIFIER_ADDRESS=0x... \
 *     node zk/scripts/run-tally-pipeline.ts --electionId <uuid> --witness <witness.json> --resultsOut results.json --run
 *
 * Notes:
 * - This script calls other scripts you already have (Steps 2.6 → 2.16).
 * - It is intentionally conservative and will stop if a command fails.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";

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
    electionId?: string;
    witness?: string;
    manifestSnapshot?: string;
    resultsOut?: string;
    run?: boolean;
  };
}

function run(cmd: string, args: string[], doRun: boolean) {
  const pretty = [cmd, ...args].join(" ");
  if (!doRun) {
    console.log("DRY:", pretty);
    return;
  }
  console.log("RUN:", pretty);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`Command failed: ${pretty}`);
}

function main() {
  const a = parseArgs(process.argv);
  if (!a.electionId) throw new Error("Missing --electionId <uuid>");
  if (!a.witness) throw new Error("Missing --witness <witness.json>");
  if (!a.resultsOut) throw new Error("Missing --resultsOut <results.json>");

  const doRun = !!a.run;

  console.log("=== BotoVeritas ZK Tally Pipeline ===");
  console.log(doRun ? "(EXECUTE MODE)" : "(DRY-RUN MODE)");

  // 1) Generate circuit from manifest
  run("node", ["zk/scripts/generate-tally-circuit.ts", "--electionId", a.electionId], doRun);

  // 2) Setup (compile + zkey + verifier.sol)
  run("node", ["zk/scripts/snarkjs-setup.ts"], doRun);

  // 3) Ensure resultsHashField exists in witness
  run("node", ["zk/scripts/compute-results-hash.ts", a.witness], doRun);

  // 4) Build canonical results.json
  const buildArgs = ["zk/scripts/build-results-json.ts", "--witness", a.witness, "--out", a.resultsOut];
  if (a.manifestSnapshot) buildArgs.push("--manifest", a.manifestSnapshot);
  run("node", buildArgs, doRun);

  // 5) Prove (proof.json + public.json)
  run("node", ["zk/scripts/prove-tally.ts", a.witness], doRun);

  // 6) Publish results.json to Vercel public folder (prints resultsUri)
  run("node", ["zk/scripts/publish-results-to-public.ts", "--in", a.resultsOut], doRun);

  // 7) Prepare submitArgs.json (publish + verify binding + format proof)
  run("node", [
    "zk/scripts/prepare-tally-submit.ts",
    "--witness", a.witness,
    "--proof", "zk/build/tally/proof.json",
    "--public", "zk/build/tally/public.json",
    "--results", a.resultsOut,
    "--publish",
    "--out", "submitArgs.json"
  ], doRun);

  console.log("\nNext manual actions (once per deployment):");
  console.log("- Promote verifier: node zk/scripts/promote-verifier-sol.ts");
  console.log("- Deploy verifier/registry: hardhat deploy scripts (Step 2.11)");
  console.log("- Submit tally: Step 2.15 submit-tally.ts");
  console.log("- Read & audit: Step 2.16 read-tally.ts + audit-tally-from-chain.ts");

  console.log("\nDone.");
}

main();
