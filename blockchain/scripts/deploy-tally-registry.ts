import { ethers } from "hardhat";

async function main() {
  const verifierAddress = process.env.VERIFIER_ADDRESS;
  if (!verifierAddress) throw new Error("Missing VERIFIER_ADDRESS");

  const Factory = await ethers.getContractFactory("ElectionTallyRegistry");
  const registry = await Factory.deploy(verifierAddress);
  await registry.waitForDeployment();
  console.log("ElectionTallyRegistry:", await registry.getAddress());
}

main().catch(console.error);
