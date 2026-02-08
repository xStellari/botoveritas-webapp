# Step 2.17 — Runbook consolidation + pipeline orchestrator

## Goal
Make the ZK tally flow *demo-proof* by providing:
- a single `zk/README.md` runbook
- a `check-zk-env.ts` sanity checker
- a `run-tally-pipeline.ts` dry-run orchestrator that prints the correct command sequence

## Files added
- `zk/README.md`
- `zk/scripts/check-zk-env.ts`
- `zk/scripts/run-tally-pipeline.ts`

## What you need to do now
Just place the files and commit. No running required.

## When you are ready (later)
- `node zk/scripts/check-zk-env.ts`
- `node zk/scripts/run-tally-pipeline.ts --electionId <uuid> --witness <witness.json> --resultsOut results.json`
  - Add `--run` to actually execute.
