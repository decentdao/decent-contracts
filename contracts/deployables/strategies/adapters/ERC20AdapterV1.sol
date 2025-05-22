// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {ITokenAdapterV1} from "../../../interfaces/decent/deployables/ITokenAdapterV1.sol";
import {IStrategyV1} from "../../../interfaces/decent/deployables/IStrategyV1.sol";
import {ClockMode} from "../../../interfaces/decent/ClockMode.sol";
import {Version} from "../../Version.sol";
import {ClockModeLib} from "../../../libs/ClockModeLib.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/**
 * @title ERC20Adapter
 * @notice An adapter for ERC20Votes compatible tokens to be used with StrategyV1.
 * It determines voting weight based on past token balances (delegated votes)
 * and can check if an address meets a specific proposer threshold.
 * Ensures a voter can use their snapshotted ERC20 balance only once per proposal via this adapter.
 */
contract ERC20AdapterV1 is
    ITokenAdapterV1,
    Initializable,
    OwnableUpgradeable,
    ERC165,
    Version
{
    IVotes public token;
    IStrategyV1 public strategy;
    uint256 public proposerThreshold;
    uint256 public weightPerToken;
    ClockMode internal clockMode;

    mapping(uint32 => mapping(address => bool))
        internal _hasCastedVoteForProposal;

    uint16 public constant VERSION = 1;

    // --- Events ---
    event AdapterParametersUpdated(
        uint256 newProposerThreshold,
        uint256 newWeightPerToken
    );

    // --- Errors ---
    error InvalidTokenAddress();
    error InvalidStrategyAddress();
    error ProposalNotReadyForSnapshot();
    error ERC20AlreadyVoted();
    error InvalidWeightPerToken();

    /**
     * @dev Prevents the implementation contract from being initialized.
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the ERC20Adapter.
     * @param _initialOwner The initial owner of this adapter contract.
     * @param _token The address of the ERC20Votes token.
     * @param _strategy The address of the StrategyV1 contract this adapter will query for snapshot details.
     * @param _proposerThreshold The minimum past votes required for an address to be a proposer.
     * @param _weightPerToken The weight assigned to each token.
     */
    function initialize(
        address _initialOwner,
        IVotes _token,
        IStrategyV1 _strategy,
        uint256 _proposerThreshold,
        uint256 _weightPerToken
    ) external initializer {
        __Ownable_init(_initialOwner);
        if (address(_token) == address(0)) revert InvalidTokenAddress();
        if (address(_strategy) == address(0)) revert InvalidStrategyAddress();

        _updateWeightPerToken(_weightPerToken); // Validates _weightPerToken > 0
        _updateProposerThreshold(_proposerThreshold); // Sets proposerThreshold

        token = _token;
        strategy = _strategy;

        clockMode = ClockModeLib.getClockMode(address(token));

        emit AdapterParametersUpdated(proposerThreshold, weightPerToken);
    }

    /**
     * @notice Updates the proposer threshold.
     * @param _newProposerThreshold The new proposer threshold.
     */
    function updateProposerThreshold(
        uint256 _newProposerThreshold
    ) external onlyOwner {
        _updateProposerThreshold(_newProposerThreshold);
        emit AdapterParametersUpdated(proposerThreshold, weightPerToken);
    }

    /**
     * @notice Updates the weight per token.
     * @param _newWeightPerToken The new weight per token (must be > 0).
     */
    function updateWeightPerToken(
        uint256 _newWeightPerToken
    ) external onlyOwner {
        _updateWeightPerToken(_newWeightPerToken);
        emit AdapterParametersUpdated(proposerThreshold, weightPerToken);
    }

    // --- Internal Helper Functions ---

    /**
     * @dev Internal function to update the proposer threshold.
     */
    function _updateProposerThreshold(uint256 _newProposerThreshold) internal {
        proposerThreshold = _newProposerThreshold;
    }

    /**
     * @dev Internal function to update the weight per token. Validates input.
     */
    function _updateWeightPerToken(uint256 _newWeightPerToken) internal {
        if (_newWeightPerToken == 0) revert InvalidWeightPerToken();
        weightPerToken = _newWeightPerToken;
    }

    /**
     * @dev Internal helper to get voting weight based on snapshot details from the strategy.
     */
    function _getVoteWeightDetails(
        address _voter,
        uint32 _proposalId
    ) internal view returns (uint256 weight) {
        uint256 rawVotes;
        if (clockMode == ClockMode.Timestamp) {
            (uint48 startTimestamp, ) = strategy.getVotingTimestamps(
                _proposalId
            );
            if (startTimestamp == 0) revert ProposalNotReadyForSnapshot();
            rawVotes = token.getPastVotes(_voter, startTimestamp);
        } else {
            uint32 startBlock = strategy.getProposalBlocks(_proposalId);
            if (startBlock == 0) revert ProposalNotReadyForSnapshot();
            rawVotes = token.getPastVotes(_voter, startBlock);
        }
        return rawVotes * weightPerToken;
    }

    /**
     * @inheritdoc ITokenAdapterV1
     * @dev Returns the snapshotted voting weight if the voter hasn't already used this adapter for this proposal.
     * Returns 0 if already voted via this adapter for this proposal.
     */
    function weightOf(
        address _voter,
        uint32 _proposalId,
        bytes calldata /*_adapterVoteData*/ // Unused for ERC20Adapter
    ) external view override returns (uint256 weight) {
        if (_hasCastedVoteForProposal[_proposalId][_voter]) {
            return 0;
        }
        return _getVoteWeightDetails(_voter, _proposalId);
    }

    /**
     * @inheritdoc ITokenAdapterV1
     * @dev Records that the voter has used their snapshotted ERC20 balance for this proposal via this adapter,
     * and returns the weight. Reverts if already voted.
     */
    function recordVote(
        address _voter,
        uint32 _proposalId,
        bytes calldata /*_adapterVoteData*/ // Unused for ERC20Adapter
    ) external override returns (uint256 weightCasted) {
        if (_hasCastedVoteForProposal[_proposalId][_voter]) {
            revert ERC20AlreadyVoted();
        }

        uint256 currentWeight = _getVoteWeightDetails(_voter, _proposalId);

        _hasCastedVoteForProposal[_proposalId][_voter] = true;
        return currentWeight;
    }

    /**
     * @inheritdoc ITokenAdapterV1
     */
    function isProposer(
        address _proposer
    ) external view override returns (bool) {
        uint256 snapshotPoint = ClockModeLib.getCurrentPoint(clockMode) - 1;
        uint256 rawVotes = token.getPastVotes(_proposer, snapshotPoint);
        return (rawVotes * weightPerToken) >= proposerThreshold;
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
