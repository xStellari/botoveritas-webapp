#!/usr/bin/env node
/**
 * zk/scripts/snarkjs-setup.ts
 *
 * Step 2.9: Compile the Circom circuit and create Groth16 setup artifacts.
 *
 * This script is intentionally automation-friendly but SAFE:
 * - It refuses to overwrite existing critical artifacts unless --force is provided.
 * - It requires you to have generated zk/circuits/tally.circom + tally.meta.json (via generator).
 *
 * Outputs (default):
 *   zk/build/tally/
 *     - tally.r1cs
 *     - tally.wasm
 *     - tally.sym
 *     - pot12_final.ptau
 *     - tally_0000.zkey (initial)
 *     - tally_final.zkey
 *     - verification_key.json
 *     - verifier.sol (snarkjs-generated)
 *
 * Requirements:
 * - circom installed (or set CIRCOM_BIN)
 * - snarkjs available (npx snarkjs works)
 *
 * Usage:
 *   node zk/scripts/snarkjs-setup.ts
 *   node zk/scripts/snarkjs-setup.ts --force
 *
 * Optional env:
 *   CIRCOM_BIN=circom
 *   ZK_ENTROPY="your-entropy-string"   (recommended; otherwise auto-generated)
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

const ROOT = process.cwd();
const CIRCUIT_PATH = path.join(ROOT, "zk", "circuits", "tally.circom");
const META_PATH = path.join(ROOT, "zk", "circuits", "tally.meta.json");
const BUILD_DIR = path.join(ROOT, "zk", "build", "tally");

function resolveCmd(cmd: string): string {
  // On Windows, "npx" is typically "npx.cmd". Using shell=true causes quoting issues
  // with paths that contain spaces, so we avoid shell execution and resolve the cmd.
  if (process.platform === "win32" && cmd.toLowerCase() === "npx") return "npx.cmd";
  return cmd;
}

function run(cmd: string, args: string[], opts?: { cwd?: string }) {
  const resolved = resolveCmd(cmd);
  const res = spawnSync(resolved, args, {
    stdio: "inherit",
    cwd: opts?.cwd ?? ROOT,
    shell: false,
  });
  if (res.status !== 0) {
    throw new Error(`Command failed: ${resolved} ${args.join(" ")}`);
  }
}

function exists(p: string) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function parseArgs(argv: string[]) {
  return { force: argv.includes("--force") };
}

function safeWriteGuard(target: string, force: boolean) {
  if (exists(target) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${target}. Re-run with --force if intentional.`
    );
  }
}

function getEntropy(): string {
  const fromEnv = process.env.ZK_ENTROPY;
  if (fromEnv && fromEnv.trim().length >= 16) return fromEnv.trim();
  // Auto entropy: OK for dev/test. For final demo, provide ZK_ENTROPY explicitly.
  return `BV_AUTO_ENTROPY_${new Date().toISOString()}_${crypto.randomBytes(16).toString("hex")}`;
}

async function main() {
  const { force } = parseArgs(process.argv);

  if (!exists(CIRCUIT_PATH)) throw new Error(`Missing circuit: ${CIRCUIT_PATH}. Run generator first.`);
  if (!exists(META_PATH)) throw new Error(`Missing meta: ${META_PATH}. Run generator first.`);

  ensureDir(BUILD_DIR);

  const circomBin = process.env.CIRCOM_BIN ?? "circom";

  // Compile circuit
  const r1cs = path.join(BUILD_DIR, "tally.r1cs");
  const wasmDir = path.join(BUILD_DIR, "tally_js");
  const wasm = path.join(wasmDir, "tally.wasm");
  const sym = path.join(BUILD_DIR, "tally.sym");

  safeWriteGuard(r1cs, force);
  safeWriteGuard(sym, force);

  console.log("\n[1/4] Compiling circuit with circom…");
  run(circomBin, [CIRCUIT_PATH, "--r1cs", "--wasm", "--sym", "-o", BUILD_DIR]);

  if (!exists(wasm)) {
    throw new Error(`Expected wasm not found: ${wasm}. Check circom output.`);
  }

  // Powers of Tau (phase 1) — dev-local ceremony (bn128).
  // Power 12 supports up to ~4096 constraints; increase if your circuit grows.
  const ptau0 = path.join(BUILD_DIR, "pot12_0000.ptau");
  const ptau1 = path.join(BUILD_DIR, "pot12_0001.ptau");
  const ptauFinal = path.join(BUILD_DIR, "pot12_final.ptau");

  if (!exists(ptauFinal)) {
    console.log("\n[2/4] Preparing ptau… (generating locally via snarkjs)");
    safeWriteGuard(ptau0, force);
    safeWriteGuard(ptau1, force);
    safeWriteGuard(ptauFinal, force);

    run("npx", ["snarkjs", "powersoftau", "new", "bn128", "12", ptau0, "-v"]);
    run("npx", [
      "snarkjs",
      "powersoftau",
      "contribute",
      ptau0,
      ptau1,
      "--name",
      "BV dev contribution",
      "-v",
      "-e",
      getEntropy(),
    ]);
    run("npx", ["snarkjs", "powersoftau", "prepare", "phase2", ptau1, ptauFinal, "-v"]);
  } else {
    console.log(`\n[2/4] Using existing ptau: ${ptauFinal}`);
  }

  // Groth16 setup
  const zkey0 = path.join(BUILD_DIR, "tally_0000.zkey");
  const zkeyFinal = path.join(BUILD_DIR, "tally_final.zkey");
  const vkey = path.join(BUILD_DIR, "verification_key.json");
  const verifierSol = path.join(BUILD_DIR, "verifier.sol");

  safeWriteGuard(zkey0, force);
  safeWriteGuard(zkeyFinal, force);
  safeWriteGuard(vkey, force);
  safeWriteGuard(verifierSol, force);

  console.log("\n[3/4] Groth16 setup…");
  run("npx", ["snarkjs", "groth16", "setup", r1cs, ptauFinal, zkey0]);

  console.log("\n[4/4] Contribute + export verifier…");
  run("npx", [
    "snarkjs",
    "zkey",
    "contribute",
    zkey0,
    zkeyFinal,
    "--name",
    "BV dev contribution",
    "-v",
    "-e",
    getEntropy(),
  ]);
  run("npx", ["snarkjs", "zkey", "export", "verificationkey", zkeyFinal, vkey]);
  run("npx", ["snarkjs", "zkey", "export", "solidityverifier", zkeyFinal, verifierSol]);

  console.log("\nDone.");
  console.log(`Artifacts: ${BUILD_DIR}`);
  console.log("Next: node zk/scripts/prove-tally.ts <witness.json>");
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
