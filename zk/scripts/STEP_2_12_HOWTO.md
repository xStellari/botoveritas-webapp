# Step 2.12 — Results URI binding (results.json)

## Goal
Make `ElectionTallyRegistry.resultsUri` point to a **canonical JSON** that is:
- human-readable
- machine-verifiable
- cryptographically bound to the ZK proof (`resultsHash`)

## Files added
- `zk/results_schema/BV_RESULTS_JSON_V1.md`
- `zk/scripts/build-results-json.ts`
- `zk/scripts/verify-results-json.ts`

## When you are ready (not now)
1) After you have a witness.json with resultsHashField filled:
   - `node zk/scripts/build-results-json.ts --witness <witness.json> --out results.json --manifest <manifestSnapshot.json>`

2) (Optional but recommended) Verify results.json binds to resultsHash:
   - `node zk/scripts/verify-results-json.ts --results results.json`

3) Host `results.json` (e.g., on your Vercel public folder, IPFS, or Supabase storage public bucket)
   - Use that URL as `resultsUri` when calling `submitTally(...)`

## Why this matters for defense
Your panel can audit:
- the on-chain record (manifestHash/resultsHash/root)
- the results.json content
- and re-compute the binding hash independently.
