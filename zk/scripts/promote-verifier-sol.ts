#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const inPath = path.join("zk", "build", "tally", "verifier.sol");
const outPath = path.join("contracts", "TallyGroth16Verifier.sol");

if (!fs.existsSync(inPath)) {
  console.error("Missing zk/build/tally/verifier.sol");
  process.exit(1);
}

let src = fs.readFileSync(inPath, "utf8");
src = src.replace(/\bcontract\s+Verifier\b/g, "contract TallyGroth16Verifier");
src = src.replace(/\bVerifier\s*\(/g, "TallyGroth16Verifier(");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, src, "utf8");

console.log("Promoted verifier to contracts/TallyGroth16Verifier.sol");
