# Step 2.10 — On-chain submission helpers

## Goal
Take the outputs from snarkjs:
- `zk/build/tally/proof.json`
- `zk/build/tally/public.json`

…and format them into calldata-ready args for:

`ElectionTallyRegistry.submitTally(electionIdHash, electionVoteRoot, manifestHash, resultsHash, resultsUri, a, b, c)`

## Files
- `zk/scripts/format-tally-submit.ts` — formats proof/public into a JSON object usable by ethers

## Usage (when ready)
```bash
node zk/scripts/format-tally-submit.ts \
  --proof zk/build/tally/proof.json \
  --public zk/build/tally/public.json \
  --resultsUri "https://<where-you-host-results-json>"
```

It prints JSON including:
- `electionIdHash`, `electionVoteRoot`, `manifestHash`, `resultsHash` as **bytes32 hex**
- `a`, `b`, `c` in **Solidity verifier ABI order**
