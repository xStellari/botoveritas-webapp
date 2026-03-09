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
 *     - pot{power}_final.ptau (default power=14)
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
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Always resolve repo root regardless of where this script is invoked from (e.g., blockchain/)
const ROOT = path.resolve(__dirname, "..", "..");
const CIRCUIT_PATH = path.join(ROOT, "zk", "circuits", "tally.circom");
const META_PATH = path.join(ROOT, "zk", "circuits", "tally.meta.json");
const BUILD_DIR = path.join(ROOT, "zk", "build", "tally");
const CIRCOM_INCLUDE_DIR = path.join(ROOT, "zk", "node_modules");

function resolveCmd(cmd: string): string {
  // On Windows, "npx" is typically "npx.cmd". Using shell=true causes quoting issues
  // with paths that contain spaces, so we avoid shell execution and resolve the cmd.
  if (process.platform === "win32" && cmd.toLowerCase() === "npx") return "npx.cmd";
  return cmd;
}

function run(cmd: string, args: string[], opts?: { cwd?: string }) {
  const resolved = resolveCmd(cmd);

  const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(resolved);

  // When executing .cmd/.bat on Windows we must go through a shell. In that mode,
  // we also have to quote args ourselves (Node won't do it correctly and paths
  // like "E:\\web app\\..." will get split).
  const quote = (s: string) => {
    if (!useShell) return s;
    // Quote if it contains spaces or shell metacharacters
    return /[\s"&()^<>|]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
  };

  // We use stdio: "inherit" for good UX (snarkjs progress bars, etc.).
  // Note: when stdio is inherited, stdout/stderr are not captured in `res.*`.
  const res = useShell
    ? spawnSync(`${resolved} ${args.map(quote).join(" ")}`, {
        stdio: "inherit",
        cwd: opts?.cwd ?? ROOT,
        shell: true,
      })
    : spawnSync(resolved, args, {
        stdio: "inherit",
        cwd: opts?.cwd ?? ROOT,
        shell: false,
      });

  // If the process failed to spawn at all (common on Windows when resolving .cmd),
  // surface the underlying spawn error clearly.
  if (res.error) {
    throw new Error(
      `Command failed to start: ${resolved} ${args.join(" ")}
` +
        `Spawn error: ${res.error.message}`
    );
  }

  if (res.status !== 0) {
    throw new Error(
      `Command failed: ${resolved} ${args.join(" ")}
` +
        `Exit code: ${res.status ?? "unknown"}${res.signal ? ` (signal: ${res.signal})` : ""}`
    );
  }
}

function runWithInput(cmd: string, args: string[], input: string, opts?: { cwd?: string }) {
  const resolved = resolveCmd(cmd);

  const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(resolved);

  const quote = (s: string) => {
    if (!useShell) return s;
    return /[\s"&()^<>|]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
  };

  const res = useShell
    ? spawnSync(`${resolved} ${args.map(quote).join(" ")}`, {
        input,
        stdio: ["pipe", "pipe", "pipe"],
        cwd: opts?.cwd ?? ROOT,
        shell: true,
        encoding: "utf-8",
      })
    : spawnSync(resolved, args, {
        input,
        stdio: ["pipe", "pipe", "pipe"],
        cwd: opts?.cwd ?? ROOT,
        shell: false,
        encoding: "utf-8",
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
  run(circomBin, [CIRCUIT_PATH, "--r1cs", "--wasm", "--sym", "-o", BUILD_DIR, "-l", CIRCOM_INCLUDE_DIR]);

  if (!exists(wasm)) {
    throw new Error(`Expected wasm not found: ${wasm}. Check circom output.`);
  }

// Powers of Tau (phase 1 + phase 2).
//
// IMPORTANT:
// - Power must be large enough for your circuit constraints.
//   Your current tally circuit is substantially larger than earlier revisions, so the default PTAU power is 18. Use a larger value if the circuit grows again.
// - We avoid interactive prompts for CI-friendliness by using a beacon contribution.
const PTAU_POWER = Number(process.env.BV_PTAU_POWER ?? "18");
if (!Number.isFinite(PTAU_POWER) || PTAU_POWER < 10 || PTAU_POWER > 22) {
  throw new Error(`Invalid BV_PTAU_POWER=${process.env.BV_PTAU_POWER}. Use a number between 10 and 22.`);
}

const ptau0 = path.join(BUILD_DIR, `pot${PTAU_POWER}_0000.ptau`);
const ptau1 = path.join(BUILD_DIR, `pot${PTAU_POWER}_0001.ptau`);
const ptauFinal = path.join(BUILD_DIR, `pot${PTAU_POWER}_final.ptau`);

if (!exists(ptauFinal)) {
  console.log("\n[2/4] Preparing ptau…");

  // Phase 1: generate initial ptau if missing
  if (!exists(ptau0)) {
    console.log(`  - Generating: ${ptau0}`);
    // snarkjs 'powersoftau new' does not accept '-v' in some versions.
    run("npx", ["snarkjs", "powersoftau", "new", "bn128", String(PTAU_POWER), ptau0]);
  } else {
    console.log(`  - Reusing existing: ${ptau0}`);
  }

  // Phase 1: non-interactive contribution (beacon) if missing
  if (!exists(ptau1)) {
    console.log(`  - Beacon contribution: ${ptau1}`);
    // Beacon must be 32 bytes hex (64 chars). Provide via env var to keep it stable across machines.
    let beacon = (process.env.BV_PTAU_BEACON ?? "").trim();
    if (!/^[0-9a-fA-F]{64}$/.test(beacon)) {
      beacon = crypto.randomBytes(32).toString("hex");
      console.log(`    * BV_PTAU_BEACON not set/invalid; generated beacon: ${beacon}`);
    } else {
      console.log(`    * Using BV_PTAU_BEACON: ${beacon}`);
    }

    // 10 iterations is snarkjs convention; name is informational.
    run("npx", [
      "snarkjs",
      "powersoftau",
      "beacon",
      ptau0,
      ptau1,
      beacon,
      "10",
      "-n=BV_beacon",
    ]);
  } else {
    console.log(`  - Reusing existing: ${ptau1}`);
  }

  // Phase 2: prepare phase2 if missing
  console.log(`  - Preparing phase2: ${ptauFinal}`);
  run("npx", ["snarkjs", "powersoftau", "prepare", "phase2", ptau1, ptauFinal, "-v"]);
} else {
  console.log(`
[2/4] Using existing ptau: ${ptauFinal}`);
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
  // Non-interactive finalization of zkey (CI-friendly) using a beacon.
  // Provide BV_ZKEY_BEACON (64 hex chars) to make builds reproducible.
  let zkeyBeacon = (process.env.BV_ZKEY_BEACON ?? "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(zkeyBeacon)) {
    zkeyBeacon = crypto.randomBytes(32).toString("hex");
    console.log(`  * BV_ZKEY_BEACON not set/invalid; generated beacon: ${zkeyBeacon}`);
  } else {
    console.log(`  * Using BV_ZKEY_BEACON: ${zkeyBeacon}`);
  }

  run("npx", [
    "snarkjs",
    "zkey",
    "beacon",
    zkey0,
    zkeyFinal,
    zkeyBeacon,
    "10",
    "-n=BV_zkey_beacon",
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