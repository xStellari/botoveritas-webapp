#!/usr/bin/env node
/**
 * zk/scripts/run-tally-pipeline.ts
 *
 * End-to-end orchestrator for the zk tally pipeline.
 * Default mode is dry-run; pass --run to execute.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

type ParsedArgs = {
  electionId?: string;
  witness?: string;
  manifestSnapshot?: string;
  resultsOut?: string;
  run?: boolean;
  setupForce?: boolean;
  publish?: boolean;
  publicBaseUrl?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

function parseArgs(argv: string[]): ParsedArgs {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args as ParsedArgs;
}

function resolveTsNodeEsm(): string {
  const binName = process.platform === "win32" ? "ts-node-esm.cmd" : "ts-node-esm";
  const candidates = [
    path.join(ROOT, "blockchain", "node_modules", ".bin", binName),
    path.join(ROOT, "zk", "node_modules", ".bin", binName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`Missing ${binName}. Install dependencies in blockchain or zk first.`);
}

function runTsScript(scriptRelativePath: string, args: string[], doRun: boolean): void {
  const runner = resolveTsNodeEsm();
  const scriptPath = path.join(ROOT, scriptRelativePath);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Missing script: ${scriptPath}`);
  }

  const pretty = [path.relative(ROOT, runner), path.relative(ROOT, scriptPath), ...args].join(" ");

  if (!doRun) {
    console.log("DRY:", pretty);
    return;
  }

  console.log("RUN:", pretty);
  const result = spawnSync(runner, [scriptPath, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed: ${pretty}`);
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.electionId) throw new Error("Missing --electionId <uuid>");
  if (!args.witness) throw new Error("Missing --witness <witness.json>");
  if (!args.resultsOut) throw new Error("Missing --resultsOut <results.json>");

  const doRun = Boolean(args.run);

  console.log("=== BotoVeritas ZK Tally Pipeline ===");
  console.log(doRun ? "(EXECUTE MODE)" : "(DRY-RUN MODE)");

  runTsScript(path.join("zk", "scripts", "generate-tally-circuit.ts"), ["--electionId", args.electionId], doRun);

  const setupArgs = args.setupForce ? ["--force"] : [];
  runTsScript(path.join("zk", "scripts", "snarkjs-setup.ts"), setupArgs, doRun);

  runTsScript(path.join("zk", "scripts", "compute-results-hash.ts"), [args.witness], doRun);

  const buildArgs = ["--witness", args.witness, "--out", args.resultsOut];
  if (args.manifestSnapshot) buildArgs.push("--manifest", args.manifestSnapshot);
  runTsScript(path.join("zk", "scripts", "build-results-json.ts"), buildArgs, doRun);

  runTsScript(path.join("zk", "scripts", "prove-tally.ts"), [args.witness], doRun);

  if (args.publish) {
    runTsScript(path.join("zk", "scripts", "publish-results-to-public.ts"), ["--in", args.resultsOut], doRun);
  }

  const prepareArgs = [
    "--witness", args.witness,
    "--proof", path.join("zk", "build", "tally", "proof.json"),
    "--public", path.join("zk", "build", "tally", "publicSignals.json"),
    "--results", args.resultsOut,
    "--out", "submitArgs.json",
  ];
  if (args.publish) prepareArgs.push("--publish");
  if (args.publicBaseUrl) {
    process.env.PUBLIC_BASE_URL = args.publicBaseUrl;
  }
  runTsScript(path.join("zk", "scripts", "prepare-tally-submit.ts"), prepareArgs, doRun);

  console.log("\nNext manual actions (once per deployment):");
  console.log("- Promote verifier: ts-node-esm zk/scripts/promote-verifier-sol.ts");
  console.log("- Deploy verifier/registry: blockchain/scripts/deploy-zk-stack.ts");
  console.log("- Submit tally: blockchain/scripts/submit-tally.ts");
  console.log("- Read & audit: blockchain/scripts/read-tally.ts + zk/scripts/audit-tally-from-chain.ts");
  console.log("\nDone.");
}

main();
