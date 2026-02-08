import { ethers } from "hardhat";

async function main() {
  const Factory = await ethers.getContractFactory("TallyGroth16Verifier");
  const verifier = await Factory.deploy();
  await verifier.waitForDeployment();
  console.log("TallyGroth16Verifier:", await verifier.getAddress());
}

main().catch(console.error);
