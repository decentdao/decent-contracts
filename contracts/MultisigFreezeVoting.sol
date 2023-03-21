//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "./BaseFreezeVoting.sol";
import "./interfaces/ISafe.sol";

/// @notice A contract for a parent Multisig DAO to cast freeze votes on a child DAO
contract MultisigFreezeVoting is BaseFreezeVoting {
    ISafe public parentGnosisSafe;

    event MultisigFreezeVotingSetup(
        address indexed owner,
        address indexed parentGnosisSafe
    );

    error NotOwner();
    error AlreadyVoted();

    /// @notice Initialize function, will be triggered when a new proxy is deployed
    /// @param initializeParams Parameters of initialization encoded
    function setUp(bytes memory initializeParams) public override initializer {
        (
            address _owner,
            uint256 _freezeVotesThreshold,
            uint256 _freezeProposalPeriod,
            uint256 _freezePeriod,
            address _parentGnosisSafe
        ) = abi.decode(
                initializeParams,
                (address, uint256, uint256, uint256, address)
            );

        __Ownable_init();
        _transferOwnership(_owner);
        _updateFreezeVotesThreshold(_freezeVotesThreshold);
        _updateFreezeProposalPeriod(_freezeProposalPeriod);
        _updateFreezePeriod(_freezePeriod);
        parentGnosisSafe = ISafe(_parentGnosisSafe);

        emit MultisigFreezeVotingSetup(_owner, _parentGnosisSafe);
    }

    /// @notice Allows user to cast a freeze vote, creating a freeze proposal if necessary
    function castFreezeVote() external override {
        if (!parentGnosisSafe.isOwner(msg.sender)) revert NotOwner();

        if (block.number > freezeProposalCreatedBlock + freezeProposalPeriod) {
            // Create freeze proposal, count user's vote
            freezeProposalCreatedBlock = block.number;

            freezeProposalVoteCount = 1;

            emit FreezeProposalCreated(msg.sender);
        } else {
            // There is an existing freeze proposal, count user's vote
            if (userHasFreezeVoted[msg.sender][freezeProposalCreatedBlock])
                revert AlreadyVoted();

            freezeProposalVoteCount++;
        }

        userHasFreezeVoted[msg.sender][freezeProposalCreatedBlock] = true;

        emit FreezeVoteCast(msg.sender, 1);
    }
}
