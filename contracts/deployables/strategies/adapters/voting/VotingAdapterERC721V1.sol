// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IStrategyV1} from "../../../../interfaces/decent/deployables/IStrategyV1.sol";
import {IVotingAdapterERC721V1} from "../../../../interfaces/decent/deployables/IVotingAdapterERC721V1.sol";
import {IVotingAdapterBase} from "../../../../interfaces/decent/deployables/IVotingAdapterBase.sol";
import {IVersion} from "../../../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlock} from "../../../../interfaces/decent/IDeploymentBlock.sol";
import {VotingAdapterBase} from "./VotingAdapterBase.sol";
import {DeploymentBlock} from "../../../../DeploymentBlock.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/**
 * @title VotingAdapterERC721V1
 * @author Decent Labs
 * @notice Implementation of voting adapter for ERC721 NFT-based voting
 * @dev This contract implements IVotingAdapterERC721V1, enabling voting with NFTs
 * where each NFT provides equal voting weight.
 *
 * Implementation details:
 * - Uses EIP-7201 namespaced storage pattern for upgradeability safety
 * - Non-upgradeable contract deployed per voting strategy
 * - Allows multiple votes from same address using different NFTs
 * - Validates current ownership (no historical snapshots)
 * - Tracks NFT usage per proposal to prevent double voting
 * - Weight calculation: number of valid NFTs × weightPerToken
 * - Requires encoding token IDs in vote data: abi.encode(uint256[])
 *
 * @custom:security-contact security@decentlabs.io
 */
