// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ParticipationNFT
 * - Minimal ERC-721 receipt NFT (proof-of-participation)
 * - Admin/custodial wallet receives minted NFTs (voters have no wallets)
 * - Admin-only minting (owner) for thesis defensibility
 *
 * Notes:
 * - Keeps on-chain state minimal: tokenId, owner, optional baseURI
 * - You can later attach off-chain metadata (IPFS/HTTPS) via baseURI
 */

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ParticipationNFT is ERC721, Ownable {
    uint256 private _nextTokenId;

    // Optional base URI for token metadata.
    // Example: "https://your-domain/metadata/" -> tokenURI becomes base + tokenId
    string private _baseTokenURI;

    event ReceiptMinted(
        address indexed to,
        uint256 indexed tokenId,
        bytes32 indexed electionId,
        bytes32 voterIdHash
    );

    constructor(
        string memory name_,
        string memory symbol_,
        address owner_,
        string memory baseURI_
    ) ERC721(name_, symbol_) Ownable(owner_) {
        _baseTokenURI = baseURI_;
        _nextTokenId = 1; // start at 1 for human-friendly receipts
    }

    /**
     * Admin-only mint.
     *
     * @param to Custodial/admin wallet address (recipient).
     * @param electionId A bytes32 identifier for election (e.g., keccak256(uuid string)).
     * @param voterIdHash A bytes32 hash of voter_id (or other stable voter reference). Optional, but useful for audit.
     *
     * Returns newly minted tokenId.
     */
    function mintReceipt(
        address to,
        bytes32 electionId,
        bytes32 voterIdHash
    ) external onlyOwner returns (uint256 tokenId) {
        require(to != address(0), "Invalid recipient");

        tokenId = _nextTokenId;
        _nextTokenId += 1;

        _safeMint(to, tokenId);

        emit ReceiptMinted(to, tokenId, electionId, voterIdHash);
    }

    /**
     * Update base URI (admin-only).
     * Useful if you host metadata later.
     */
    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        _baseTokenURI = newBaseURI;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    /**
     * View next token id (for monitoring).
     */
    function nextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }
}
