# BV ZK Tally Proof V1 (Deployment Spec)

This spec defines the **public inputs** and the on-chain contract interface for BotoVeritas tally proofs.

## Public inputs (Groth16)

Order is fixed (BV_TALLY_PROOF_V1):

0. `electionIdHash`  : bytes32 (cast to uint256)
1. `electionVoteRoot`: bytes32 (cast to uint256)
2. `manifestHash`    : bytes32 (cast to uint256)
3. `resultsHash`     : bytes32 (cast to uint256)

The proof MUST bind to all 4 values.

## Off-chain results JSON (BV_TALLY_RESULT_V1)

The full results object is stored off-chain (Supabase public URL, IPFS, etc.).
On-chain stores only `resultsHash` and a URI pointer (`resultsUri`).

Recommended canonical shape:

- schema: "BV_TALLY_RESULT_V1"
- election_id_hash: "0x.."
- root: "0x.."
- manifest_hash: "0x.."
- positions[] ordered by **manifest position index**
  - position_index (number)
  - position (string, informational)
  - total_ballots
  - abstain
  - candidates[] ordered by candidate_id ascending
    - candidate_id
    - count

Hashing rule:
- Serialize canonical JSON deterministically (stable key order, no whitespace).
- Hash with keccak256 over UTF-8 bytes.

## Registry behavior

ElectionTallyRegistry:
- accepts 1 record per (electionIdHash, electionVoteRoot)
- verifies proof through the configured verifier contract
- stores: electionIdHash, root, manifestHash, resultsHash, resultsUri, timestamp, submitter
