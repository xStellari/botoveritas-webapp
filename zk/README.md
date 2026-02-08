# ZK folder (BotoVeritas)

## Layout
- `zk/circuits/` : Circom sources (generated + committed)
- `zk/scripts/`  : Offline tooling (codegen, snarkjs workflows)

## Step 2.5 (current)
This step introduces a **results commitment circuit**:

- It binds a tally vector (abstain + candidate counts) to:
  - `electionIdHash`
  - `electionVoteRoot`
  - `manifestHash`
  - `resultsHash`

Hashing inside the circuit uses **Poseidon folding** (ZK-friendly).

> Note: Step 2.5 does not yet prove the tally vector was derived from the vote-set.
> The next step composes vote-set binding with this results commitment.

## Generate circuit
```bash
node zk/scripts/generate-tally-circuit.ts <path-to-manifest.json>
```

Outputs:
- `zk/circuits/tally.circom`
- `zk/circuits/tally.meta.json`
