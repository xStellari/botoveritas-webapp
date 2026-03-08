export const ZK_TALLY_MAX_POSITIONS = 20;
export const ZK_TALLY_MAX_CANDIDATES_PER_POSITION = 5;
export const ZK_TALLY_RESULTS_COMMIT_DOMAIN = "223344556";

export const ZK_TALLY_PUBLIC_INPUT_ORDER = [
  "electionIdHashField",
  "electionVoteRootField",
  "manifestHashField",
  "resultsHashField",
] as const;

export type ZkTallyPublicInputs = {
  electionIdHashField: string | number;
  electionVoteRootField: string | number;
  manifestHashField: string | number;
  resultsHashField: string | number;
};

export type UniversalTallyVectors = {
  positionCount: string | number;
  candidateCounts: Array<string | number>;
  abstain: Array<string | number>;
  tallies: Array<Array<string | number>>;
};

export function buildUniversalFoldVector(v: UniversalTallyVectors): string[] {
  const out: string[] = [];
  out.push(String(v.positionCount));

  for (let i = 0; i < ZK_TALLY_MAX_POSITIONS; i++) {
    out.push(String(v.candidateCounts[i] ?? 0));
  }

  for (let i = 0; i < ZK_TALLY_MAX_POSITIONS; i++) {
    out.push(String(v.abstain[i] ?? 0));
  }

  for (let i = 0; i < ZK_TALLY_MAX_POSITIONS; i++) {
    const row = v.tallies[i] ?? [];
    for (let j = 0; j < ZK_TALLY_MAX_CANDIDATES_PER_POSITION; j++) {
      out.push(String(row[j] ?? 0));
    }
  }

  return out;
}

export function buildPublicSignalsFromWitnessPublicInputs(pub: ZkTallyPublicInputs): string[] {
  return [
    String(pub.electionIdHashField),
    String(pub.electionVoteRootField),
    String(pub.manifestHashField),
    String(pub.resultsHashField),
  ];
}
