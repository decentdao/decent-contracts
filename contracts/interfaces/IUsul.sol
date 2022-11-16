//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IUsul {
    /// @dev Returns the hash of a transaction in a proposal.
    /// @param proposalId the proposal to inspect.
    /// @param index the transaction to inspect.
    /// @return transaction hash.
    function getTxHash(uint256 proposalId, uint256 index)
        external
        view
        returns (bytes32);
}