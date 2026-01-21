import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying ElectionRootAnchor with account:", deployer.address);
  console.log("Deployer balance:", (await deployer.provider.getBalance(deployer.address)).toString());

  const ElectionRootAnchor = await ethers.getContractFactory("ElectionRootAnchor");

  // Owner = deployer (recommended for testing)
  const anchor = await ElectionRootAnchor.deploy(deployer.address);

  await anchor.waitForDeployment();

  const address = await anchor.getAddress();
  console.log("ElectionRootAnchor deployed to:", address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
