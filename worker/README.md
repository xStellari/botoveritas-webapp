# ZK Tally Worker (Fly.io)

This worker consumes `public.election_tally_proofs` jobs (`status='queued'`),
generates Groth16 proof + submits to the on-chain registry (Polygon Amoy),
then updates the job row with `tx_hash` + `status`.

## Required env vars (Fly secrets)

- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- INTERNAL_WORKER_KEY  (must match Supabase Edge secret used by internal-generate-zk-tally-witness)
- REGISTRY_ADDRESS
- AMOY_RPC_URL
- SUBMITTER_PRIVATE_KEY

Optional:
- ZK_RESULTS_BUCKET (default: zk-results)

## Deploy outline

1) `fly launch` inside `worker/`
2) `fly secrets set ...` for the vars above
3) `fly deploy`
