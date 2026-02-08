# ZK Tally Pipeline — BotoVeritas (Deployment Runbook)

This folder contains the **end-to-end ZK tally** tooling for BotoVeritas (Circom + snarkjs + on-chain verifier + registry).

You do **not** need to run anything during development day-to-day.
You only run the pipeline when an election is finalized and you are ready to:
- generate a proof
- publish canonical results.json
- submit anchors + proof to ElectionTallyRegistry
- (optionally) audit it for the panel

## Repo layout
- `zk/circuits/` — generated circuit (`tally.circom`) and metadata (`tally.meta.json`)
- `zk/scripts/` — operator scripts (setup, proving, publishing, submit prep, audits)
- `zk/build/tally/` — build artifacts (R1CS/WASM/ZKEY/proof/public). **Do not commit** unless you intentionally want deterministic builds.
- `public/zk-results/` — published canonical results payloads served by Vercel

## Canonical public input order (BV_TALLY_PROOF_V1)
`public.json` MUST be exactly:
1) electionIdHashField
2) electionVoteRootField
3) manifestHashField
4) resultsHashField

On-chain we store them as bytes32, but the verifier consumes them as uint256 field elements.

## Typical “when-ready” flow (high level)
1) Generate circuit from manifest
2) Setup (compile + zkeys + solidity verifier)
3) Generate witness.json from Edge function
4) Compute resultsHashField and build canonical results.json
5) Prove (proof.json + public.json)
6) Publish results.json to `public/zk-results/<tallyKey>.json` and use that URL as resultsUri
7) Deploy verifier + registry (once per contract address)
8) Submit tally
9) Read & audit for defense

For exact commands, see the STEP docs in `zk/scripts/STEP_*.md`.
