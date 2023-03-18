//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "./BaseFreezeVoting.sol";
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@openzeppelin/contracts/governance/utils/IVotes.sol";

/// @notice A contract for casting freeze votes with an ERC20 votes token
contract ERC20FreezeVoting is BaseFreezeVoting {
    IVotes public votesERC20;

    event ERC20FreezeVotingSetup(
        address indexed owner,
        address indexed votesERC20
    );

    error NoVotes();
    error AlreadyVoted();

    /// @notice Initialize function, will be triggered when a new proxy is deployed
    /// @param initializeParams Parameters of initialization encoded
    function setUp(bytes memory initializeParams) public override initializer {
        (
            address _owner,
            uint256 _freezeVotesThreshold,
            uint256 _freezeProposalPeriod,
            uint256 _freezePeriod,
            address _votesERC20
        ) = abi.decode(
                initializeParams,
                (address, uint256, uint256, uint256, address)
            );

        __Ownable_init();
        _transferOwnership(_owner);
        _updateFreezeVotesThreshold(_freezeVotesThreshold);
        _updateFreezeProposalPeriod(_freezeProposalPeriod);
        _updateFreezePeriod(_freezePeriod);
        freezePeriod = _freezePeriod;
        votesERC20 = IVotes(_votesERC20);

        emit ERC20FreezeVotingSetup(_owner, _votesERC20);
    }

    /// @notice Allows user to cast a freeze vote, creating a freeze proposal if necessary
    function castFreezeVote() external override {
        uint256 userVotes;

        if (block.number > freezeProposalCreatedBlock + freezeProposalPeriod) {
            // Create freeze proposal, set total votes to msg.sender's vote count
            freezeProposalCreatedBlock = block.number;

            userVotes = votesERC20.getPastVotes(
                msg.sender,
                freezeProposalCreatedBlock - 1
            );

            if (userVotes == 0) revert NoVotes();

            freezeProposalVoteCount = userVotes;

            emit FreezeProposalCreated(msg.sender);
        } else {
            // There is an existing freeze proposal, count user's votes
            if (userHasFreezeVoted[msg.sender][freezeProposalCreatedBlock])
                revert AlreadyVoted();

            userVotes = votesERC20.getPastVotes(
                msg.sender,
                freezeProposalCreatedBlock - 1
            );

            if (userVotes == 0) revert NoVotes();

            freezeProposalVoteCount += userVotes;
        }        

        userHasFreezeVoted[msg.sender][freezeProposalCreatedBlock] = true;

        emit FreezeVoteCast(msg.sender, userVotes);
    }
}
