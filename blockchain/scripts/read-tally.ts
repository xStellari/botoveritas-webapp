import { ethers } from "hardhat";

/**
 * Step 2.16 — Read on-chain tally + print anchors/resultsUri
 *
 * Usage:
 *   REGISTRY_ADDRESS=0x... ELECTION_ID_HASH=0x... ELECTION_VOTE_ROOT=0x... \
 *     npx hardhat run blockchain/scripts/read-tally.ts --network amoy
 *
 * Notes:
 * - ELECTION_ID_HASH and ELECTION_VOTE_ROOT are bytes32.
 * - You can copy these from submitArgs.json produced in Step 2.14.
 */

async function main() {
  const registryAddress = process.env.REGISTRY_ADDRESS;
  const electionIdHash = process.env.ELECTION_ID_HASH;
  const electionVoteRoot = process.env.ELECTION_VOTE_ROOT;

  if (!registryAddress) throw new Error("Missing REGISTRY_ADDRESS");
  if (!electionIdHash) throw new Error("Missing ELECTION_ID_HASH (bytes32 0x...)");
  if (!electionVoteRoot) throw new Error("Missing ELECTION_VOTE_ROOT (bytes32 0x...)");

  const Registry = await ethers.getContractAt("ElectionTallyRegistry", registryAddress);

  const rec = await Registry.getTally(electionIdHash, electionVoteRoot);

  console.log("=== On-chain TallyRecord ===");
  console.log("electionIdHash:   ", rec.electionIdHash);
  console.log("electionVoteRoot: ", rec.electionVoteRoot);
  console.log("manifestHash:     ", rec.manifestHash);
  console.log("resultsHash:      ", rec.resultsHash);
  console.log("resultsUri:       ", rec.resultsUri);
  console.log("submitter:        ", rec.submitter);
  console.log("submittedAt:      ", rec.submittedAt.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
