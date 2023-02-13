//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IUsulVetoGuard {
    struct Proposal {
      uint256 timelockedBlock;
      uint256 executionDeadline;
    }

    event UsulVetoGuardSetup(
        address creator,
        address owner,
        address indexed vetoVoting,
        address indexed votingStrategy,
        address indexed usul
    );

    event ProposalTimelocked(
        address indexed timelocker,
        uint256 indexed proposalId
    );

    /// @notice Timelocks a proposal for execution
    /// @param proposalId The ID of the proposal to timelock
    function timelockProposal(
        uint256 proposalId
    ) external;

    /// @notice Gets the block number that the transaction was timelocked at
    /// @param _txHash The hash of the transaction data
    /// @return uint256 The proposal ID the tx is associated with
    function getTransactionProposalId(bytes32 _txHash)
        external
        view
        returns (uint256);

    /// @notice Gets the block number that the proposal was timelocked at
    /// @param _proposalId The ID of the proposal
    /// @return uint256 The block number the transaction was timelocked at
    function getProposalTimelockedBlock(uint256 _proposalId)
        external
        view
        returns (uint256);

    /// @notice Gets the block number that the proposal was timelocked at
    /// @param _proposalId The ID of the proposal
    /// @return uint256 The timestamp the transaction must be executed by
    function getProposalExecutionDeadline(uint256 _proposalId)
        external
        view
        returns (uint256);
}
