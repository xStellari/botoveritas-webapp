import { ethers } from "hardhat";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys the Groth16 verifier + ElectionTallyRegistry and prints addresses.
 *
 * Important: The verifier contract is generated from the Circom circuit.
 * The zk scripts live in ../zk and expect to run with repo-root as CWD so
 * they can resolve zk/circuits/tally.circom correctly.
 */

function repoRootFromHere(): string {
  // __dirname = <repo>/blockchain/scripts
  return path.resolve(__dirname, "..", "..");
}

function ensureVerifierArtifact(): void {
  // Hardhat artifacts are written under blockchain/artifacts
  const artifactsDir = path.resolve(__dirname, "..", "artifacts");
  const expectedArtifact = path.join(
    artifactsDir,
    "contracts",
    "TallyGroth16Verifier.sol",
    "TallyGroth16Verifier.json",
  );

  if (fs.existsSync(expectedArtifact)) return;

  console.log("Verifier artifact not found. Ensuring verifier Solidity exists...");

  const repoRoot = repoRootFromHere();

  // 1) Generate verifier.sol via snarkjs setup (runs circom/snarkjs pipeline)
  console.log("Generating zk/build/tally/verifier.sol via snarkjs setup...");
  execSync("npx tsx zk/scripts/snarkjs-setup.ts --force", {
    cwd: repoRoot,
    stdio: "inherit",
  });

  // 2) Promote verifier.sol into blockchain/contracts/TallyGroth16Verifier.sol
  console.log("Promoting verifier Solidity into blockchain/contracts...");
  execSync("npx tsx zk/scripts/promote-verifier-sol.ts", {
    cwd: repoRoot,
    stdio: "inherit",
  });

  console.log("Verifier Solidity promoted. Hardhat will compile it on the next step.");
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await deployer.provider.getBalance(deployer.address);

  console.log("Deployer:", deployer.address);
  console.log("Deployer balance:", balance.toString());

  // Ensure verifier contract source exists + is compiled
  ensureVerifierArtifact();

  // Compile after verifier promotion
  await (await import("hardhat")).run("compile");

  // Deploy Verifier
  const Verifier = await ethers.getContractFactory("TallyGroth16Verifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();

  console.log("TallyGroth16Verifier deployed to:", verifierAddr);

  // Deploy Registry (expects verifier address in constructor)
  const Registry = await ethers.getContractFactory("ElectionTallyRegistry");
  const registry = await Registry.deploy(verifierAddr);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();

  console.log("ElectionTallyRegistry deployed to:", registryAddr);

  console.log("\n=== ENV OUTPUT ===");
  console.log(`VERIFIER_ADDRESS=${verifierAddr}`);
  console.log(`REGISTRY_ADDRESS=${registryAddr}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
