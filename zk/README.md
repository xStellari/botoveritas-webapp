# ZK folder (BotoVeritas)

## Layout
- `zk/circuits/` : Circom sources (generated + committed)
- `zk/scripts/`  : Offline tooling (codegen, snarkjs workflows)
- `zk/manifests/`: Reproducible manifest snapshots used for circuit/proof generation

## Step 2.6
This step adds **Supabase-backed manifest fetching** for codegen:

- `fetch-manifest.ts` pulls `election_manifests` by `election_id`
- writes a snapshot file under `zk/manifests/`
- `generate-tally-circuit.ts` can run in two modes:
  - `--electionId <uuid>` (recommended)
  - `--manifestFile <path>` (offline/manual)

## Generate circuit (recommended)
```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
node zk/scripts/generate-tally-circuit.ts --electionId <election-uuid>
```

Outputs:
- `zk/circuits/tally.circom`
- `zk/circuits/tally.meta.json`
- `zk/manifests/election_<uuid>__<manifestHash>.json`

## Notes
- Filenames avoid illegal Windows characters.
- Circuit filename stays `tally.circom` to keep workflow simple; correctness is enforced by `manifestHash` and proof public inputs.
