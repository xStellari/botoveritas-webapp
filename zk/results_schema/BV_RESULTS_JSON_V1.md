# BV_RESULTS_JSON_V1 (canonical results URI payload)

This document defines the JSON that `ElectionTallyRegistry.resultsUri` MUST point to.

## Goals
- Human-readable election results
- Machine-verifiable binding to the ZK proof public inputs
- Deterministic reconstruction of the exact `resultsHash` used in proof verification

## Required fields
- `schema`: `"BV_RESULTS_JSON_V1"`
- `createdAt`: ISO timestamp string
- `anchors`:
  - `electionIdHashBytes32`: `0x`-prefixed 32-byte hex
  - `electionVoteRootBytes32`: `0x`-prefixed 32-byte hex
  - `manifestHashBytes32`: `0x`-prefixed 32-byte hex
  - `resultsHashBytes32`: `0x`-prefixed 32-byte hex
- `publicSignalsFieldDecimals`: array of 4 decimal strings in BV_TALLY_PROOF_V1 order:
  1) electionIdHashField
  2) electionVoteRootField
  3) manifestHashField
  4) resultsHashField
- `tally`:
  - `positions[]` (manifest order), each:
    - `index`
    - `name`
    - `abstain`
    - `candidates[]` each:
      - `index`
      - `name` (optional if manifest not supplied)
      - `count`
- `foldVector`: decimal strings in the exact Poseidon-fold order used by the circuit:
  - abstain[0], counts_0[0..], abstain[1], counts_1[0..], ...

## Verification recipe (offline)
To verify a `results.json` file against a proof:
1) Extract `publicSignalsFieldDecimals[0..2]` (domain constant must match your circuit generator)
2) Poseidon-fold using the exact order:
   domain,electionIdHash -> root -> manifestHash -> foldVector[]
3) The output MUST equal `publicSignalsFieldDecimals[3]` and `anchors.resultsHashBytes32`

This is what binds `resultsUri` content to the on-chain `resultsHash`.
