// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

import {Version} from "../Version.sol";
import {IERC20VotingWeightV1} from "../../interfaces/decent/deployables/IERC20VotingWeightV1.sol";
import {BaseStrategyV1} from "./BaseStrategyV1.sol";
import {BaseQuorumPercentV1} from "./BaseQuorumPercentV1.sol";
import {BaseVotingBasisPercentV1} from "./BaseVotingBasisPercentV1.sol";
import {ERC4337VoterSupportV1} from "./ERC4337VoterSupportV1.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";

/**
 * An [Azorius](./Azorius.md) [BaseStrategy](./BaseStrategy.md) implementation that
 * enables linear (i.e. 1 to 1) token voting. Each token delegated to a given address
 * in an `ERC20Votes` token equals 1 vote for a Proposal.
 */
contract LinearERC20VotingV1 is
    BaseStrategyV1,
    BaseQuorumPercentV1,
    BaseVotingBasisPercentV1,
    ERC4337VoterSupportV1,
    Version,
    IERC20VotingWeightV1
{
    uint16 private constant VERSION = 1;

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
        uint48 votingStartTimestamp; // time that voting starts at
        uint48 votingEndTimestamp; // time that voting ends
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

    /** `proposalId` to `ProposalVotes`, the voting state of a Proposal. */
    mapping(uint256 => ProposalVotes) internal proposalVotes;

    event VotingPeriodUpdated(uint32 votingPeriod);
    event RequiredProposerWeightUpdated(uint256 requiredProposerWeight);
    event ProposalInitialized(uint32 proposalId, uint48 votingEndTimestamp);
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
     * @param initializeParams encoded initialization parameters: `address _owner`,
     * `IVotes _governanceToken`, `address _azoriusModule`, `uint32 _votingPeriod`,
     * `uint256 _requiredProposerWeight`, `uint256 _quorumNumerator`,
     * `uint256 _basisNumerator`
     */
    function setUp(
        bytes memory initializeParams
    ) public virtual override initializer {
        (
            address _owner,
            IVotes _governanceToken,
            address _azoriusModule,
            uint32 _votingPeriod,
            uint256 _requiredProposerWeight,
            uint256 _quorumNumerator,
            uint256 _basisNumerator
        ) = abi.decode(
                initializeParams,
                (address, IVotes, address, uint32, uint256, uint256, uint256)
            );
        if (address(_governanceToken) == address(0))
            revert InvalidTokenAddress();

        governanceToken = _governanceToken;
        __Ownable_init(_owner);
        _setAzorius(_azoriusModule);
        _updateQuorumNumerator(_quorumNumerator);
        _updateBasisNumerator(_basisNumerator);
        _updateVotingPeriod(_votingPeriod);
        _updateRequiredProposerWeight(_requiredProposerWeight);

        emit StrategySetUp(_azoriusModule, _owner);
    }

    /**
     * Updates the voting time period for new Proposals.
     *
     * @param _votingPeriod voting time period (in blocks)
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
     * Casts votes for a Proposal, equal to the caller's token delegation.
     *
     * @param _proposalId id of the Proposal to vote on
     * @param _voteType Proposal support as defined in VoteType (NO, YES, ABSTAIN)
     */
    function vote(uint32 _proposalId, uint8 _voteType) external virtual {
        address voter = _voter(msg.sender);
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
     * @return startTimestamp timestamp voting starts
     * @return endTimestamp timestamp voting ends
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
            uint48 startTimestamp,
            uint48 endTimestamp,
            uint256 votingSupply
        )
    {
        noVotes = proposalVotes[_proposalId].noVotes;
        yesVotes = proposalVotes[_proposalId].yesVotes;
        abstainVotes = proposalVotes[_proposalId].abstainVotes;
        startTimestamp = proposalVotes[_proposalId].votingStartTimestamp;
        endTimestamp = proposalVotes[_proposalId].votingEndTimestamp;
        votingSupply = getProposalVotingSupply(_proposalId);
    }

    /** @inheritdoc BaseStrategyV1*/
    function initializeProposal(
        bytes memory _data
    ) public virtual override onlyAzorius {
        uint32 proposalId = abi.decode(_data, (uint32));
        uint48 _votingEndTimestamp = uint48(block.timestamp) + votingPeriod;

        proposalVotes[proposalId].votingEndTimestamp = _votingEndTimestamp;
        proposalVotes[proposalId].votingStartTimestamp = uint48(
            block.timestamp
        );

        emit ProposalInitialized(proposalId, _votingEndTimestamp);
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
        return (block.timestamp >
            proposalVotes[_proposalId].votingEndTimestamp && // voting period has ended
            meetsQuorum(
                getProposalVotingSupply(_proposalId),
                proposalVotes[_proposalId].yesVotes,
                proposalVotes[_proposalId].abstainVotes
            ) && // yes + abstain votes meets the quorum
            meetsBasis(
                proposalVotes[_proposalId].yesVotes,
                proposalVotes[_proposalId].noVotes
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
                proposalVotes[_proposalId].votingStartTimestamp
            );
    }

    /** @inheritdoc IERC20VotingWeightV1*/
    function getCurrentVotingWeight(
        address _voter
    ) external view override returns (uint256) {
        return governanceToken.getVotes(_voter);
    }

    /** @inheritdoc IERC20VotingWeightV1*/
    function getVotingWeight(
        address _voter,
        uint32 _proposalId
    ) public view override returns (uint256) {
        return
            governanceToken.getPastVotes(
                _voter,
                proposalVotes[_proposalId].votingStartTimestamp
            );
    }

    /** @inheritdoc BaseStrategyV1*/
    function isProposer(
        address _address
    ) public view virtual override returns (bool) {
        return
            governanceToken.getPastVotes(_address, block.number - 1) >=
            requiredProposerWeight;
    }

    /** @inheritdoc BaseStrategyV1*/
    function votingEndTimestamp(
        uint32 _proposalId
    ) public view virtual override returns (uint48) {
        return proposalVotes[_proposalId].votingEndTimestamp;
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
        if (proposalVotes[_proposalId].votingEndTimestamp == 0)
            revert InvalidProposal();
        if (block.timestamp > proposalVotes[_proposalId].votingEndTimestamp)
            revert VotingEnded();
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

    /** @inheritdoc BaseQuorumPercentV1*/
    function quorumVotes(
        uint32 _proposalId
    ) public view virtual override returns (uint256) {
        return
            (quorumNumerator * getProposalVotingSupply(_proposalId)) /
            QUORUM_DENOMINATOR;
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
        override(
            BaseQuorumPercentV1,
            BaseStrategyV1,
            BaseVotingBasisPercentV1,
            Version
        )
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
