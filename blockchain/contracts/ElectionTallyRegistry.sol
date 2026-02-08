// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITallyGroth16Verifier {
  function verifyProof(
    uint256[2] calldata a,
    uint256[2][2] calldata b,
    uint256[2] calldata c,
    uint256[4] calldata input
  ) external view returns (bool);
}

contract ElectionTallyRegistry {
  struct TallyRecord {
    bytes32 electionIdHash;
    bytes32 electionVoteRoot;
    bytes32 manifestHash;
    bytes32 resultsHash;
    string resultsUri;
    address submitter;
    uint64 submittedAt;
  }

  mapping(bytes32 => TallyRecord) private _tallies;
  ITallyGroth16Verifier public verifier;
  address public owner;

  event TallySubmitted(
    bytes32 indexed key,
    bytes32 indexed electionIdHash,
    bytes32 indexed electionVoteRoot,
    bytes32 manifestHash,
    bytes32 resultsHash,
    string resultsUri,
    address submitter,
    uint64 submittedAt
  );

  modifier onlyOwner() {
    require(msg.sender == owner, "NOT_OWNER");
    _;
  }

  constructor(address verifierAddress) {
    require(verifierAddress != address(0), "VERIFIER_ZERO");
    verifier = ITallyGroth16Verifier(verifierAddress);
    owner = msg.sender;
  }

  function setVerifier(address verifierAddress) external onlyOwner {
    require(verifierAddress != address(0), "VERIFIER_ZERO");
    verifier = ITallyGroth16Verifier(verifierAddress);
  }

  function tallyKey(bytes32 electionIdHash, bytes32 electionVoteRoot) public pure returns (bytes32) {
    return keccak256(abi.encodePacked(electionIdHash, electionVoteRoot));
  }

  function submitTally(
    bytes32 electionIdHash,
    bytes32 electionVoteRoot,
    bytes32 manifestHash,
    bytes32 resultsHash,
    string calldata resultsUri,
    uint256[2] calldata a,
    uint256[2][2] calldata b,
    uint256[2] calldata c
  ) external {
    bytes32 key = tallyKey(electionIdHash, electionVoteRoot);
    require(_tallies[key].submittedAt == 0, "TALLY_ALREADY_SUBMITTED");
    require(bytes(resultsUri).length != 0, "RESULTS_URI_EMPTY");

    uint256[4] memory input = [
      uint256(electionIdHash),
      uint256(electionVoteRoot),
      uint256(manifestHash),
      uint256(resultsHash)
    ];

    require(verifier.verifyProof(a, b, c, input), "INVALID_PROOF");

    _tallies[key] = TallyRecord({
      electionIdHash: electionIdHash,
      electionVoteRoot: electionVoteRoot,
      manifestHash: manifestHash,
      resultsHash: resultsHash,
      resultsUri: resultsUri,
      submitter: msg.sender,
      submittedAt: uint64(block.timestamp)
    });

    emit TallySubmitted(
      key,
      electionIdHash,
      electionVoteRoot,
      manifestHash,
      resultsHash,
      resultsUri,
      msg.sender,
      uint64(block.timestamp)
    );
  }
}
