import { ethers } from "hardhat";

/**
 * Deploy ParticipationNFT to Polygon Amoy
 */
async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying with account:", deployer.address);

  const name = process.env.NFT_NAME ?? "Participation Receipt";
  const symbol = process.env.NFT_SYMBOL ?? "BVREC";
  const baseURI = process.env.NFT_BASE_URI ?? "";

  const ParticipationNFT = await ethers.getContractFactory("ParticipationNFT");
  const nft = await ParticipationNFT.deploy(
    name,
    symbol,
    deployer.address,
    baseURI
  );

  await nft.waitForDeployment();

  console.log("ParticipationNFT deployed to:", await nft.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
