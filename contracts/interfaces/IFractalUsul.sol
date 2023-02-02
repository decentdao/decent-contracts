//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";

interface IFractalUsul {
    /// @dev Returns the hash of a transaction in a proposal.
    /// @param proposalId the proposal to inspect.
    /// @param index the transaction to inspect.
    /// @return transaction hash.
    function getProposalTxHash(uint256 proposalId, uint256 index)
        external
        view
        returns (bytes32);

    function getTxHash(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation
    ) external view returns (bytes32);

    /// @dev Get the state of a proposal
    /// @param proposalId the identifier of the proposal
    /// @return ProposalState the enum of the state of the proposal
    function state(uint256 proposalId) external view returns (uint256);

    function proposals(uint256 proposalId)
        external
        view
        returns (
            bool canceled,
            uint256 timeLockPeriod,
            uint256 executionCounter,
            address strategy
        );

    /// @notice Gets the transaction hashes associated with a given proposald
    /// @param proposalId The ID of the proposal to get the tx hashes for
    /// @return bytes32[] The array of tx hashes
    function getProposalTxHashes(uint256 proposalId)
        external
        view
        returns (bytes32[] memory);
}
