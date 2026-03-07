pragma circom 2.1.8;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/isEqual.circom";

template TallyRootAndResults(N, C) {
    signal input electionIdHash;
    signal input electionVoteRoot;
    signal input manifestHash;
    signal input resultsHash;

    signal input votes[N];

    signal computedCounts[C];
    for (var j = 0; j < C; j++) computedCounts[j] <== 0;

    component lt[N];
    component eq[C][N];

    for (var i = 0; i < N; i++) {
        lt[i] = LessThan(32);
        lt[i].in[0] <== votes[i];
        lt[i].in[1] <== C;
        lt[i].out === 1;

        for (var j = 0; j < C; j++) {
            eq[j][i] = IsEqual();
            eq[j][i].in[0] <== votes[i];
            eq[j][i].in[1] <== j;
            computedCounts[j] <== computedCounts[j] + eq[j][i].out;
        }
    }

    component h = Poseidon(2 + C);
    h.inputs[0] <== electionIdHash;
    h.inputs[1] <== manifestHash;
    for (var j = 0; j < C; j++) {
        h.inputs[2 + j] <== computedCounts[j];
    }
    h.out === resultsHash;

    signal leaf[N];
    component leafHash[N];

    for (var i = 0; i < N; i++) {
        leafHash[i] = Poseidon(4);
        leafHash[i].inputs[0] <== electionIdHash;
        leafHash[i].inputs[1] <== manifestHash;
        leafHash[i].inputs[2] <== i;
        leafHash[i].inputs[3] <== votes[i];
        leaf[i] <== leafHash[i].out;
    }

    var levelSize = N;
    signal cur[levelSize];
    for (var i = 0; i < N; i++) cur[i] <== leaf[i];

    while (levelSize > 1) {
        var nextSize = levelSize / 2;
        signal next[nextSize];
        component mh[nextSize];

        for (var k = 0; k < nextSize; k++) {
            mh[k] = Poseidon(2);
            mh[k].inputs[0] <== cur[2*k];
            mh[k].inputs[1] <== cur[2*k + 1];
            next[k] <== mh[k].out;
        }

        levelSize = nextSize;
        cur = next;
    }

    cur[0] === electionVoteRoot;
}

component main = TallyRootAndResults(32, 4);
