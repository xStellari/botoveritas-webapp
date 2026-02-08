#!/usr/bin/env node
/**
 * zk/scripts/check-zk-env.ts
 *
 * Step 2.17: Quick environment sanity check (versions + required binaries).
 *
 * This is *non-invasive*: it does not build anything.
 *
 * Usage:
 *   node zk/scripts/check-zk-env.ts
 */

import { spawnSync } from "node:child_process";

function cmdOk(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: "pipe", shell: process.platform === "win32" });
  return { ok: r.status === 0, out: (r.stdout?.toString("utf8") ?? "").trim(), err: (r.stderr?.toString("utf8") ?? "").trim() };
}

function main() {
  const checks = [
    { name: "node", cmd: "node", args: ["-v"] },
    { name: "npm", cmd: "npm", args: ["-v"] },
    { name: "circom", cmd: process.env.CIRCOM_BIN ?? "circom", args: ["--version"] },
    { name: "snarkjs (npx)", cmd: "npx", args: ["snarkjs", "--help"] },
  ];

  console.log("=== ZK Environment Check ===");
  for (const c of checks) {
    const r = cmdOk(c.cmd, c.args);
    if (r.ok) console.log(`✅ ${c.name}: ${r.out || "ok"}`);
    else console.log(`❌ ${c.name}: not found / failed`);
  }

  // Optional deps used by scripts
  const circomlib = cmdOk("node", ["-e", "require.resolve('circomlibjs')"]);
  console.log(circomlib.ok ? "✅ circomlibjs: installed" : "⚠️  circomlibjs: not installed (needed for resultsHash/results audit scripts)");

  const ethers = cmdOk("node", ["-e", "require.resolve('ethers')"]);
  console.log(ethers.ok ? "✅ ethers: installed" : "⚠️  ethers: not installed (recommended for keccak256 packing scripts)");
}

main();
