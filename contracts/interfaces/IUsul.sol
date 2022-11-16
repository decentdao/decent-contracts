//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";

interface IUsul {
    /// @dev Returns the hash of a transaction in a proposal.
    /// @param proposalId the proposal to inspect.
    /// @param index the transaction to inspect.
    /// @return transaction hash.
    function getTxHash(uint256 proposalId, uint256 index)
        external
        view
        returns (bytes32);

    function getTransactionHash(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation
    ) external view returns (bytes32);

    /// @dev Get the state of a proposal
    /// @param proposalId the identifier of the proposal
    /// @return ProposalState the enum of the state of the proposal
    function state(uint256 proposalId) external view returns (uint256);
}