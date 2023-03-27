// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity =0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "./BaseStrategy.sol";
import "./BaseQuorumPercent.sol";

 /**
  * An [Azorius](./Azorius.md) [BaseStrategy](./BaseStrategy.md) implementation that 
  * enables linear (i.e. 1 to 1) token voting. Each token delegated to a given address 
  * in an `ERC20Votes` token equals 1 vote for a Proposal. // TODO we're actually using ERC20Votes here?
  */
contract LinearERC20Voting is BaseStrategy, BaseQuorumPercent {

    /**
     * The voting options for a Proposal.
     */
    enum VoteType {
        NO,     // disapproves of executing the Proposal
        YES,    // approves of executing the Proposal
        ABSTAIN // neither YES nor NO, i.e. voting "present"
    }

    /**
     * Defines the current state of votes on a particular Proposal.
     */
    struct ProposalVotes {
        uint256 noVotes; // current number of NO votes for the Proposal
        uint256 yesVotes; // current number of YES votes for the Proposal
        uint256 abstainVotes; // current number of ABSTAIN votes for the Proposal
        uint256 votingStartBlock; // block that voting starts at
        uint256 votingEndBlock; // block that voting ends
        mapping(address => bool) hasVoted; // whether a given address has voted yet or not
    }

    ERC20Votes public governanceToken;

    /** Number of blocks a new Proposal can be voted on. */
    uint256 public votingPeriod;

    /** `proposalId` to `ProposalVotes`, the voting state of a Proposal. */
    mapping(uint256 => ProposalVotes) internal proposalVotes;

    event VotingPeriodUpdated(uint256 votingPeriod);
    event ProposalInitialized(uint256 proposalId, uint256 votingEndBlock);
    event Voted(address voter, uint256 proposalId, uint8 voteType, uint256 weight);

    error InvalidProposal();
    error VotingEnded();
    error AlreadyVoted();
    error InvalidVote();
    error InvalidTokenAddress();

    /**
     * Sets up the contract with its initial parameters.
     *
     * @param initializeParams encoded initialization parameters: `address _owner`,
     * `ERC20Votes _governanceToken`, `address _azoriusModule`, `uint256 _votingPeriod`,
     * `uint256 _quorumNumerator`
     */
    function setUp(bytes memory initializeParams) public override initializer {
        (
            address _owner,
            ERC20Votes _governanceToken,
            address _azoriusModule,
            uint256 _votingPeriod,
            uint256 _quorumNumerator
        ) = abi.decode(
                initializeParams,
                (address, ERC20Votes, address, uint256, uint256)
            );
        if (address(_governanceToken) == address(0))
            revert InvalidTokenAddress();

        governanceToken = _governanceToken;
        __Ownable_init();
        transferOwnership(_owner);
        _setAzorius(_azoriusModule);
        _updateQuorumNumerator(_quorumNumerator);
        _updateVotingPeriod(_votingPeriod);

        emit StrategySetUp(_azoriusModule, _owner);
    }

    /**
     * Updates the voting time period for new Proposals.
     *
     * @param _votingPeriod voting time period (in blocks)
     */
    function updateVotingPeriod(uint256 _votingPeriod) external onlyOwner {
        _updateVotingPeriod(_votingPeriod);
    }

    /** @inheritdoc BaseStrategy*/
    function initializeProposal(bytes memory _data) external virtual override onlyAzorius {
        uint256 proposalId = abi.decode(_data, (uint256));
        uint256 _votingEndBlock = block.number + votingPeriod;

        proposalVotes[proposalId].votingEndBlock = _votingEndBlock;
        proposalVotes[proposalId].votingStartBlock = block.number;

        emit ProposalInitialized(proposalId, _votingEndBlock);
    }

    /**
     * Casts votes for a Proposal, equal to the caller's token delegation.
     *
     * @param _proposalId id of the Proposal to vote on
     * @param _voteType Proposal support as defined in VoteType (NO, YES, ABSTAIN)
     */
    function vote(uint256 _proposalId, uint8 _voteType, bytes memory) external { // TODO what's this unused parameter???
        _vote(
            _proposalId,
            msg.sender,
            _voteType,
            getVotingWeight(msg.sender, _proposalId)
        );
    }

    /**
     * Returns the current state of the specified Proposal.
     *
     * @param _proposalId id of the Proposal
     * @return noVotes current count of "NO" votes
     * @return yesVotes current count of "YES" votes
     * @return abstainVotes current count of "ABSTAIN" votes
     * @return startBlock block number voting starts
     * @return endBlock block number voting ends
     */
    function getProposalVotes(uint256 _proposalId) external view
        returns (
            uint256 noVotes,
            uint256 yesVotes,
            uint256 abstainVotes,
            uint256 startBlock,
            uint256 endBlock
        )
    {
        noVotes = proposalVotes[_proposalId].noVotes;
        yesVotes = proposalVotes[_proposalId].yesVotes;
        abstainVotes = proposalVotes[_proposalId].abstainVotes;
        startBlock = proposalVotes[_proposalId].votingStartBlock;
        endBlock = proposalVotes[_proposalId].votingEndBlock;
    }

    /**
     * Returns whether an address has voted on the specified Proposal.
     *
     * @param _proposalId id of the Proposal to check
     * @param _address address to check
     * @return bool true if the address has voted on the Proposal, otherwise false
     */
    function hasVoted(uint256 _proposalId, address _address) public view returns (bool) {
        return proposalVotes[_proposalId].hasVoted[_address];
    }

    /** @inheritdoc BaseStrategy*/
    function isPassed(uint256 _proposalId) public view override returns (bool) {
        if (
            proposalVotes[_proposalId].yesVotes > proposalVotes[_proposalId].noVotes &&
            proposalVotes[_proposalId].yesVotes >=
            quorum(proposalVotes[_proposalId].votingStartBlock) &&
            proposalVotes[_proposalId].votingEndBlock != 0 &&
            block.number > proposalVotes[_proposalId].votingEndBlock
        ) {
            return true;
        }

        return false;
    }

    /** @inheritdoc BaseQuorumPercent*/
    function quorum(uint256 _blockNumber) public view override returns (uint256) {
        return
            (governanceToken.getPastTotalSupply(_blockNumber) *
                quorumNumerator) / QUORUM_DENOMINATOR;
    }

    /**
     * Calculates the voting weight an address has for a specific Proposal.
     *
     * @param _voter address of the voter
     * @param _proposalId id of the Proposal
     * @return uint256 the address' voting weight
     */
    function getVotingWeight(address _voter, uint256 _proposalId) public view returns (uint256) {
        return
            governanceToken.getPastVotes(
                _voter,
                proposalVotes[_proposalId].votingStartBlock
            );
    }

    /** @inheritdoc BaseStrategy*/
    function isProposer(address) public pure override returns (bool) {
        return true; // anyone can submit Proposals
    }

    /** @inheritdoc BaseStrategy*/
    function votingEndBlock(uint256 _proposalId) public view override returns (uint256) {
      return proposalVotes[_proposalId].votingEndBlock;
    }

    /** Internal implementation of `updateVotingPeriod`. */
    function _updateVotingPeriod(uint256 _votingPeriod) internal {
        votingPeriod = _votingPeriod;
        emit VotingPeriodUpdated(_votingPeriod);
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
    function _vote(uint256 _proposalId, address _voter, uint8 _voteType, uint256 _weight) internal {
        if (proposalVotes[_proposalId].votingEndBlock == 0)
            revert InvalidProposal();
        if (block.number > proposalVotes[_proposalId].votingEndBlock)
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
}
