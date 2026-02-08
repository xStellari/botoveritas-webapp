# Step 2.15 — Submit tally on-chain (Hardhat)

## Goal
One command to submit the tally proof + anchors to `ElectionTallyRegistry.submitTally(...)`.

## Prerequisites (when you are ready, not now)
- Deployed `TallyGroth16Verifier` (Step 2.11)
- Deployed `ElectionTallyRegistry` pointing to verifier
- Generated:
  - `results.json` (Step 2.12)
  - `proof.json` + `public.json` (Step 2.9)
  - `submitArgs.json` (Step 2.14)

## File added
- `blockchain/scripts/submit-tally.ts`

## Usage (when ready)
```bash
REGISTRY_ADDRESS=0x... SUBMIT_ARGS=submitArgs.json \
  npx hardhat run blockchain/scripts/submit-tally.ts --network amoy
```

It prints the tx hash and block number.

## Notes
- This script assumes your Hardhat project compiles `ElectionTallyRegistry` ABI.
- `submitArgs.json` must be produced by `zk/scripts/prepare-tally-submit.ts`.
