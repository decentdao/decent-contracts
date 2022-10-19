//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";

interface IVetoVoting {
    event VetoVoteCast(
        address indexed voter,
        bytes32 indexed transactionHash,
        uint256 votesCast,
        bool freeze
    );

    event FreezeVoteCast(address indexed voter, uint256 votesCast);

    event FreezeProposalCreated(address indexed creator);

    /// @notice Allows the msg.sender to cast veto and freeze votes on the specified transaction
    /// @param _transactionHash The hash of the transaction data
    /// @param _freeze Bool indicating whether the voter thinks the DAO should also be frozen
    function castVetoVote(bytes32 _transactionHash, bool _freeze) external;

    /// @notice Allows a user to cast a freeze vote if there is an active freeze proposal
    /// @notice If there isn't an active freeze proposal, it is created and the user's votes are cast
    function castFreezeVote() external;

    /// @notice Returns whether the specified transaction has been vetoed
    /// @param _transactionHash The hash of the transaction data
    /// @return bool True if the transaction is vetoed
    function getIsVetoed(bytes32 _transactionHash) external view returns (bool);

    /// @notice Returns true if the DAO is currently frozen
    /// @return bool Indicates whether the DAO is currently frozen
    function isFrozen() external view returns (bool);
}
