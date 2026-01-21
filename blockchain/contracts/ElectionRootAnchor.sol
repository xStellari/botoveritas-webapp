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
    mapping(bytes32 => bytes32) private _electionRoot;     // electionId => merkleRoot
    mapping(bytes32 => bool) private _rootAnchored;        // electionId => anchored?

    event ElectionBallotsRootAnchored(
        bytes32 indexed electionId,
        bytes32 indexed merkleRoot,
        address indexed anchoredBy
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
        _rootAnchored[electionId] = true;

        emit ElectionBallotsRootAnchored(electionId, merkleRoot, msg.sender);
    }

    /**
     * Read anchored Merkle root (returns 0x0 if not anchored).
     */
    function electionBallotsRoot(bytes32 electionId) external view returns (bytes32) {
        return _electionRoot[electionId];
    }

    /**
     * True if the root is anchored (locked) for an election.
     */
    function isElectionRootAnchored(bytes32 electionId) external view returns (bool) {
        return _rootAnchored[electionId];
    }
}
