# Step 2.9 — snarkjs workflow scripts

## What these scripts do
- `snarkjs-setup.ts` compiles `zk/circuits/tally.circom` and generates Groth16 setup artifacts under `zk/build/tally/`.
- `prove-tally.ts` takes a witness JSON (Edge output, with resultsHashField filled) and generates:
  - `zk/build/tally/proof.json`
  - `zk/build/tally/public.json`

## Minimal run sequence (when you are ready, not now)
1) Generate circuit (from Supabase manifest)
   - `node zk/scripts/generate-tally-circuit.ts --electionId <uuid>`

2) Setup (compile + zkey + verifier.sol)
   - `node zk/scripts/snarkjs-setup.ts`

3) Get witness JSON from Edge Function, then compute resultsHashField
   - `node zk/scripts/compute-results-hash.ts <witness.json>`

4) Prove + verify locally
   - `node zk/scripts/prove-tally.ts <witness.json>`

## Notes
- For final demo/defense, set `ZK_ENTROPY` before running setup.
- `snarkjs-setup.ts` uses `powersoftau new bn128 12` by default.
  If circom reports more than ~4096 constraints, increase the power (e.g., 14 or 16).