contract VotingAdapterERC721V1 is
    IVotingAdapterERC721V1,
    IVersion,
    VotingAdapterBase,
    DeploymentBlock,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /**
     * @notice Main storage struct for VotingAdapterERC721V1 following EIP-7201
     * @dev Contains token configuration and NFT usage tracking mappings
     * @custom:storage-location erc7201:Decent.VotingAdapterERC721.main
     */
    struct VotingAdapterERC721Storage {
        /** @notice The ERC721 token contract used for voting */
        IERC721 token;
        /** @notice Voting weight assigned to each NFT */
        uint256 weightPerToken;
        /** @notice Tracks which NFTs have been used for each proposal */
        mapping(uint32 proposalId => mapping(uint256 tokenId => bool hasBeenUsedForVote)) tokenIdUsedForVote;
        /** @notice Tracks NFT usage for freeze proposals per freeze contract */
        mapping(address freezeVoteContract => mapping(uint48 freezeProposalSnapshotAndId => mapping(uint256 tokenId => bool hasBeenUsedForVote))) tokenIdUsedPerFreezeVoteProposalPerFreezeVoteContract;
    }

    /**
     * @dev Storage slot for VotingAdapterERC721Storage calculated using EIP-7201 formula:
     * keccak256(abi.encode(uint256(keccak256("Decent.VotingAdapterERC721.main")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 internal constant VOTING_ADAPTER_ERC721_STORAGE_LOCATION =
        0x925db2005a4192e8c1dc9f83d487902a8179279166e1b104a102067b1083a200;

    /**
     * @dev Returns the storage struct for VotingAdapterERC721V1
     * Following the EIP-7201 namespaced storage pattern to avoid storage collisions
     */
    function _getVotingAdapterERC721Storage()
        internal
        pure
        returns (VotingAdapterERC721Storage storage $)
    {
        assembly {
            $.slot := VOTING_ADAPTER_ERC721_STORAGE_LOCATION
        }
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    /**
     * @inheritdoc IVotingAdapterERC721V1
     */
    function initialize(
        address token_,
        address strategy_,
        uint256 weightPerToken_
    ) public virtual override initializer {
        __VotingAdapterBase_init(strategy_);
        __DeploymentBlock_init();

        VotingAdapterERC721Storage storage $ = _getVotingAdapterERC721Storage();
        $.token = IERC721(token_);
        $.weightPerToken = weightPerToken_;
    }

    // ======================================================================
    // IVotingAdapterERC721V1
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IVotingAdapterERC721V1
     */
    function token() public view virtual override returns (address) {
        VotingAdapterERC721Storage storage $ = _getVotingAdapterERC721Storage();
        return address($.token);
    }

    /**
     * @inheritdoc IVotingAdapterERC721V1
     */
    function weightPerToken() public view virtual override returns (uint256) {
        VotingAdapterERC721Storage storage $ = _getVotingAdapterERC721Storage();
        return $.weightPerToken;
    }

    /**
     * @inheritdoc IVotingAdapterERC721V1
     * @dev Reverts if proposal doesn't exist to prevent querying uninitialized proposals
     */
    function tokenIdUsedForVote(
        uint32 proposalId_,
        uint256 tokenId_
    ) public view virtual override returns (bool) {
        VotingAdapterBaseStorage storage $base = _getVotingAdapterBaseStorage();

        if (
            $base
                .strategy
                .proposalVotingDetails(proposalId_)
                .votingEndTimestamp == 0
        ) {
            revert ProposalNotInitialized();
        }

        VotingAdapterERC721Storage storage $ = _getVotingAdapterERC721Storage();

        return $.tokenIdUsedForVote[proposalId_][tokenId_];
    }

    /**
     * @inheritdoc IVotingAdapterERC721V1
     * @dev Decodes token IDs and validates ownership and usage status
     */
    function weightOfWithValidTokenIds(
        address voter_,
        uint32 proposalId_,
        bytes calldata adapterVoteData_
    ) public view virtual override returns (uint256, uint256[] memory) {
        uint256[] memory allTokenIds = _decodeTokenIds(adapterVoteData_);
        return _getValidTokenIds(voter_, proposalId_, allTokenIds);
    }

    /**
     * @inheritdoc IVotingAdapterERC721V1
     * @dev Performs multi-step validation:
     * 1. Removes duplicates from provided token IDs
     * 2. Filters to only tokens owned by voter
     * 3. Filters to only tokens not used for this freeze proposal
     * 4. Calculates total weight based on valid tokens
     */
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

        // Step 1: Remove duplicates
        uint256[] memory uniqueTokenIds = _getUniqueTokenIds(allTokenIds);
        if (uniqueTokenIds.length == 0) {
            return 0;
        }

        // Step 2: Filter to owned tokens
        uint256[] memory ownedTokenIds = _getOwnedTokenIds(
            voter_,
            uniqueTokenIds
        );
        if (ownedTokenIds.length == 0) {
            return 0;
        }

        // Step 3: Filter to unused tokens for this freeze proposal
        uint256[] memory validTokenIds = _getUnusedFreezeTokenIds(
            freezeVoteContract_,
            freezeProposalSnapshotAndId_,
            ownedTokenIds
        );
        if (validTokenIds.length == 0) {
            return 0;
        }

        // Step 4: Calculate weight
        VotingAdapterERC721Storage storage $ = _getVotingAdapterERC721Storage();

        return validTokenIds.length * $.weightPerToken;
    }

    /**
     * @inheritdoc IVotingAdapterERC721V1
     */
    function tokenIdUsedPerFreezeVoteProposalPerFreezeVoteContract(
        address freezeVoteContract_,
        uint48 freezeProposalSnapshotAndId_,
        uint256 tokenId_
    ) public view virtual override returns (bool) {
        VotingAdapterERC721Storage storage $ = _getVotingAdapterERC721Storage();

        return
            $.tokenIdUsedPerFreezeVoteProposalPerFreezeVoteContract[
                freezeVoteContract_
            ][freezeProposalSnapshotAndId_][tokenId_];
    }

    // ======================================================================
    // IVotingAdapterBase
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IVotingAdapterBase
     * @dev Calculates voting weight based on valid NFTs owned by voter
     */
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

    /**
     * @inheritdoc IVotingAdapterBase
     * @dev Validates that:
     * 1. Proposal exists
     * 2. All provided token IDs are valid (owned and unused)
     * 3. Total voting weight is greater than zero
     */
    function validVotingAdapterVote(
        address voter_,
        uint32 proposalId_,
        bytes calldata adapterVoteData_
    ) public view virtual override returns (bool, uint256) {
        VotingAdapterBaseStorage storage $base = _getVotingAdapterBaseStorage();

        // Check 1: Verify the proposal exists and is initialized
        // A proposal with votingEndTimestamp == 0 has not been initialized
        if (
            $base
                .strategy
                .proposalVotingDetails(proposalId_)
                .votingEndTimestamp == 0
        ) {
            return (false, 0); // Invalid: proposal doesn't exist
        }

        // Decode the NFT token IDs the voter wants to use
        uint256[] memory allTokenIds = _decodeTokenIds(adapterVoteData_);

        // Validate token IDs: removes duplicates, checks ownership, and usage
        // Returns both the total weight and the list of valid token IDs
        (
            uint256 votingWeight,
            uint256[] memory validTokenIds
        ) = _getValidTokenIdsSafe(voter_, proposalId_, allTokenIds);

        // Check 2: All provided token IDs must be valid (owned and unused)
        // This prevents partial votes where some NFTs are invalid
        if (validTokenIds.length != allTokenIds.length || votingWeight == 0) {
            return (false, 0); // Invalid: some NFTs are invalid or no voting weight
        }

        // All checks passed - vote is valid
        return (true, votingWeight);
    }

    // --- State-Changing Functions ---

    /**
     * @inheritdoc IVotingAdapterBase
     * @dev Records freeze vote using provided NFT token IDs. Validates ownership and
     * prevents reuse of NFTs within the same freeze proposal. Unlike regular votes,
     * tracks usage per freeze contract to support multiple child DAOs.
     */
    function recordFreezeVote(
        address voter_,
        uint48 freezeProposalSnapshotAndId_,
        bytes calldata adapterVoteData_
    ) public virtual override onlyAuthorizedFreezeVoter returns (uint256) {
        // Decode the NFT token IDs from the vote data
        uint256[] memory tokenIds = _decodeTokenIds(adapterVoteData_);

        VotingAdapterERC721Storage storage $ = _getVotingAdapterERC721Storage();

        // Validate each token ID provided by the voter
        for (uint256 i = 0; i < tokenIds.length; ) {
            uint256 tokenId = tokenIds[i];

            // Check 1: Verify the voter actually owns this NFT
            // Note: This is current ownership, not historical
            if ($.token.ownerOf(tokenId) != voter_) {
                revert TokenIdNotOwnedByVoter(tokenId);
            }

            // Check 2: Ensure this NFT hasn't been used for this freeze proposal
            // The key includes msg.sender (freeze contract) to allow same NFT
            // to be used across different freeze contracts
            if (
                $.tokenIdUsedPerFreezeVoteProposalPerFreezeVoteContract[
                    msg.sender
                ][freezeProposalSnapshotAndId_][tokenId]
            ) {
                revert TokenIdAlreadyUsedForVote(tokenId);
            }

            // Mark this NFT as used for this freeze proposal from this contract
            // This prevents double-voting with the same NFT
            $.tokenIdUsedPerFreezeVoteProposalPerFreezeVoteContract[msg.sender][
                freezeProposalSnapshotAndId_
            ][tokenId] = true;

            unchecked {
                ++i;
            }
        }

        // Calculate total voting weight based on number of valid NFTs
        uint256 totalWeight = tokenIds.length * $.weightPerToken;

        // Ensure the vote has non-zero weight
        if (totalWeight == 0) {
            revert NoFreezeVotingWeight();
        }

        // Emit event with the original vote data for transparency
        emit FreezeVoteRecorded(
            voter_,
            freezeProposalSnapshotAndId_,
            totalWeight,
            adapterVoteData_
        );

        return totalWeight;
    }

    /**
     * @inheritdoc IVotingAdapterBase
     * @dev Records vote using provided NFT token IDs. Validates:
     * 1. Proposal exists and is initialized
     * 2. Each NFT is owned by the voter
     * 3. Each NFT hasn't been used for this proposal
     * Marks all NFTs as used before returning total weight.
     */
    function recordVote(
        address voter_,
        uint32 proposalId_,
        bytes calldata adapterVoteData_
    ) public virtual override onlyStrategy returns (uint256) {
        VotingAdapterBaseStorage storage $base = _getVotingAdapterBaseStorage();

        // First check: Ensure the proposal exists and is initialized
        // This prevents voting on non-existent proposals
        if (
            $base
                .strategy
                .proposalVotingDetails(proposalId_)
                .votingEndTimestamp == 0
        ) {
            revert ProposalNotInitialized();
        }

        // Decode the NFT token IDs from the vote data
        uint256[] memory tokenIds = _decodeTokenIds(adapterVoteData_);

        VotingAdapterERC721Storage storage $ = _getVotingAdapterERC721Storage();

        // Validate and record each token ID
        for (uint256 i = 0; i < tokenIds.length; ) {
            uint256 tokenId = tokenIds[i];

            // Check 1: Verify current ownership of the NFT
            // Unlike ERC20 voting, this checks current state, not historical
            if ($.token.ownerOf(tokenId) != voter_) {
                revert TokenIdNotOwnedByVoter(tokenId);
            }

            // Check 2: Ensure this NFT hasn't already voted on this proposal
            // Each NFT can only be used once per proposal
            if ($.tokenIdUsedForVote[proposalId_][tokenId]) {
                revert TokenIdAlreadyUsedForVote(tokenId);
            }

            // Mark this NFT as used for this proposal
            // This is done before weight calculation (checks-effects pattern)
            $.tokenIdUsedForVote[proposalId_][tokenId] = true;

            unchecked {
                ++i;
            }
        }

        // Calculate total weight: number of valid NFTs × weight per NFT
        uint256 weightCasted = tokenIds.length * $.weightPerToken;

        // Emit event with calculated weight and original vote data
        emit VoteRecorded(voter_, proposalId_, weightCasted, adapterVoteData_);

        return weightCasted;
    }

    // ======================================================================
    // IVersion
    // ======================================================================

    // --- Pure Functions ---

    /**
     * @inheritdoc IVersion
     */
    function version() public pure virtual override returns (uint16) {
        return 1;
    }

    // ======================================================================
    // ERC165
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc ERC165
     * @dev Supports IVotingAdapterERC721V1, IVotingAdapterBase, IVersion, IDeploymentBlock, and IERC165
     */
    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IVotingAdapterERC721V1).interfaceId ||
            interfaceId_ == type(IVotingAdapterBase).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlock).interfaceId ||
            super.supportsInterface(interfaceId_);
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    /**
     * @notice Filters token IDs to only those not used for a specific freeze proposal
     * @dev Uses assembly to resize the array efficiently
     * @param freezeVoteContract_ The freeze voting contract to check against
     * @param freezeProposalSnapshotAndId_ The freeze proposal identifier
     * @param tokenIds_ Array of token IDs to filter
     * @return Array containing only unused token IDs
     */
    function _getUnusedFreezeTokenIds(
        address freezeVoteContract_,
        uint48 freezeProposalSnapshotAndId_,
        uint256[] memory tokenIds_
    ) internal view virtual returns (uint256[] memory) {
        // Allocate array with maximum possible size (all tokens unused)
        uint256[] memory unusedFreezeTokenIds = new uint256[](tokenIds_.length);
        uint256 unusedTokenCount = 0;

        VotingAdapterERC721Storage storage $ = _getVotingAdapterERC721Storage();

        // Check usage status of each token ID for this specific freeze proposal
        for (uint256 i = 0; i < tokenIds_.length; ) {
            // Check if NFT has been used for this freeze proposal from this freeze contract
            // The nested mapping allows same NFT to be used across different freeze contracts
            if (
                !$.tokenIdUsedPerFreezeVoteProposalPerFreezeVoteContract[
                    freezeVoteContract_
                ][freezeProposalSnapshotAndId_][tokenIds_[i]]
            ) {
                // Add to unused list if not yet used for this specific context
                unusedFreezeTokenIds[unusedTokenCount] = tokenIds_[i];
                unusedTokenCount++;
            }
            // If already used for this freeze proposal, skip it

            unchecked {
                ++i;
            }
        }

        // Resize array to actual count of unused tokens
        assembly {
            mstore(unusedFreezeTokenIds, unusedTokenCount)
        }

        return unusedFreezeTokenIds;
    }

    /**
     * @notice Decodes vote data to extract NFT token IDs
     * @dev Expected format: abi.encode(uint256[])
     * @param adapterVoteData_ Encoded array of token IDs
     * @return Array of decoded token IDs
     */
    function _decodeTokenIds(
        bytes calldata adapterVoteData_
    ) internal pure virtual returns (uint256[] memory) {
        return abi.decode(adapterVoteData_, (uint256[]));
    }

    /**
     * @notice Removes duplicate token IDs from an array
     * @dev O(n²) complexity but acceptable for typical NFT vote sizes.
     * Uses assembly to resize the result array.
     * @param tokenIds_ Array potentially containing duplicates
     * @return Array with unique token IDs only
     */
    function _getUniqueTokenIds(
        uint256[] memory tokenIds_
    ) internal pure virtual returns (uint256[] memory) {
        // Allocate array with maximum possible size (all tokens unique)
        uint256[] memory uniqueTokenIds = new uint256[](tokenIds_.length);
        uint256 uniqueCount = 0;

        // Iterate through all provided token IDs
        for (uint256 i = 0; i < tokenIds_.length; ) {
            bool isDuplicate = false;

            // Check if this token ID already exists in our unique list
            // Note: O(n²) complexity but acceptable for typical NFT vote sizes
            for (uint256 j = 0; j < uniqueCount; ) {
                if (uniqueTokenIds[j] == tokenIds_[i]) {
                    isDuplicate = true;
                    break; // Found duplicate, no need to check further
                }

                unchecked {
                    ++j;
                }
            }

            // Only add to unique list if not a duplicate
            if (!isDuplicate) {
                uniqueTokenIds[uniqueCount] = tokenIds_[i];
                uniqueCount++;
            }

            unchecked {
                ++i;
            }
        }

        // Resize the array to actual unique count using assembly
        // This is more gas efficient than creating a new array
        assembly {
            mstore(uniqueTokenIds, uniqueCount)
        }

        return uniqueTokenIds;
    }

    /**
     * @notice Filters token IDs to only those owned by the voter
     * @dev Queries current ownership state (no historical snapshots).
     * Uses assembly to resize the result array.
     * @param voter_ Address to check ownership for
     * @param tokenIds_ Array of token IDs to check
     * @return Array containing only token IDs owned by voter
     */
    function _getOwnedTokenIds(
        address voter_,
        uint256[] memory tokenIds_
    ) internal view virtual returns (uint256[] memory) {
        // Allocate array with maximum possible size (all tokens owned)
        uint256[] memory ownedTokenIds = new uint256[](tokenIds_.length);
        uint256 ownedTokenCount = 0;

        VotingAdapterERC721Storage storage $ = _getVotingAdapterERC721Storage();

        // Check ownership of each token ID
        for (uint256 i = 0; i < tokenIds_.length; ) {
            // Query current ownership from the NFT contract
            // Note: This will revert if tokenId doesn't exist
            if ($.token.ownerOf(tokenIds_[i]) == voter_) {
                // Add to owned list if voter is the current owner
                ownedTokenIds[ownedTokenCount] = tokenIds_[i];
                ownedTokenCount++;
            }
            // If not owned, silently skip (don't add to result)

            unchecked {
                ++i;
            }
        }

        // Resize array to actual count of owned tokens
        assembly {
            mstore(ownedTokenIds, ownedTokenCount)
        }

        return ownedTokenIds;
    }

    /**
     * @notice Filters token IDs to only those not used for a specific proposal
     * @dev Uses assembly to resize the result array efficiently
     * @param proposalId_ The proposal to check against
     * @param tokenIds_ Array of token IDs to filter
     * @return Array containing only unused token IDs
     */
    function _getUnusedTokenIds(
        uint32 proposalId_,
        uint256[] memory tokenIds_
    ) internal view virtual returns (uint256[] memory) {
        // Allocate array with maximum possible size (all tokens unused)
        uint256[] memory unusedTokenIds = new uint256[](tokenIds_.length);
        uint256 unusedTokenCount = 0;

        VotingAdapterERC721Storage storage $ = _getVotingAdapterERC721Storage();

        // Check usage status of each token ID for this proposal
        for (uint256 i = 0; i < tokenIds_.length; ) {
            // Check if this NFT has already been used to vote on this proposal
            if (!$.tokenIdUsedForVote[proposalId_][tokenIds_[i]]) {
                // Add to unused list if not yet used
                unusedTokenIds[unusedTokenCount] = tokenIds_[i];
                unusedTokenCount++;
            }
            // If already used, silently skip (prevents double voting)

            unchecked {
                ++i;
            }
        }

        // Resize array to actual count of unused tokens
        assembly {
            mstore(unusedTokenIds, unusedTokenCount)
        }

        return unusedTokenIds;
    }

    /**
     * @notice Gets valid token IDs and calculates total weight (safe version)
     * @dev Performs full validation: uniqueness, ownership, and usage checks.
     * Does not revert on invalid proposal.
     * @param voter_ Address attempting to vote
     * @param proposalId_ The proposal being voted on
     * @param allTokenIds_ All token IDs provided by voter
     * @return Total voting weight and array of valid token IDs
     */
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

        VotingAdapterERC721Storage storage $ = _getVotingAdapterERC721Storage();

        return (unusedTokenIds.length * $.weightPerToken, unusedTokenIds);
    }

    /**
     * @notice Gets valid token IDs and calculates total weight (reverting version)
     * @dev Same as _getValidTokenIdsSafe but reverts if proposal not initialized
     * @param voter_ Address attempting to vote
     * @param proposalId_ The proposal being voted on
     * @param allTokenIds_ All token IDs provided by voter
     * @return Total voting weight and array of valid token IDs
     * @custom:throws ProposalNotInitialized if proposal doesn't exist
     */
    function _getValidTokenIds(
        address voter_,
        uint32 proposalId_,
        uint256[] memory allTokenIds_
    ) internal view virtual returns (uint256, uint256[] memory) {
        VotingAdapterBaseStorage storage $base = _getVotingAdapterBaseStorage();

        if (
            $base
                .strategy
                .proposalVotingDetails(proposalId_)
                .votingEndTimestamp == 0
        ) {
            revert ProposalNotInitialized();
        }

        return _getValidTokenIdsSafe(voter_, proposalId_, allTokenIds_);
    }
}
