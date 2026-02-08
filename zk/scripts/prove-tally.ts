#!/usr/bin/env node
/**
 * zk/scripts/prove-tally.ts
 *
 * Generates Groth16 proof + public signals from a witness JSON (Step 2.7/2.8),
 * using compiled artifacts under zk/build/tally/ (from snarkjs-setup.ts).
 *
 * Usage:
 *   node zk/scripts/prove-tally.ts <witness.json> [--outDir zk/build/tally]
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type Meta = { positions: { name: string; candidateCount: number }[] };

type WitnessJson = {
  witness?: {
    publicInputs?: {
      electionIdHashField?: string;
      electionVoteRootField?: string;
      manifestHashField?: string;
      resultsHashField?: string | null;
    };
    circuitInputs?: {
      abstain?: Array<string | number>;
      countsByPosition?: Array<Array<string | number>>;
    };
  };
};

const ROOT = process.cwd();

function run(cmd: string, args: string[], cwd?: string) {
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: cwd ?? ROOT,
    shell: process.platform === "win32",
  });
  if (res.status !== 0) throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
}

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function writeJson(p: string, v: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf8");
}

function parseArgs(argv: string[]) {
  const args: { witness?: string; outDir?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!args.witness && !a.startsWith("--")) args.witness = a;
    else if (a === "--outDir") args.outDir = argv[++i];
  }
  return args;
}

function buildSnarkjsInput(meta: Meta, w: WitnessJson) {
  const pub = w.witness?.publicInputs;
  const cir = w.witness?.circuitInputs;

  if (!pub?.electionIdHashField || !pub.electionVoteRootField || !pub.manifestHashField) {
    throw new Error("Missing witness.publicInputs.* fields");
  }
  if (!pub.resultsHashField) {
    throw new Error("Missing witness.publicInputs.resultsHashField. Run compute-results-hash.ts first.");
  }
  if (!cir?.abstain || !cir.countsByPosition) {
    throw new Error("Missing witness.circuitInputs.{abstain,countsByPosition}");
  }

  if (cir.abstain.length != meta.positions.length) {
    throw new Error(`abstain length mismatch: got ${cir.abstain.length}, expected ${meta.positions.length}`);
  }

  const input: any = {
    electionIdHash: String(pub.electionIdHashField),
    electionVoteRoot: String(pub.electionVoteRootField),
    manifestHash: String(pub.manifestHashField),
    resultsHash: String(pub.resultsHashField),
    abstain: cir.abstain.map((x) => String(x)),
  };

  for (let i = 0; i < meta.positions.length; i++) {
    const expected = meta.positions[i].candidateCount;
    const got = cir.countsByPosition[i]?.length ?? 0;
    if (got !== expected) {
      throw new Error(`countsByPosition[${i}] length mismatch: got ${got}, expected ${expected}`);
    }
    input[`counts_${i}`] = cir.countsByPosition[i].map((x) => String(x));
  }

  return input;
}

async function main() {
  const { witness, outDir } = parseArgs(process.argv);
  if (!witness) {
    console.error("Usage: prove-tally <witness.json> [--outDir zk/build/tally]");
    process.exit(1);
  }

  const build = outDir ?? path.join(ROOT, "zk", "build", "tally");
  const metaPath = path.join(ROOT, "zk", "circuits", "tally.meta.json");
  const meta = readJson<Meta>(metaPath);
  const w = readJson<WitnessJson>(witness);

  const inputJson = buildSnarkjsInput(meta, w);
  const inputPath = path.join(build, "input.json");
  writeJson(inputPath, inputJson);

  const wasmDir = path.join(build, "tally_js");
  const wasm = path.join(wasmDir, "tally.wasm");
  const wtns = path.join(build, "witness.wtns");

  if (!fs.existsSync(wasm)) throw new Error("Missing tally.wasm. Run snarkjs-setup.ts first.");

  // Generate witness.wtns
  run("npx", ["snarkjs", "wtns", "calculate", wasm, inputPath, wtns]);

  const zkey = path.join(build, "tally_final.zkey");
  if (!fs.existsSync(zkey)) throw new Error("Missing tally_final.zkey. Run snarkjs-setup.ts first.");

  const proofPath = path.join(build, "proof.json");
  const publicPath = path.join(build, "public.json");

  // Prove
  run("npx", ["snarkjs", "groth16", "prove", zkey, wtns, proofPath, publicPath]);

  // Verify (recommended)
  const vkey = path.join(build, "verification_key.json");
  if (fs.existsSync(vkey)) {
    run("npx", ["snarkjs", "groth16", "verify", vkey, publicPath, proofPath]);
  }

  console.log("\nProof artifacts:");
  console.log(`- ${proofPath}`);
  console.log(`- ${publicPath}`);
  console.log("\nPublic input order (BV_TALLY_PROOF_V1):");
  console.log("[electionIdHash, electionVoteRoot, manifestHash, resultsHash]");
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
