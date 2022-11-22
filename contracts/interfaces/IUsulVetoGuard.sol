//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IUsulVetoGuard {
    struct Transaction {
      uint256 proposalId;
      uint256 queuedBlock;
      uint256 executionDeadline;
    }

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

    /// @notice Queues a proposal for execution
    /// @param proposalId The ID of the proposal to queue
    function queueProposal(
        uint256 proposalId
    ) external;

    /// @notice Gets the block number that the transaction was queued at
    /// @param _txHash The hash of the transaction data
    /// @return uint256 The proposal ID the tx is associated with
    function getTransactionProposalId(bytes32 _txHash)
        external
        view
        returns (uint256);

    /// @notice Gets the block number that the transaction was queued at
    /// @param _txHash The hash of the transaction data
    /// @return uint256 The block number the transaction was queued at
    function getTransactionQueuedBlock(bytes32 _txHash)
        external
        view
        returns (uint256);

    /// @notice Gets the block number that the transaction was queued at
    /// @param _txHash The hash of the transaction data
    /// @return uint256 The timestamp the transaction must be executed by
    function getTransactionExecutionDeadline(bytes32 _txHash)
        external
        view
        returns (uint256);
}
