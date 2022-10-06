//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";

interface IVetoERC20Voting {
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

    /// @notice Returns whether the specified functions has been vetoed
    /// @param to Destination address.
    /// @param value Ether value.
    /// @param data Data payload.
    /// @param operation Operation type.
    /// @param safeTxGas Gas that should be used for the safe transaction.
    /// @param baseGas Gas costs for that are independent of the transaction execution(e.g. base transaction fee, signature check, payment of the refund)
    /// @param gasPrice Maximum gas price that should be used for this transaction.
    /// @param gasToken Token address (or 0 if ETH) that is used for the payment.
    /// @param refundReceiver Address of receiver of gas payment (or 0 if tx.origin).
    /// @return bool True if the transaction is vetoed
    function getIsVetoed(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver
    ) external view returns (bool);

    /// @notice Returns true if the DAO is currently frozen
    /// @return bool Indicates whether the DAO is currently frozen
    function isFrozen() external view returns (bool);
}
