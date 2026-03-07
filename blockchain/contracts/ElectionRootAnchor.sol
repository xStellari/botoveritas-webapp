// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ElectionRootAnchor
 * - Minimal on-chain anchor for election ballot-set commitments (Merkle roots)
 * - Owner-only, one-time anchor per electionId
 *
 * Purpose (Objective #5):
 * - To prove election tallies in ZK against *on-chain anchored voting data*,
 *   the chain must store a cryptographic commitment to the ballot set.
 *
 * This contract stores:
 *   electionId(bytes32) -> merkleRoot(bytes32)
 *
 * Notes:
 * - electionId should be the same bytes32 you already use in receipts:
 *     electionIdBytes32 = keccak256(utf8Bytes(uuidString))
 * - merkleRoot must be non-zero.
 * - Once anchored, it is locked forever for that electionId.
 */

import "@openzeppelin/contracts/access/Ownable.sol";

contract ElectionRootAnchor is Ownable {
    // BN254 scalar field (r) for Groth16 public inputs.
    // NOTE: Groth16 verifiers expect each public input < r.
    uint256 public constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    mapping(bytes32 => bytes32) private _electionRoot;          // electionId => merkleRoot (bytes32)
    mapping(bytes32 => bytes32) private _electionManifestHash;  // electionId => manifestHash (bytes32)

    // Field-reduced versions for ZK binding (uint256 < r)
    mapping(bytes32 => uint256) private _electionRootField;          // electionId => merkleRootField
    mapping(bytes32 => uint256) private _electionManifestHashField;  // electionId => manifestHashField

    mapping(bytes32 => bool) private _rootAnchored;             // electionId => anchored?

    event ElectionBallotsRootAnchored(
        bytes32 indexed electionId,
        bytes32 indexed merkleRoot,
        address indexed anchoredBy
    );

    event ElectionAnchored(
        bytes32 indexed electionId,
        bytes32 indexed merkleRoot,
        bytes32 indexed manifestHash,
        address anchoredBy
    );

    constructor(address owner_) Ownable(owner_) {}

    /**
     * Anchor (lock) the Merkle root for an election.
     * Owner-only. One-time per electionId.
     */
    function anchorElectionBallotsRoot(bytes32 electionId, bytes32 merkleRoot) external onlyOwner {
        require(electionId != bytes32(0), "Invalid electionId");
        require(merkleRoot != bytes32(0), "Invalid merkleRoot");
        require(!_rootAnchored[electionId], "Root already anchored");

        _electionRoot[electionId] = merkleRoot;
        _electionRootField[electionId] = _toField(merkleRoot);

        // Legacy callers may not provide manifestHash; keep it unset (0x0).
        _electionManifestHash[electionId] = bytes32(0);
        _electionManifestHashField[electionId] = 0;

        _rootAnchored[electionId] = true;

        emit ElectionBallotsRootAnchored(electionId, merkleRoot, msg.sender);
    }

    /**
     * Anchor (lock) both the election ballot root AND the manifest hash.
     * Owner-only. One-time per electionId.
     *
     * This is the canonical anchor set used for ZK v2 binding.
     */
    function anchorElection(bytes32 electionId, bytes32 merkleRoot, bytes32 manifestHash) external onlyOwner {
        require(electionId != bytes32(0), "Invalid electionId");
        require(merkleRoot != bytes32(0), "Invalid merkleRoot");
        require(manifestHash != bytes32(0), "Invalid manifestHash");
        require(!_rootAnchored[electionId], "Root already anchored");

        _electionRoot[electionId] = merkleRoot;
        _electionManifestHash[electionId] = manifestHash;

        _electionRootField[electionId] = _toField(merkleRoot);
        _electionManifestHashField[electionId] = _toField(manifestHash);

        _rootAnchored[electionId] = true;

        emit ElectionAnchored(electionId, merkleRoot, manifestHash, msg.sender);
    }

    /**
     * Read anchored Merkle root (returns 0x0 if not anchored).
     */
    function electionBallotsRoot(bytes32 electionId) external view returns (bytes32) {
        return _electionRoot[electionId];
    }

    /**
     * Read anchored manifest hash (returns 0x0 if not anchored or anchored via legacy root-only path).
     */
    function electionManifestHash(bytes32 electionId) external view returns (bytes32) {
        return _electionManifestHash[electionId];
    }

    /**
     * Read anchored Merkle root reduced into BN254 scalar field.
     */
    function electionBallotsRootField(bytes32 electionId) external view returns (uint256) {
        return _electionRootField[electionId];
    }

    /**
     * Read anchored manifest hash reduced into BN254 scalar field.
     */
    function electionManifestHashField(bytes32 electionId) external view returns (uint256) {
        return _electionManifestHashField[electionId];
    }

    /**
     * True if the root is anchored (locked) for an election.
     */
    function isElectionRootAnchored(bytes32 electionId) external view returns (bool) {
        return _rootAnchored[electionId];
    }

    function _toField(bytes32 x) internal pure returns (uint256) {
        return uint256(x) % SNARK_SCALAR_FIELD;
    }
}
