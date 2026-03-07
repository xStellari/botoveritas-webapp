// UNIVERSAL tally circuit for all elections within fixed bounds.
// Output: zk/circuits/tally.circom
// Purpose: Results commitment gadget (BV_TALLY_UNIVERSAL_V1)
//
// Fixed arity:
// - maxPositions: 20
// - maxCandidatesPerPosition: 5
//
// Public inputs:
//   electionIdHash, electionVoteRoot, manifestHash, resultsHash
//
// Private inputs:
//   positionCount, candidateCounts[20], abstain[20], tallies[20][5]
//
// Hash fold order:
//   positionCount,
//   candidateCounts[0..19],
//   abstain[0..19],
//   tallies[0][0..4], ... tallies[19][0..4]
//
// Padding rules:
// - if i >= positionCount, then candidateCounts[i] = 0, abstain[i] = 0, tallies[i][j] = 0
// - if j >= candidateCounts[i], then tallies[i][j] = 0
//
pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

template BVTallyUniversalV1() {
  var MAX_POSITIONS = 20;
  var MAX_CANDIDATES = 5;
  var TOTAL_FOLDS = 144;

  signal input electionIdHash;
  signal input electionVoteRoot;
  signal input manifestHash;
  signal input resultsHash;

  signal input positionCount;
  signal input candidateCounts[MAX_POSITIONS];
  signal input abstain[MAX_POSITIONS];
  signal input tallies[MAX_POSITIONS][MAX_CANDIDATES];

  component posCountBound = LessThan(6);
  posCountBound.in[0] <== positionCount;
  posCountBound.in[1] <== 21;
  posCountBound.out === 1;

  component candidateCountBound[MAX_POSITIONS];
  component positionActive[MAX_POSITIONS];
  component candidateActive[MAX_POSITIONS][MAX_CANDIDATES];

  for (var i = 0; i < MAX_POSITIONS; i++) {
    candidateCountBound[i] = LessThan(4);
    candidateCountBound[i].in[0] <== candidateCounts[i];
    candidateCountBound[i].in[1] <== 6;
    candidateCountBound[i].out === 1;

    positionActive[i] = LessThan(6);
    positionActive[i].in[0] <== i;
    positionActive[i].in[1] <== positionCount;

    candidateCounts[i] * (1 - positionActive[i].out) === 0;
    abstain[i] * (1 - positionActive[i].out) === 0;

    for (var j = 0; j < MAX_CANDIDATES; j++) {
      candidateActive[i][j] = LessThan(4);
      candidateActive[i][j].in[0] <== j;
      candidateActive[i][j].in[1] <== candidateCounts[i];
      tallies[i][j] * (1 - candidateActive[i][j].out) === 0;
    }
  }

  component folds[TOTAL_FOLDS];

  folds[0] = Poseidon(2);
  folds[0].inputs[0] <== 223344556;
  folds[0].inputs[1] <== electionIdHash;

  folds[1] = Poseidon(2);
  folds[1].inputs[0] <== folds[0].out;
  folds[1].inputs[1] <== electionVoteRoot;

  folds[2] = Poseidon(2);
  folds[2].inputs[0] <== folds[1].out;
  folds[2].inputs[1] <== manifestHash;

  folds[3] = Poseidon(2);
  folds[3].inputs[0] <== folds[2].out;
  folds[3].inputs[1] <== positionCount;

  var idx = 4;

  for (var i = 0; i < MAX_POSITIONS; i++) {
    folds[idx] = Poseidon(2);
    folds[idx].inputs[0] <== folds[idx - 1].out;
    folds[idx].inputs[1] <== candidateCounts[i];
    idx++;
  }

  for (var i = 0; i < MAX_POSITIONS; i++) {
    folds[idx] = Poseidon(2);
    folds[idx].inputs[0] <== folds[idx - 1].out;
    folds[idx].inputs[1] <== abstain[i];
    idx++;
  }

  for (var i = 0; i < MAX_POSITIONS; i++) {
    for (var j = 0; j < MAX_CANDIDATES; j++) {
      folds[idx] = Poseidon(2);
      folds[idx].inputs[0] <== folds[idx - 1].out;
      folds[idx].inputs[1] <== tallies[i][j];
      idx++;
    }
  }

  folds[TOTAL_FOLDS - 1].out === resultsHash;
}

component main { public [electionIdHash, electionVoteRoot, manifestHash, resultsHash] } = BVTallyUniversalV1();
