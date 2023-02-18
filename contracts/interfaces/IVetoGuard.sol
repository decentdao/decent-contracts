//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";

interface IVetoGuard {
    event VetoGuardSetup(
        address creator,
        uint256 timelockPeriod,
        uint256 executionPeriod,
        address indexed owner,
        address indexed vetoVoting
    );

    event TransactionTimelocked(
        address indexed timelocker,
        bytes32 indexed transactionHash,
        bytes indexed signatures
    );

    /// @notice Allows a user to timelock the transaction, requires valid signatures
    /// @param _to Destination address.
    /// @param _value Ether value.
    /// @param _data Data payload.
    /// @param _operation Operation type.
    /// @param _safeTxGas Gas that should be used for the safe transaction.
    /// @param _baseGas Gas costs for that are independent of the transaction execution(e.g. base transaction fee, signature check, payment of the refund)
    /// @param _gasPrice Maximum gas price that should be used for this transaction.
    /// @param _gasToken Token address (or 0 if ETH) that is used for the payment.
    /// @param _refundReceiver Address of receiver of gas payment (or 0 if tx.origin).
    /// @param _signatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
    function timelockTransaction(
        address _to,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation,
        uint256 _safeTxGas,
        uint256 _baseGas,
        uint256 _gasPrice,
        address _gasToken,
        address payable _refundReceiver,
        bytes memory signatures
    ) external;

    /// @notice Updates the timelock period in seconds, only callable by the owner
    /// @param _timelockPeriod The number of seconds between when a transaction is timelocked and can be executed
    function updateTimelockPeriod(uint256 _timelockPeriod)
        external;

    /// @notice Updates the execution period in seconds, only callable by the owner
    /// @param _executionPeriod The number of seconds a transaction has to be executed after timelock period has ended
    function updateExecutionPeriod(uint256 _executionPeriod)
        external;

    /// @notice Gets the block number that the transaction was timelocked at
    /// @param _transactionHash The hash of the transaction data
    /// @return uint256 The block number
    function getTransactionTimelockedBlock(bytes32 _transactionHash)
        external
        view
        returns (uint256);

    /// @notice Gets the timestamp that the transaction was timelocked at
    /// @param _transactionHash The hash of the transaction data
    /// @return uint256 The timestamp the transaction was timelocked at
    function getTransactionTimelockedTimestamp(bytes32 _transactionHash)
        external
        view
        returns (uint256);
}
