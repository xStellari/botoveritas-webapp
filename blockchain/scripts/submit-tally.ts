import fs from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";

/**
 * Step 2.15 — Submit tally to ElectionTallyRegistry
 *
 * Reads submitArgs.json produced by:
 *   zk/scripts/prepare-tally-submit.ts
 *
 * Usage:
 *   REGISTRY_ADDRESS=0x... SUBMIT_ARGS=submitArgs.json \
 *     npx hardhat run blockchain/scripts/submit-tally.ts --network amoy
 */

type SubmitArgs = {
  electionIdHash: string;
  electionVoteRoot: string;
  manifestHash: string;
  resultsHash: string;
  resultsUri: string;
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
};

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

async function main() {
  const registryAddress = process.env.REGISTRY_ADDRESS;
  if (!registryAddress) throw new Error("Missing env REGISTRY_ADDRESS");

  const submitArgsPath = process.env.SUBMIT_ARGS ?? "submitArgs.json";
  const resolved = path.isAbsolute(submitArgsPath) ? submitArgsPath : path.join(process.cwd(), submitArgsPath);
  if (!fs.existsSync(resolved)) throw new Error(`Missing SUBMIT_ARGS file: ${resolved}`);

  const args = readJson<SubmitArgs>(resolved);

  const Registry = await ethers.getContractAt("ElectionTallyRegistry", registryAddress);

  const tx = await Registry.submitTally(
    args.electionIdHash,
    args.electionVoteRoot,
    args.manifestHash,
    args.resultsHash,
    args.resultsUri,
    args.a,
    args.b,
    args.c
  );

  console.log("submitTally tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("confirmed in block:", receipt?.blockNumber);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
