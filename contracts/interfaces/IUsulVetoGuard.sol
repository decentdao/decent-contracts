//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IUsulVetoGuard {
    event UsulVetoGuardSetup(
        address creator,
        address owner,
        address indexed vetoVoting,
        address indexed ozLinearVoting,
        address indexed usul
    );

    event ProposalQueued(
        address indexed queuer,
        uint256 indexed proposalId
    );

    /// @notice Queues a transaction for execution
    /// @param proposalId The ID of the proposal to queue
    function queueProposal(
        uint256 proposalId
    ) external;

    /// @notice Gets the block number that the transaction was queued at
    /// @param _transactionHash The hash of the transaction data
    /// @return uint256 The block number
    function getTransactionQueuedBlock(bytes32 _transactionHash)
        external
        view
        returns (uint256);
}
