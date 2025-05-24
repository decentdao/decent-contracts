// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {ITokenAdapterV1} from "../../../interfaces/decent/deployables/ITokenAdapterV1.sol";
import {ITokenAdapterBaseV1} from "../../../interfaces/decent/deployables/ITokenAdapterBaseV1.sol";
import {IStrategyBaseV1} from "../../../interfaces/decent/deployables/IStrategyBaseV1.sol";
import {ClockMode} from "../../../interfaces/decent/ClockMode.sol";
import {Version} from "../../Version.sol";
import {ClockModeLib} from "../../../libs/ClockModeLib.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract ERC20TokenAdapterV1 is
    ITokenAdapterV1,
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ERC165,
    Version
{
    IVotes public token;
    IStrategyBaseV1 public strategy;
    uint256 public proposerThreshold;
    uint256 public weightPerToken;
    ClockMode internal tokenClockMode;

    mapping(uint32 => mapping(address => bool))
        internal _hasCastedVoteForProposal;

    uint16 public constant VERSION = 1;

    event TokenAdapterParametersUpdated(
        uint256 newProposerThreshold,
        uint256 newWeightPerToken
    );

    error InvalidTokenAddress();
    error InvalidStrategyAddress();
    error ProposalNotReadyForSnapshot();
    error ERC20AlreadyVoted();
    error InvalidWeightPerToken();

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _initialOwner,
        address _token,
        address _strategy,
        uint256 _proposerThreshold,
        uint256 _weightPerToken
    ) external initializer {
        __Ownable_init(_initialOwner);
        __UUPSUpgradeable_init();

        if (_token == address(0)) revert InvalidTokenAddress();
        if (_strategy == address(0)) revert InvalidStrategyAddress();

        _updateWeightPerToken(_weightPerToken);
        _updateProposerThreshold(_proposerThreshold);

        token = IVotes(_token);
        strategy = IStrategyBaseV1(_strategy);
        tokenClockMode = ClockModeLib.getClockMode(_token);

        emit TokenAdapterParametersUpdated(proposerThreshold, weightPerToken);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    function updateProposerThreshold(
        uint256 _newProposerThreshold
    ) external onlyOwner {
        _updateProposerThreshold(_newProposerThreshold);
        emit TokenAdapterParametersUpdated(proposerThreshold, weightPerToken);
    }

    function updateWeightPerToken(
        uint256 _newWeightPerToken
    ) external onlyOwner {
        _updateWeightPerToken(_newWeightPerToken);
        emit TokenAdapterParametersUpdated(proposerThreshold, weightPerToken);
    }

    function _updateProposerThreshold(uint256 _newProposerThreshold) internal {
        proposerThreshold = _newProposerThreshold;
    }

    function _updateWeightPerToken(uint256 _newWeightPerToken) internal {
        if (_newWeightPerToken == 0) revert InvalidWeightPerToken();
        weightPerToken = _newWeightPerToken;
    }

    function _getVoteWeightDetails(
        address _voter,
        uint32 _proposalId
    ) internal view returns (uint256 weight) {
        uint256 rawVotes;
        if (tokenClockMode == ClockMode.Timestamp) {
            (uint48 startTimestamp, ) = strategy.getVotingTimestamps(
                _proposalId
            );
            if (startTimestamp == 0) revert ProposalNotReadyForSnapshot();
            rawVotes = token.getPastVotes(_voter, startTimestamp);
        } else {
            uint32 startBlock = strategy.getVotingStartBlock(_proposalId);
            if (startBlock == 0) revert ProposalNotReadyForSnapshot();
            rawVotes = token.getPastVotes(_voter, startBlock);
        }
        weight = rawVotes * weightPerToken;
    }

    function weightOf(
        address _voter,
        uint32 _proposalId,
        bytes calldata
    ) external view override returns (uint256 weight) {
        if (_hasCastedVoteForProposal[_proposalId][_voter]) {
            return 0;
        }
        weight = _getVoteWeightDetails(_voter, _proposalId);
    }

    function recordVote(
        address _voter,
        uint32 _proposalId,
        bytes calldata
    ) external override returns (uint256 weightCasted) {
        if (_hasCastedVoteForProposal[_proposalId][_voter]) {
            revert ERC20AlreadyVoted();
        }
        _hasCastedVoteForProposal[_proposalId][_voter] = true;

        weightCasted = _getVoteWeightDetails(_voter, _proposalId);

        emit VoteRecorded(_voter, _proposalId, weightCasted, bytes(""));
    }

    function isProposer(
        address _proposer
    ) external view override returns (bool) {
        uint256 rawVotes = token.getVotes(_proposer);
        return (rawVotes * weightPerToken) >= proposerThreshold;
    }

    function getVersion() public pure override returns (uint16) {
        return VERSION;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC165, Version) returns (bool) {
        return
            interfaceId == type(ITokenAdapterV1).interfaceId ||
            interfaceId == type(ITokenAdapterBaseV1).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
