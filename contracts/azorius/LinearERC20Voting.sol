// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity =0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "./BaseStrategy.sol";
import "./BaseQuorumPercent.sol";

/// @title An Azorius strategy that enables linear token voting
contract LinearERC20Voting is BaseStrategy, BaseQuorumPercent {
    enum VoteType {
        NO,
        YES,
        ABSTAIN
    }

    struct ProposalVotes {
        uint256 noVotes; // The total number of NO votes for this proposal
        uint256 yesVotes; // The total number of YES votes for this proposal
        uint256 abstainVotes; // The total number of ABSTAIN votes for this proposal
        uint256 votingStartBlock; // The block the proposal voting starts
        uint256 votingEndBlock; // The block voting ends for this proposal
        mapping(address => bool) hasVoted;
    }

    ERC20Votes public governanceToken;
    uint256 public votingPeriod; // The number of blocks a proposal can be voted on
    mapping(uint256 => ProposalVotes) internal proposalVotes;

    event VotingPeriodUpdated(uint256 newVotingPeriod);
    event ProposalInitialized(uint256 proposalId, uint256 votingEndBlock);
    event Voted(
        address voter,
        uint256 proposalId,
        uint8 support,
        uint256 weight
    );

    error InvalidProposal();
    error VotingEnded();
    error AlreadyVoted();
    error InvalidVote();
    error InvalidTokenAddress();

    /// @notice Sets up the contract with initial parameters
    /// @param initParams The initial setup parameters encoded as bytes
    function setUp(bytes memory initParams) public override initializer {
        (
            address _owner,
            ERC20Votes _governanceToken,
            address _azoriusModule,
            uint256 _votingPeriod,
            uint256 _quorumNumerator
        ) = abi.decode(
                initParams,
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

        emit StrategySetup(_azoriusModule, _owner);
    }

    /// @notice Updates the voting time period
    /// @param _newVotingPeriod The voting time period in blocks
    function updateVotingPeriod(uint256 _newVotingPeriod) external onlyOwner {
        _updateVotingPeriod(_newVotingPeriod);
    }

    /// @notice Called by the proposal module, this notifes the strategy of a new proposal
    /// @param _data Any extra data to pass to the voting strategy
    function initializeProposal(
        bytes memory _data
    ) external override onlyAzorius {
        uint256 proposalId = abi.decode(_data, (uint256));
        uint256 _votingEndBlock = block.number + votingPeriod;

        proposalVotes[proposalId].votingEndBlock = _votingEndBlock;
        proposalVotes[proposalId].votingStartBlock = block.number;

        emit ProposalInitialized(proposalId, _votingEndBlock);
    }

    /// @notice Casts a vote for a proposal
    /// @param _proposalId The ID of the proposal to vote for
    /// @param _support Proposal support represented as NO, YES, or ABSTAIN
    function vote(uint256 _proposalId, uint8 _support, bytes memory) external {
        _vote(
            _proposalId,
            msg.sender,
            _support,
            getVotingWeight(msg.sender, _proposalId)
        );
    }

    /// @notice Updates the voting time period
    /// @param _newVotingPeriod The voting time period in blocks
    function _updateVotingPeriod(uint256 _newVotingPeriod) internal {
        votingPeriod = _newVotingPeriod;

        emit VotingPeriodUpdated(_newVotingPeriod);
    }

    /// @notice Function for counting a vote for a proposal, can only be called internally
    /// @param _proposalId The ID of the proposal
    /// @param _voter The address of the account casting the vote
    /// @param _support Indicates vote support, which can be "No", "Yes", or "Abstain"
    /// @param _weight The amount of voting weight cast
    function _vote(
        uint256 _proposalId,
        address _voter,
        uint8 _support,
        uint256 _weight
    ) internal {
        if (proposalVotes[_proposalId].votingEndBlock == 0)
            revert InvalidProposal();
        if (block.number > proposalVotes[_proposalId].votingEndBlock)
            revert VotingEnded();
        if (proposalVotes[_proposalId].hasVoted[_voter]) revert AlreadyVoted();

        proposalVotes[_proposalId].hasVoted[_voter] = true;

        if (_support == uint8(VoteType.NO)) {
            proposalVotes[_proposalId].noVotes += _weight;
        } else if (_support == uint8(VoteType.YES)) {
            proposalVotes[_proposalId].yesVotes += _weight;
        } else if (_support == uint8(VoteType.ABSTAIN)) {
            proposalVotes[_proposalId].abstainVotes += _weight;
        } else {
            revert InvalidVote();
        }

        emit Voted(_voter, _proposalId, _support, _weight);
    }

    /// @notice Returns true if an account has voted on the specified proposal
    /// @param _proposalId The ID of the proposal to check
    /// @param _account The account address to check
    /// @return bool Returns true if the account has already voted on the proposal
    function hasVoted(
        uint256 _proposalId,
        address _account
    ) external view returns (bool) {
        return proposalVotes[_proposalId].hasVoted[_account];
    }

    /// @notice Returns if a proposal has succeeded
    /// @param _proposalId The ID of the proposal to check
    /// @return bool True if the proposal has passed
    function isPassed(uint256 _proposalId) external view override returns (bool) {
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

    /// @notice Calculates the number of token votes needed for quorum at a specific block number
    /// @param _blockNumber The block number to calculate quorum at
    /// @return uint256 The number of token votes needed for quorum
    function quorum(
        uint256 _blockNumber
    ) public view override returns (uint256) {
        return
            (governanceToken.getPastTotalSupply(_blockNumber) *
                quorumNumerator) / quorumDenominator;
    }

    /// @notice Returns the current state of the specified proposal
    /// @param _proposalId The ID of the proposal to get
    /// @return yesVotes The total count of "Yes" votes for the proposal
    /// @return noVotes The total count of "No" votes for the proposal
    /// @return abstainVotes The total count of "Abstain" votes for the proposal
    /// @return votingStartBlock The block number that the proposal voting starts
    /// @return votingEndBlock The block number that the proposal voting ends
    function getProposal(
        uint256 _proposalId
    )
        external
        view
        returns (
            uint256 yesVotes,
            uint256 noVotes,
            uint256 abstainVotes,
            uint256 votingStartBlock,
            uint256 votingEndBlock
        )
    {
        yesVotes = proposalVotes[_proposalId].yesVotes;
        noVotes = proposalVotes[_proposalId].noVotes;
        abstainVotes = proposalVotes[_proposalId].abstainVotes;
        votingStartBlock = proposalVotes[_proposalId].votingStartBlock;
        votingEndBlock = proposalVotes[_proposalId].votingEndBlock;
    }

    /// @notice Calculates the voting weight an address has for a specific proposal
    /// @param _voter Address of the voter
    /// @param _proposalId The ID of the proposal
    /// @return uint256 The user's vote count
    function getVotingWeight(
        address _voter,
        uint256 _proposalId
    ) public view returns (uint256) {
        return
            governanceToken.getPastVotes(
                _voter,
                proposalVotes[_proposalId].votingStartBlock
            );
    }

    /// @notice Returns if the specified address can submit a proposal
    /// @return bool True if the user can submit a proposal
    function isProposer(address) external pure override returns (bool) {
        return true;
    }

    /// @notice Returns the block that voting ends on the proposal
    /// @param _proposalId The ID of the proposal to check
    /// @return uint256 The block number voting ends on the proposal
    function votingEndBlock(
        uint256 _proposalId
    ) external view override returns (uint256) {
        return proposalVotes[_proposalId].votingEndBlock;
    }
}
