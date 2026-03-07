import { ethers } from "hardhat";

async function main() {
  const verifierAddress = process.env.VERIFIER_ADDRESS;
  if (!verifierAddress) throw new Error("Missing VERIFIER_ADDRESS");

  const Factory = await ethers.getContractFactory("ElectionTallyRegistry");
  // NOTE: We intentionally cast to `any` here to avoid TypeScript mismatches when
  // TypeChain artifacts are stale (e.g., constructor args changed but typings
  // haven't been regenerated yet).
  const registry = await (Factory as any).deploy(verifierAddress);
  await registry.waitForDeployment();
  console.log("ElectionTallyRegistry:", await registry.getAddress());
}

main().catch(console.error);
