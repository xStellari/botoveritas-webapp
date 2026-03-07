# BV ZK Tally Proof V2 (Universal Circuit Deployment Spec)

This spec defines the public inputs and universal private input schema for the BotoVeritas tally proof after the universal-circuit upgrade.

## Public inputs (Groth16)

Order is fixed (BV_TALLY_UNIVERSAL_V1):

0. `electionIdHash`  : bytes32 cast to the BN254 scalar field
1. `electionVoteRoot`: bytes32 cast to the BN254 scalar field
2. `manifestHash`    : bytes32 cast to the BN254 scalar field
3. `resultsHash`     : Poseidon commitment over the universal tally payload

The proof MUST bind to all 4 values.

## Universal private inputs

The circuit is fixed for all elections with these upper bounds:

- `MAX_POSITIONS = 20`
- `MAX_CANDIDATES_PER_POSITION = 5`

Private inputs:

- `positionCount`
- `candidateCounts[20]`
- `abstain[20]`
- `tallies[20][5]`

Padding rules:

- if `i >= positionCount`, then `candidateCounts[i] = 0`, `abstain[i] = 0`, and `tallies[i][j] = 0`
- if `j >= candidateCounts[i]`, then `tallies[i][j] = 0`

## Poseidon fold order for `resultsHash`

Domain constant: `223344556`

Fold sequence:

1. `Poseidon(domain, electionIdHash)`
2. fold in `electionVoteRoot`
3. fold in `manifestHash`
4. fold in `positionCount`
5. fold in `candidateCounts[0..19]`
6. fold in `abstain[0..19]`
7. fold in `tallies[0][0..4] .. tallies[19][0..4]`

## Public results JSON

The human-readable tally payload should be published off-chain and include enough structure data to independently recompute `resultsHash`:

- schema: `BV_RESULTS_JSON_V2`
- anchors.publicSignalsFieldDecimals = `[electionIdHash, electionVoteRoot, manifestHash, resultsHash]`
- tally.positionCount
- tally.candidateCounts[20]
- tally.abstainCounts[20]
- tally.tallies[20][5]
- optional display positions/candidate labels from the manifest

The public verifier may fetch this JSON, recompute `resultsHash`, and confirm the displayed tally matches the proof.

## Artifact layout

Shared universal artifacts should live under one versioned path, for example:

- `zk-artifacts/tally/BV_TALLY_UNIVERSAL_V1/tally.wasm`
- `zk-artifacts/tally/BV_TALLY_UNIVERSAL_V1/tally_final.zkey`
- `zk-artifacts/tally/BV_TALLY_UNIVERSAL_V1/verification_key.json`

Per-election proof files should be stored separately, for example:

- `zk-proofs/tally/BV_TALLY_UNIVERSAL_V1/<electionId>/proof.json`
- `zk-proofs/tally/BV_TALLY_UNIVERSAL_V1/<electionId>/publicSignals.json`
