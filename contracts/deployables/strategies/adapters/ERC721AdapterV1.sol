// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {ITokenAdapterV1} from "../../../interfaces/decent/deployables/ITokenAdapterV1.sol";
import {IStrategyV1} from "../../../interfaces/decent/deployables/IStrategyV1.sol"; // Keep for consistency, though not directly used by ERC721 for snapshots in MVP
import {Version} from "../../Version.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/**
 * @title ERC721Adapter
 * @notice An adapter for IERC721 compatible tokens to be used with StrategyV1.
 * It allows voting with specific NFT IDs and ensures each NFT ID is used only once per proposal.
 */
contract ERC721AdapterV1 is ITokenAdapterV1, Initializable, ERC165, Version {
    IERC721 public token;
    IStrategyV1 public strategy; // Kept for interface consistency, proposalId context passed to functions
    uint256 public weightPerNft;
    uint256 public proposerThreshold; // In terms of total weighted vote power from this adapter (based on current balance)

    // proposalId -> tokenId -> used?
    mapping(uint32 => mapping(uint256 => bool)) public nftUsedForVote;

    uint16 public constant VERSION = 1;

    // --- Errors ---
    error InvalidTokenAddress();
    error InvalidStrategyAddress();
    error InvalidWeightPerNft();
    error TokenNotOwnedByVoter(uint256 tokenId);
    error TokenAlreadyRecordedAsVoted(uint256 tokenId); // For recordVote sanity check
    error InvalidAdapterVoteData();

    /**
     * @dev Prevents the implementation contract from being initialized.
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the ERC721Adapter.
     * @param _token The address of the IERC721 token.
     * @param _strategy The address of the StrategyV1 contract.
     * @param _weightPerNft The voting weight assigned to each NFT held.
     * @param _proposerThreshold The minimum total weighted NFT value (based on current balance) for an address to be a proposer.
     */
    function initialize(
        IERC721 _token,
        IStrategyV1 _strategy,
        uint256 _weightPerNft,
        uint256 _proposerThreshold
    ) external initializer {
        if (address(_token) == address(0)) revert InvalidTokenAddress();
        if (address(_strategy) == address(0)) revert InvalidStrategyAddress();
        if (_weightPerNft == 0) revert InvalidWeightPerNft(); // Weight per NFT must be > 0

        token = _token;
        strategy = _strategy;
        weightPerNft = _weightPerNft;
        proposerThreshold = _proposerThreshold;
    }

    /**
     * @dev Internal function to calculate weight from valid, unvoted token IDs.
     * Checks ownership and if tokens have already been used for the proposal.
     * Reverts if a token ID is not owned by the voter.
     * Skips token IDs that have already been recorded in `nftUsedForVote` for this proposal.
     * Ensures duplicate token IDs within the same _adapterVoteData call are counted only once.
     */
    function _getValidUnvotedTokenIdsAndWeight(
        address _voter,
        uint32 _proposalId,
        bytes calldata _adapterVoteData
    )
        internal
        view
        returns (
            uint256[] memory validTokenIdsForThisCall,
            uint256 totalCalculatedWeight
        )
    {
        uint256[] memory tokenIds = abi.decode(_adapterVoteData, (uint256[]));

        if (tokenIds.length == 0) {
            return (new uint256[](0), 0);
        }

        uint256[] memory tempValidTokenIds = new uint256[](tokenIds.length);
        uint256 validCount = 0;

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            if (token.ownerOf(tokenId) != _voter)
                revert TokenNotOwnedByVoter(tokenId);

            if (nftUsedForVote[_proposalId][tokenId]) {
                continue;
            }

            bool alreadyProcessedInThisCall = false;
            for (uint256 j = 0; j < validCount; j++) {
                if (tempValidTokenIds[j] == tokenId) {
                    alreadyProcessedInThisCall = true;
                    break;
                }
            }

            if (!alreadyProcessedInThisCall) {
                tempValidTokenIds[validCount] = tokenId;
                validCount++;
                totalCalculatedWeight += weightPerNft;
            }
        }

        validTokenIdsForThisCall = new uint256[](validCount);
        for (uint256 i = 0; i < validCount; i++) {
            validTokenIdsForThisCall[i] = tempValidTokenIds[i];
        }
    }

    /**
     * @inheritdoc ITokenAdapterV1
     * @dev Calculates weight for specific, unvoted token IDs provided in _adapterVoteData.
     */
    function weightOf(
        address _voter,
        uint32 _proposalId,
        bytes calldata _adapterVoteData
    ) external view override returns (uint256 weight) {
        (, uint256 totalCalculatedWeight) = _getValidUnvotedTokenIdsAndWeight(
            _voter,
            _proposalId,
            _adapterVoteData
        );
        return totalCalculatedWeight;
    }

    /**
     * @inheritdoc ITokenAdapterV1
     * @dev Records a vote for specific token IDs, marking them as used, and returns the weight cast.
     */
    function recordVote(
        address _voter,
        uint32 _proposalId,
        bytes calldata _adapterVoteData
    ) external override returns (uint256 weightCasted) {
        (
            uint256[] memory validTokenIdsToRecord,
            uint256 totalCalculatedWeight
        ) = _getValidUnvotedTokenIdsAndWeight(
                _voter,
                _proposalId,
                _adapterVoteData
            );

        if (totalCalculatedWeight == 0) {
            // This implies _adapterVoteData was empty, or all tokens were already used/invalid (which would have reverted in helper).
            // StrategyV1 will handle NoVotingWeight if this is the only adapter and returns 0.
            return 0;
        }

        for (uint256 i = 0; i < validTokenIdsToRecord.length; i++) {
            uint256 tokenId = validTokenIdsToRecord[i];
            // Sanity check: This token should not have been recorded yet globally by another concurrent call or re-entrancy,
            // as _getValidUnvotedTokenIdsAndWeight checked this. This is a strong assertion.
            if (nftUsedForVote[_proposalId][tokenId])
                revert TokenAlreadyRecordedAsVoted(tokenId);
            nftUsedForVote[_proposalId][tokenId] = true;
        }
        weightCasted = totalCalculatedWeight;
    }

    /**
     * @inheritdoc ITokenAdapterV1
     * @dev Checks proposer status based on *current* total token balance multiplied by weightPerNft.
     */
    function isProposer(
        address _proposer
    ) external view override returns (bool) {
        return (token.balanceOf(_proposer) * weightPerNft) >= proposerThreshold;
    }

    /**
     * @inheritdoc Version
     */
    function getVersion() public pure override returns (uint16) {
        return VERSION;
    }

    /**
     * @dev ERC165 interface support
     */
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC165, Version) returns (bool) {
        return
            interfaceId == type(ITokenAdapterV1).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
