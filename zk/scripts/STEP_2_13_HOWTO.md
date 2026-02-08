# Step 2.13 — Results URI hosting (Vercel static)

## Goal
Make `resultsUri` a stable URL that Vercel can serve without extra infra.

## Approach (recommended)
Put canonical results payloads under:
- `public/zk-results/`

Vercel will serve them at:
- `https://<your-domain>/zk-results/<tallyKey>.json`

## Files added
- `zk/scripts/publish-results-to-public.ts`

## When you are ready (not now)
1) Build canonical results JSON:
   - `node zk/scripts/build-results-json.ts --witness <witness.json> --out results.json --manifest <manifestSnapshot.json>`

2) Publish to Vercel public folder (deterministic filename):
   - `PUBLIC_BASE_URL="https://<your-vercel-domain>" node zk/scripts/publish-results-to-public.ts --in results.json`

3) Commit the new file under `public/zk-results/` (or upload it via CI)
4) Use the printed `resultsUri` as input to `submitTally(...)`

## Why tallyKey naming?
We mirror the on-chain key:
`keccak256(abi.encodePacked(electionIdHashBytes32, electionVoteRootBytes32))`
so the URL is deterministic and can be derived from the on-chain record.
