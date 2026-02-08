# Step 2.18 — Submit + confirm (one command)

## Goal
Make demo/defense smoother:
- one command submits the tally
- and immediately prints the on-chain stored record

## File added
- `blockchain/scripts/submit-and-confirm-tally.ts`

## What you need to do now
Just place the file and commit. No running required.

## Usage (when ready)
```bash
REGISTRY_ADDRESS=0x... SUBMIT_ARGS=submitArgs.json \
  npx hardhat run blockchain/scripts/submit-and-confirm-tally.ts --network amoy
```
