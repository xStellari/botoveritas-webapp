import { ethers } from "hardhat";

async function main() {
  const verifierAddress = process.env.VERIFIER_ADDRESS?.trim();
  const anchorAddress = process.env.ANCHOR_ADDRESS?.trim();

  if (!verifierAddress) throw new Error("Missing VERIFIER_ADDRESS");
  if (!anchorAddress) throw new Error("Missing ANCHOR_ADDRESS");

  const Factory = await ethers.getContractFactory("ElectionTallyRegistry");
  const registry = await Factory.deploy(verifierAddress, anchorAddress);
  await registry.waitForDeployment();

  console.log("ElectionTallyRegistry:", await registry.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
