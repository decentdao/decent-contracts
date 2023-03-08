//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./BaseFreezeVoting.sol";
import "./interfaces/IGnosisSafe.sol";

/// @notice A contract for a parent Multisig DAO to cast freeze votes on a child DAO
contract MultisigFreezeVoting is BaseFreezeVoting {
    IGnosisSafe public parentGnosisSafe;

    event MultisigFreezeVotingSetup(address indexed owner, address indexed parentGnosisSafe);

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
        parentGnosisSafe = IGnosisSafe(_parentGnosisSafe);

        emit MultisigFreezeVotingSetup(_owner, _parentGnosisSafe);
    }

    /// @notice Allows user to cast a freeze vote, creating a freeze proposal if necessary
    function castFreezeVote() external override {
        require(parentGnosisSafe.isOwner(msg.sender), "User is not an owner ");

        if (
            block.timestamp > freezeProposalCreatedTime + freezeProposalPeriod
        ) {
            // Create freeze proposal, count user's vote
            freezeProposalCreatedBlock = block.number;
            freezeProposalCreatedTime = block.timestamp;

            freezeProposalVoteCount = 1;

            emit FreezeProposalCreated(msg.sender);
        } else {
            // There is an existing freeze proposal, count user's vote
            require(
                !userHasFreezeVoted[msg.sender][freezeProposalCreatedBlock],
                "User has already voted"
            );

            freezeProposalVoteCount++;
        }

        userHasFreezeVoted[msg.sender][freezeProposalCreatedBlock] = true;

        emit FreezeVoteCast(msg.sender, 1);
    }
}