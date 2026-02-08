# Step 2.16 — Post-submit audit helpers

## Goal
After a tally is submitted on-chain, you can instantly show the panel:
- the on-chain anchors + resultsUri
- and that your published results.json matches those anchors and binds to resultsHash

## Files added
- `blockchain/scripts/read-tally.ts`
- `zk/scripts/audit-tally-from-chain.ts`

## Usage (when ready)
1) Read on-chain record:
```bash
REGISTRY_ADDRESS=0x... ELECTION_ID_HASH=0x... ELECTION_VOTE_ROOT=0x... \
  npx hardhat run blockchain/scripts/read-tally.ts --network amoy
```

2) Audit local results.json against the anchors:
```bash
node zk/scripts/audit-tally-from-chain.ts --results results.json \
  --electionIdHash 0x... --electionVoteRoot 0x... --manifestHash 0x... --resultsHash 0x...
```
