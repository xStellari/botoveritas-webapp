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

interface IElectionRootAnchor {
  function isElectionRootAnchored(bytes32 electionId) external view returns (bool);

  function electionBallotsRoot(bytes32 electionId) external view returns (bytes32);
  function electionManifestHash(bytes32 electionId) external view returns (bytes32);

  function electionBallotsRootField(bytes32 electionId) external view returns (uint256);
  function electionManifestHashField(bytes32 electionId) external view returns (uint256);
}

contract ElectionTallyRegistry {
  // BN254 scalar field (r) for Groth16 public inputs.
  uint256 public constant SNARK_SCALAR_FIELD =
    21888242871839275222246405745257275088548364400416034343698204186575808495617;

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
  IElectionRootAnchor public anchor;
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

  constructor(address verifierAddress, address anchorAddress) {
    require(verifierAddress != address(0), "VERIFIER_ZERO");
    require(anchorAddress != address(0), "ANCHOR_ZERO");
    verifier = ITallyGroth16Verifier(verifierAddress);
    anchor = IElectionRootAnchor(anchorAddress);
    owner = msg.sender;
  }

  function setVerifier(address verifierAddress) external onlyOwner {
    require(verifierAddress != address(0), "VERIFIER_ZERO");
    verifier = ITallyGroth16Verifier(verifierAddress);
  }

  function setAnchor(address anchorAddress) external onlyOwner {
    require(anchorAddress != address(0), "ANCHOR_ZERO");
    anchor = IElectionRootAnchor(anchorAddress);
  }

  function tallyKey(bytes32 electionIdHash, bytes32 electionVoteRoot) public pure returns (bytes32) {
    return keccak256(abi.encodePacked(electionIdHash, electionVoteRoot));
  }

  

  function hasTally(bytes32 electionIdHash, bytes32 electionVoteRoot) external view returns (bool) {
    bytes32 key = tallyKey(electionIdHash, electionVoteRoot);
    return _tallies[key].submittedAt != 0;
  }

  function getTally(bytes32 electionIdHash, bytes32 electionVoteRoot) external view returns (TallyRecord memory) {
    bytes32 key = tallyKey(electionIdHash, electionVoteRoot);
    TallyRecord memory rec = _tallies[key];
    require(rec.submittedAt != 0, "TALLY_NOT_FOUND");
    return rec;
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

    // Canonical binding to anchored election state (ZK v2)
    require(anchor.isElectionRootAnchored(electionIdHash), "ELECTION_NOT_ANCHORED");
    require(anchor.electionBallotsRoot(electionIdHash) == electionVoteRoot, "ROOT_MISMATCH");

    bytes32 anchoredManifest = anchor.electionManifestHash(electionIdHash);
    require(anchoredManifest != bytes32(0), "MANIFEST_NOT_ANCHORED");
    require(anchoredManifest == manifestHash, "MANIFEST_MISMATCH");

    // Ensure resultsHash is a valid BN254 field element.
    uint256 resultsField = uint256(resultsHash);
    require(resultsField < SNARK_SCALAR_FIELD, "RESULTS_HASH_NOT_FIELD");

    // Defensive cross-check: stored field-reduced anchors match our conversion.
    require(anchor.electionBallotsRootField(electionIdHash) == _toField(electionVoteRoot), "ROOT_FIELD_MISMATCH");
    require(anchor.electionManifestHashField(electionIdHash) == _toField(manifestHash), "MANIFEST_FIELD_MISMATCH");

    uint256[4] memory input = [
      _toField(electionIdHash),
      _toField(electionVoteRoot),
      _toField(manifestHash),
      resultsField
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

  function _toField(bytes32 x) internal pure returns (uint256) {
    return uint256(x) % SNARK_SCALAR_FIELD;
  }
}
