// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IStrategyV1} from "../../../../interfaces/decent/deployables/IStrategyV1.sol";
import {IVotingAdapterERC721V1} from "../../../../interfaces/decent/deployables/IVotingAdapterERC721V1.sol";
import {IVotingAdapterBaseV1} from "../../../../interfaces/decent/deployables/IVotingAdapterBaseV1.sol";
import {IVersion} from "../../../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlockV1} from "../../../../interfaces/decent/IDeploymentBlockV1.sol";
import {VotingAdapterBaseV1} from "./VotingAdapterBaseV1.sol";
import {DeploymentBlockV1} from "../../../../DeploymentBlockV1.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract VotingAdapterERC721V1 is
    IVotingAdapterERC721V1,
    IVersion,
    VotingAdapterBaseV1,
    DeploymentBlockV1,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    IERC721 internal _token;
    uint256 internal _weightPerToken;
    mapping(uint32 proposalId => mapping(uint256 tokenId => bool hasBeenUsedForVote))
        internal _tokenIdUsedForVote;
    mapping(address freezeVoteContract => mapping(uint48 freezeProposalSnapshotAndId => mapping(uint256 tokenId => bool hasBeenUsedForVote)))
        internal _tokenIdUsedPerFreezeVoteProposalPerFreezeVoteContract;

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address token_,
        address strategy_,
        uint256 weightPerToken_
    ) public virtual override initializer {
        __VotingAdapterBaseV1_init(strategy_);
        __DeploymentBlockV1_init();
        _token = IERC721(token_);
        _weightPerToken = weightPerToken_;
    }

    // ======================================================================
    // IVotingAdapterERC721V1
    // ======================================================================

    // --- View Functions ---

    function token() public view virtual override returns (address) {
        return address(_token);
    }

    function weightPerToken() public view virtual override returns (uint256) {
        return _weightPerToken;
    }

    function tokenIdUsedForVote(
        uint32 proposalId_,
        uint256 tokenId_
    ) public view virtual override returns (bool) {
        if (
            _strategy.proposalVotingDetails(proposalId_).votingEndTimestamp == 0
        ) {
            revert ProposalNotInitialized();
        }
        return _tokenIdUsedForVote[proposalId_][tokenId_];
    }

    function weightOfWithValidTokenIds(
        address voter_,
        uint32 proposalId_,
        bytes calldata adapterVoteData_
    ) public view virtual override returns (uint256, uint256[] memory) {
        uint256[] memory allTokenIds = _decodeTokenIds(adapterVoteData_);
        return _getValidTokenIds(voter_, proposalId_, allTokenIds);
    }

    function getFreezeVoteWeight(
        address voter_,
        address freezeVoteContract_,
        uint48 freezeProposalSnapshotAndId_,
        bytes calldata adapterVoteData_
    ) public view virtual override returns (uint256) {
        uint256[] memory allTokenIds = _decodeTokenIds(adapterVoteData_);
        if (allTokenIds.length == 0) {
            return 0;
        }

        uint256[] memory uniqueTokenIds = _getUniqueTokenIds(allTokenIds);
        if (uniqueTokenIds.length == 0) {
            return 0;
        }

        uint256[] memory ownedTokenIds = _getOwnedTokenIds(
            voter_,
            uniqueTokenIds
        );
        if (ownedTokenIds.length == 0) {
            return 0;
        }

        uint256[] memory validTokenIds = _getUnusedFreezeTokenIds(
            freezeVoteContract_,
            freezeProposalSnapshotAndId_,
            ownedTokenIds
        );
        if (validTokenIds.length == 0) {
            return 0;
        }

        return validTokenIds.length * _weightPerToken;
    }

    function tokenIdUsedPerFreezeVoteProposalPerFreezeVoteContract(
        address freezeVoteContract_,
        uint48 freezeProposalSnapshotAndId_,
        uint256 tokenId_
    ) public view virtual override returns (bool) {
        return
            _tokenIdUsedPerFreezeVoteProposalPerFreezeVoteContract[
                freezeVoteContract_
            ][freezeProposalSnapshotAndId_][tokenId_];
    }

    // ======================================================================
    // IVotingAdapterBaseV1
    // ======================================================================

    // --- View Functions ---

    function weightOf(
        address voter_,
        uint32 proposalId_,
        bytes calldata adapterVoteData_
    ) public view virtual override returns (uint256) {
        uint256[] memory allTokenIds = _decodeTokenIds(adapterVoteData_);
        (uint256 weight, ) = _getValidTokenIds(
            voter_,
            proposalId_,
            allTokenIds
        );

        return weight;
    }

    function validVotingAdapterVote(
        address voter_,
        uint32 proposalId_,
        bytes calldata adapterVoteData_
    ) public view virtual override returns (bool, uint256) {
        if (
            _strategy.proposalVotingDetails(proposalId_).votingEndTimestamp == 0
        ) {
            return (false, 0);
        }
        uint256[] memory allTokenIds = _decodeTokenIds(adapterVoteData_);
        (
            uint256 votingWeight,
            uint256[] memory validTokenIds
        ) = _getValidTokenIdsSafe(voter_, proposalId_, allTokenIds);

        if (validTokenIds.length != allTokenIds.length || votingWeight == 0) {
            return (false, 0);
        }

        return (true, votingWeight);
    }

    // --- State-Changing Functions ---

    function recordFreezeVote(
        address voter_,
        uint48 freezeProposalSnapshotAndId_,
        bytes calldata adapterVoteData_
    ) public virtual override onlyAuthorizedFreezeVoter returns (uint256) {
        uint256[] memory tokenIds = _decodeTokenIds(adapterVoteData_);

        for (uint256 i = 0; i < tokenIds.length; ) {
            uint256 tokenId = tokenIds[i];
            if (_token.ownerOf(tokenId) != voter_) {
                revert TokenIdNotOwnedByVoter(tokenId);
            }
            if (
                _tokenIdUsedPerFreezeVoteProposalPerFreezeVoteContract[
                    msg.sender
                ][freezeProposalSnapshotAndId_][tokenId]
            ) {
                revert TokenIdAlreadyUsedForVote(tokenId);
            }
            _tokenIdUsedPerFreezeVoteProposalPerFreezeVoteContract[msg.sender][
                freezeProposalSnapshotAndId_
            ][tokenId] = true;

            unchecked {
                ++i;
            }
        }

        uint256 totalWeight = tokenIds.length * _weightPerToken;

        if (totalWeight == 0) {
            revert NoFreezeVotingWeight();
        }

        emit FreezeVoteRecorded(
            voter_,
            freezeProposalSnapshotAndId_,
            totalWeight,
            adapterVoteData_
        );

        return totalWeight;
    }

    function recordVote(
        address voter_,
        uint32 proposalId_,
        bytes calldata adapterVoteData_
    ) public virtual override onlyStrategy returns (uint256) {
        if (
            _strategy.proposalVotingDetails(proposalId_).votingEndTimestamp == 0
        ) {
            revert ProposalNotInitialized();
        }

        uint256[] memory tokenIds = _decodeTokenIds(adapterVoteData_);

        for (uint256 i = 0; i < tokenIds.length; ) {
            uint256 tokenId = tokenIds[i];
            if (_token.ownerOf(tokenId) != voter_) {
                revert TokenIdNotOwnedByVoter(tokenId);
            }
            if (_tokenIdUsedForVote[proposalId_][tokenId]) {
                revert TokenIdAlreadyUsedForVote(tokenId);
            }
            _tokenIdUsedForVote[proposalId_][tokenId] = true;

            unchecked {
                ++i;
            }
        }

        uint256 weightCasted = tokenIds.length * _weightPerToken;

        emit VoteRecorded(voter_, proposalId_, weightCasted, adapterVoteData_);

        return weightCasted;
    }

    // ======================================================================
    // IVersion
    // ======================================================================

    // --- Pure Functions ---

    function version() public pure virtual override returns (uint16) {
        return 1;
    }

    // ======================================================================
    // ERC165
    // ======================================================================

    // --- View Functions ---

    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IVotingAdapterERC721V1).interfaceId ||
            interfaceId_ == type(IVotingAdapterBaseV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    function _getUnusedFreezeTokenIds(
        address freezeVoteContract_,
        uint48 freezeProposalSnapshotAndId_,
        uint256[] memory tokenIds_
    ) internal view virtual returns (uint256[] memory) {
        uint256[] memory unusedFreezeTokenIds = new uint256[](tokenIds_.length);
        uint256 unusedTokenCount = 0;

        for (uint256 i = 0; i < tokenIds_.length; ) {
            if (
                !_tokenIdUsedPerFreezeVoteProposalPerFreezeVoteContract[
                    freezeVoteContract_
                ][freezeProposalSnapshotAndId_][tokenIds_[i]]
            ) {
                unusedFreezeTokenIds[unusedTokenCount] = tokenIds_[i];
                unusedTokenCount++;
            }
            unchecked {
                ++i;
            }
        }
        assembly {
            mstore(unusedFreezeTokenIds, unusedTokenCount)
        }

        return unusedFreezeTokenIds;
    }

    function _decodeTokenIds(
        bytes calldata adapterVoteData_
    ) internal pure virtual returns (uint256[] memory) {
        return abi.decode(adapterVoteData_, (uint256[]));
    }

    function _getUniqueTokenIds(
        uint256[] memory tokenIds_
    ) internal pure virtual returns (uint256[] memory) {
        uint256[] memory uniqueTokenIds = new uint256[](tokenIds_.length);
        uint256 uniqueCount = 0;

        for (uint256 i = 0; i < tokenIds_.length; ) {
            bool isDuplicate = false;
            for (uint256 j = 0; j < uniqueCount; ) {
                if (uniqueTokenIds[j] == tokenIds_[i]) {
                    isDuplicate = true;
                    break;
                }

                unchecked {
                    ++j;
                }
            }
            if (!isDuplicate) {
                uniqueTokenIds[uniqueCount] = tokenIds_[i];
                uniqueCount++;
            }

            unchecked {
                ++i;
            }
        }

        assembly {
            mstore(uniqueTokenIds, uniqueCount)
        }

        return uniqueTokenIds;
    }

    function _getOwnedTokenIds(
        address voter_,
        uint256[] memory tokenIds_
    ) internal view virtual returns (uint256[] memory) {
        uint256[] memory ownedTokenIds = new uint256[](tokenIds_.length);
        uint256 ownedTokenCount = 0;

        for (uint256 i = 0; i < tokenIds_.length; ) {
            if (_token.ownerOf(tokenIds_[i]) == voter_) {
                ownedTokenIds[ownedTokenCount] = tokenIds_[i];
                ownedTokenCount++;
            }

            unchecked {
                ++i;
            }
        }

        assembly {
            mstore(ownedTokenIds, ownedTokenCount)
        }

        return ownedTokenIds;
    }

    function _getUnusedTokenIds(
        uint32 proposalId_,
        uint256[] memory tokenIds_
    ) internal view virtual returns (uint256[] memory) {
        uint256[] memory unusedTokenIds = new uint256[](tokenIds_.length);
        uint256 unusedTokenCount = 0;

        for (uint256 i = 0; i < tokenIds_.length; ) {
            if (!_tokenIdUsedForVote[proposalId_][tokenIds_[i]]) {
                unusedTokenIds[unusedTokenCount] = tokenIds_[i];
                unusedTokenCount++;
            }

            unchecked {
                ++i;
            }
        }

        assembly {
            mstore(unusedTokenIds, unusedTokenCount)
        }

        return unusedTokenIds;
    }

    function _getValidTokenIdsSafe(
        address voter_,
        uint32 proposalId_,
        uint256[] memory allTokenIds_
    ) internal view virtual returns (uint256, uint256[] memory) {
        uint256[] memory uniqueTokenIds = _getUniqueTokenIds(allTokenIds_);
        uint256[] memory ownedTokenIds = _getOwnedTokenIds(
            voter_,
            uniqueTokenIds
        );
        uint256[] memory unusedTokenIds = _getUnusedTokenIds(
            proposalId_,
            ownedTokenIds
        );

        return (unusedTokenIds.length * _weightPerToken, unusedTokenIds);
    }

    function _getValidTokenIds(
        address voter_,
        uint32 proposalId_,
        uint256[] memory allTokenIds_
    ) internal view virtual returns (uint256, uint256[] memory) {
        if (
            _strategy.proposalVotingDetails(proposalId_).votingEndTimestamp == 0
        ) {
            revert ProposalNotInitialized();
        }

        return _getValidTokenIdsSafe(voter_, proposalId_, allTokenIds_);
    }
}
