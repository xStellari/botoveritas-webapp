# Step 2.14 — One-command submit prep

## Goal
Produce a single JSON payload (`submitArgs.json`) containing everything you need to call:
`ElectionTallyRegistry.submitTally(...)`

## Added
- `zk/scripts/prepare-tally-submit.ts`

## When you are ready (not now)
After you have:
- `witness.json` (Edge output)
- `proof.json` + `public.json` (snarkjs prove)
- `results.json` (canonical BV_RESULTS_JSON_V1)

Run:
```bash
PUBLIC_BASE_URL="https://<your-domain>" node zk/scripts/prepare-tally-submit.ts \
  --witness <witness.json> \
  --proof zk/build/tally/proof.json \
  --public zk/build/tally/public.json \
  --results results.json \
  --publish \
  --out submitArgs.json
```

Then `submitArgs.json` contains:
- bytes32 anchors (electionIdHash, electionVoteRoot, manifestHash, resultsHash)
- resultsUri
- proof (a,b,c) formatted for Solidity verifier ABI
- raw publicSignals (field decimals) for debugging

You can paste those into your Hardhat/ethers submit script.
