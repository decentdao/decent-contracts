// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {Version} from "../Version.sol";
import {BaseStrategyV1} from "./BaseStrategyV1.sol";
import {ERC4337VoterSupportV1} from "./ERC4337VoterSupportV1.sol";
import {ClockModeLib} from "../../libs/ClockModeLib.sol";
import {IBaseQuorumPercentV1} from "../../interfaces/decent/deployables/IBaseQuorumPercentV1.sol";
import {ClockMode} from "../../interfaces/decent/ClockMode.sol";
import {IBaseVotingBasisPercentV1} from "../../interfaces/decent/deployables/IBaseVotingBasisPercentV1.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/**
 * An [Azorius](./Azorius.md) [BaseStrategy](./BaseStrategy.md) implementation that
 * enables linear (i.e. 1 to 1) token voting. Each token delegated to a given address
 * in an `ERC20Votes` token equals 1 vote for a Proposal.
 */
contract LinearERC20VotingV1 is
    ERC165,
    BaseStrategyV1,
    ERC4337VoterSupportV1,
    Version,
    IBaseQuorumPercentV1,
    IBaseVotingBasisPercentV1
{
    uint16 private constant VERSION = 1;

    /**
     * @dev Constructor that disables initializers
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * The voting options for a Proposal.
     */
    enum VoteType {
        NO, // disapproves of executing the Proposal
        YES, // approves of executing the Proposal
        ABSTAIN // neither YES nor NO, i.e. voting "present"
    }

    /**
     * Defines the current state of votes on a particular Proposal.
     */
    struct ProposalVotes {
        uint48 votingStartTime; // timestamp that voting starts
        uint256 votingStartBlock; // block that voting starts
        uint48 votingEndTime; // timestamp that voting ends
        uint256 noVotes; // current number of NO votes for the Proposal
        uint256 yesVotes; // current number of YES votes for the Proposal
        uint256 abstainVotes; // current number of ABSTAIN votes for the Proposal
        mapping(address => bool) hasVoted; // whether a given address has voted yet or not
    }

    IVotes public governanceToken;

    /** Time that a new Proposal can be voted on. */
    uint32 public votingPeriod;

    /** Voting weight required to be able to submit Proposals. */
    uint256 public requiredProposerWeight;

    /** The numerator to use when calculating quorum (adjustable). */
    uint256 public quorumNumerator;

    /** The denominator to use when calculating quorum (1,000,000). */
    uint256 public constant QUORUM_DENOMINATOR = 1_000_000;

    /** The denominator to use when calculating basis (1,000,000). */
    uint256 public constant BASIS_DENOMINATOR = 1_000_000;

    /** The numerator to use when calculating basis (adjustable). */
    uint256 public basisNumerator;

    /** `proposalId` to `ProposalVotes`, the voting state of a Proposal. */
    mapping(uint256 => ProposalVotes) internal proposalVotes;

    ClockMode public governanceClockMode;

    event VotingPeriodUpdated(uint32 votingPeriod);
    event RequiredProposerWeightUpdated(uint256 requiredProposerWeight);
    event ProposalInitialized(uint32 proposalId, uint48 votingEndTime);
    event Voted(
        address voter,
        uint32 proposalId,
        uint8 voteType,
        uint256 weight
    );

    error InvalidProposal();
    error VotingEnded();
    error AlreadyVoted();
    error InvalidVote();
    error InvalidTokenAddress();

    /**
     * Sets up the contract with its initial parameters.
     *
     * @param _owner Address that will own the contract
     * @param _governanceToken The token used for voting
     * @param _proposalInitializer Address that is allowed to initialize Proposals
     * @param _votingPeriod Time period for voting
     * @param _requiredProposerWeight Minimum weight to create proposals
     * @param _quorumNumerator Numerator for quorum calculation
     * @param _basisNumerator Numerator for basis calculation
     * @param _lightAccountFactory Address of the LightAccountFactory
     */
    function initialize(
        address _owner,
        address _governanceToken,
        address _proposalInitializer,
        uint32 _votingPeriod,
        uint256 _requiredProposerWeight,
        uint256 _quorumNumerator,
        uint256 _basisNumerator,
        address _lightAccountFactory
    ) public initializer {
        if (address(_governanceToken) == address(0))
            revert InvalidTokenAddress();
        governanceToken = IVotes(_governanceToken);
        governanceClockMode = ClockModeLib.getClockMode(_governanceToken);

        BaseStrategyV1.initialize(_owner, _proposalInitializer);
        __ERC4337VoterSupportV1_init(_lightAccountFactory);

        _updateQuorumNumerator(_quorumNumerator);
        _updateBasisNumerator(_basisNumerator);
        _updateVotingPeriod(_votingPeriod);
        _updateRequiredProposerWeight(_requiredProposerWeight);

        emit StrategySetUp(_proposalInitializer, _owner);
    }

    /**
     * @dev Function that authorizes an upgrade to a new implementation.
     * @param newImplementation The address of the new implementation
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal virtual override onlyOwner {}

    /**
     * Updates the voting time period for new Proposals.
     *
     * @param _votingPeriod voting time period (in seconds)
     */
    function updateVotingPeriod(
        uint32 _votingPeriod
    ) external virtual onlyOwner {
        _updateVotingPeriod(_votingPeriod);
    }

    /**
     * Updates the voting weight required to submit new Proposals.
     *
     * @param _requiredProposerWeight required token voting weight
     */
    function updateRequiredProposerWeight(
        uint256 _requiredProposerWeight
    ) external virtual onlyOwner {
        _updateRequiredProposerWeight(_requiredProposerWeight);
    }

    /**
     * Updates the quorum required for future Proposals.
     *
     * @param _quorumNumerator numerator to use when calculating quorum (over 1,000,000)
     */
    function updateQuorumNumerator(
        uint256 _quorumNumerator
    ) public virtual onlyOwner {
        _updateQuorumNumerator(_quorumNumerator);
    }

    /**
     * Updates the `basisNumerator` for future Proposals.
     *
     * @param _basisNumerator numerator to use
     */
    function updateBasisNumerator(
        uint256 _basisNumerator
    ) public virtual onlyOwner {
        _updateBasisNumerator(_basisNumerator);
    }

    /**
     * Casts votes for a Proposal, equal to the caller's token delegation.
     *
     * @param _proposalId id of the Proposal to vote on
     * @param _voteType Proposal support as defined in VoteType (NO, YES, ABSTAIN)
     */
    function vote(uint32 _proposalId, uint8 _voteType) external virtual {
        address voter = voter(msg.sender);
        _vote(
            _proposalId,
            voter,
            _voteType,
            getVotingWeight(voter, _proposalId)
        );
    }

    /**
     * Returns the current state of the specified Proposal.
     *
     * @param _proposalId id of the Proposal
     * @return noVotes current count of "NO" votes
     * @return yesVotes current count of "YES" votes
     * @return abstainVotes current count of "ABSTAIN" votes
     * @return startTime timestamp voting starts
     * @return endTime timestamp voting ends
     * @return votingSupply the total voting supply at the time of proposal creation
     */
    function getProposalVotes(
        uint32 _proposalId
    )
        external
        view
        virtual
        returns (
            uint256 noVotes,
            uint256 yesVotes,
            uint256 abstainVotes,
            uint48 startTime,
            uint48 endTime,
            uint256 votingSupply
        )
    {
        ProposalVotes storage currentProposalVotes = proposalVotes[_proposalId];
        noVotes = currentProposalVotes.noVotes;
        yesVotes = currentProposalVotes.yesVotes;
        abstainVotes = currentProposalVotes.abstainVotes;
        startTime = currentProposalVotes.votingStartTime;
        endTime = currentProposalVotes.votingEndTime;
        votingSupply = getProposalVotingSupply(_proposalId);
    }

    /** @inheritdoc BaseStrategyV1*/
    function initializeProposal(
        bytes memory _data
    ) public virtual override onlyProposalInitializer {
        uint32 proposalId = abi.decode(_data, (uint32));

        uint48 startTime = uint48(block.timestamp);
        uint48 endTime = startTime + votingPeriod;

        proposalVotes[proposalId].votingStartTime = startTime;
        proposalVotes[proposalId].votingStartBlock = block.number;
        proposalVotes[proposalId].votingEndTime = endTime;

        emit ProposalInitialized(proposalId, endTime);
    }

    /**
     * Returns whether an address has voted on the specified Proposal.
     *
     * @param _proposalId id of the Proposal to check
     * @param _address address to check
     * @return bool true if the address has voted on the Proposal, otherwise false
     */
    function hasVoted(
        uint32 _proposalId,
        address _address
    ) public view virtual returns (bool) {
        return proposalVotes[_proposalId].hasVoted[_address];
    }

    /** @inheritdoc BaseStrategyV1*/
    function isPassed(
        uint32 _proposalId
    ) public view virtual override returns (bool) {
        ProposalVotes storage currentProposalVotes = proposalVotes[_proposalId];

        return (block.timestamp > currentProposalVotes.votingEndTime && // voting period has ended
            meetsQuorum(
                getProposalVotingSupply(_proposalId),
                currentProposalVotes.yesVotes,
                currentProposalVotes.abstainVotes
            ) && // yes + abstain votes meets the quorum
            meetsBasis(
                currentProposalVotes.yesVotes,
                currentProposalVotes.noVotes
            )); // yes votes meets the basis
    }

    /**
     * Returns a snapshot of total voting supply for a given Proposal.  Because token supplies can change,
     * it is necessary to calculate quorum from the supply available at the time of the Proposal's creation,
     * not when it is being voted on passes / fails.
     *
     * @param _proposalId id of the Proposal
     * @return uint256 voting supply snapshot for the given _proposalId
     */
    function getProposalVotingSupply(
        uint32 _proposalId
    ) public view virtual returns (uint256) {
        return
            governanceToken.getPastTotalSupply(
                governanceClockMode == ClockMode.Timestamp
                    ? proposalVotes[_proposalId].votingStartTime
                    : proposalVotes[_proposalId].votingStartBlock
            );
    }

    /**
     * Calculates the voting weight an address has for a specific Proposal.
     *
     * @param _voter address of the voter
     * @param _proposalId id of the Proposal
     * @return uint256 the address' voting weight
     */
    function getVotingWeight(
        address _voter,
        uint32 _proposalId
    ) public view virtual returns (uint256) {
        return
            governanceToken.getPastVotes(
                _voter,
                governanceClockMode == ClockMode.Timestamp
                    ? proposalVotes[_proposalId].votingStartTime
                    : proposalVotes[_proposalId].votingStartBlock
            );
    }

    /** @inheritdoc BaseStrategyV1*/
    function isProposer(
        address _address
    ) public view virtual override returns (bool) {
        uint256 lastPoint = ClockModeLib.getCurrentPoint(governanceClockMode) -
            1;
        return
            governanceToken.getPastVotes(_address, lastPoint) >=
            requiredProposerWeight;
    }

    function getVotingTimestamps(
        uint32 _proposalId
    ) public view virtual override returns (uint48, uint48) {
        return (
            proposalVotes[_proposalId].votingStartTime,
            proposalVotes[_proposalId].votingEndTime
        );
    }

    /** Internal implementation of `updateVotingPeriod`. */
    function _updateVotingPeriod(uint32 _votingPeriod) internal virtual {
        votingPeriod = _votingPeriod;
        emit VotingPeriodUpdated(_votingPeriod);
    }

    /** Internal implementation of `updateRequiredProposerWeight`. */
    function _updateRequiredProposerWeight(
        uint256 _requiredProposerWeight
    ) internal virtual {
        requiredProposerWeight = _requiredProposerWeight;
        emit RequiredProposerWeightUpdated(_requiredProposerWeight);
    }

    /** Internal implementation of `updateQuorumNumerator`. */
    function _updateQuorumNumerator(uint256 _quorumNumerator) internal virtual {
        if (_quorumNumerator > QUORUM_DENOMINATOR)
            revert InvalidQuorumNumerator();

        quorumNumerator = _quorumNumerator;

        emit QuorumNumeratorUpdated(_quorumNumerator);
    }

    /** Internal implementation of `updateBasisNumerator`. */
    function _updateBasisNumerator(uint256 _basisNumerator) internal virtual {
        if (
            _basisNumerator > BASIS_DENOMINATOR ||
            _basisNumerator < BASIS_DENOMINATOR / 2
        ) revert InvalidBasisNumerator();

        basisNumerator = _basisNumerator;

        emit BasisNumeratorUpdated(_basisNumerator);
    }

    /**
     * Internal function for casting a vote on a Proposal.
     *
     * @param _proposalId id of the Proposal
     * @param _voter address casting the vote
     * @param _voteType vote support, as defined in VoteType
     * @param _weight amount of voting weight cast, typically the
     *          total number of tokens delegated
     */
    function _vote(
        uint32 _proposalId,
        address _voter,
        uint8 _voteType,
        uint256 _weight
    ) internal virtual {
        if (proposalVotes[_proposalId].votingEndTime == 0)
            revert InvalidProposal();
        if (block.timestamp > proposalVotes[_proposalId].votingEndTime) {
            if (!_votingPeriodEnded[_proposalId]) {
                _votingPeriodEnded[_proposalId] = true;
                emit VotingPeriodEnded(
                    _proposalId,
                    proposalVotes[_proposalId].votingEndTime,
                    uint48(block.timestamp)
                );
                return;
            }
            revert VotingEnded();
        }
        if (proposalVotes[_proposalId].hasVoted[_voter]) revert AlreadyVoted();

        proposalVotes[_proposalId].hasVoted[_voter] = true;

        if (_voteType == uint8(VoteType.NO)) {
            proposalVotes[_proposalId].noVotes += _weight;
        } else if (_voteType == uint8(VoteType.YES)) {
            proposalVotes[_proposalId].yesVotes += _weight;
        } else if (_voteType == uint8(VoteType.ABSTAIN)) {
            proposalVotes[_proposalId].abstainVotes += _weight;
        } else {
            revert InvalidVote();
        }

        emit Voted(_voter, _proposalId, _voteType, _weight);
    }

    /**
     * Calculates whether a vote meets quorum. This is calculated based on yes votes + abstain
     * votes.
     *
     * @param _totalSupply the total supply of tokens
     * @param _yesVotes number of votes in favor
     * @param _abstainVotes number of votes abstaining
     * @return bool whether the total number of yes votes + abstain meets the quorum
     */
    function meetsQuorum(
        uint256 _totalSupply,
        uint256 _yesVotes,
        uint256 _abstainVotes
    ) public view returns (bool) {
        return
            _yesVotes + _abstainVotes >=
            (_totalSupply * quorumNumerator) / QUORUM_DENOMINATOR;
    }

    /**
     * Calculates the total number of votes required for a proposal to meet quorum.
     *
     * @param _proposalId The ID of the proposal to get quorum votes for
     * @return uint256 The quantity of votes required to meet quorum
     */
    function quorumVotes(
        uint32 _proposalId
    ) public view virtual returns (uint256) {
        return
            (quorumNumerator * getProposalVotingSupply(_proposalId)) /
            QUORUM_DENOMINATOR;
    }

    /**
     * Calculates whether a vote meets its basis.
     *
     * @param _yesVotes number of votes in favor
     * @param _noVotes number of votes against
     * @return bool whether the yes votes meets the set basis
     */
    function meetsBasis(
        uint256 _yesVotes,
        uint256 _noVotes
    ) public view returns (bool) {
        return
            _yesVotes >
            ((_yesVotes + _noVotes) * basisNumerator) / BASIS_DENOMINATOR;
    }

    /**
     * Implementation of version
     */
    function getVersion() public view virtual override returns (uint16) {
        return VERSION;
    }

    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        virtual
        override(BaseStrategyV1, Version, ERC165)
        returns (bool)
    {
        return
            interfaceId == type(IBaseQuorumPercentV1).interfaceId ||
            interfaceId == type(IBaseVotingBasisPercentV1).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
