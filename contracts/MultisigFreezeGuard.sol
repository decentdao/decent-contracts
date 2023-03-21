//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "./interfaces/IMultisigFreezeGuard.sol";
import "./interfaces/IBaseFreezeVoting.sol";
import "./interfaces/ISafe.sol";
import "@gnosis.pm/zodiac/contracts/interfaces/IGuard.sol";
import "@gnosis.pm/zodiac/contracts/factory/FactoryFriendly.sol";
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@gnosis.pm/zodiac/contracts/guard/BaseGuard.sol";

/// @notice A guard contract that enables functionality for a Multisig to be frozen,
/// @notice and unable to execute transactions until it is unfrozen
contract MultisigFreezeGuard is
    FactoryFriendly,
    IGuard,
    IMultisigFreezeGuard,
    BaseGuard
{
    uint256 public timelockPeriod; // Timelock period in number of blocks
    uint256 public executionPeriod; // Execution period in number of blocks
    IBaseFreezeVoting public freezeVoting;
    ISafe public childGnosisSafe;
    mapping(bytes32 => uint256) internal transactionTimelockedBlock;

    event MultisigFreezeGuardSetup(
        address creator,
        address indexed owner,
        address indexed freezeVoting,
        address indexed childGnosisSafe
    );
    event TransactionTimelocked(
        address indexed timelocker,
        bytes32 indexed transactionHash,
        bytes indexed signatures
    );
    event TimelockPeriodUpdated(uint256 timelockPeriod);
    event ExecutionPeriodUpdated(uint256 executionPeriod);

    error NotTimelockable();
    error NotTimelocked();
    error Timelocked();
    error Expired();
    error DAOFrozen();

    /// @notice Initialize function, will be triggered when a new proxy is deployed
    /// @param initializeParams Parameters of initialization encoded
    function setUp(bytes memory initializeParams) public override initializer {
        __Ownable_init();
        (
            uint256 _timelockPeriod,
            uint256 _executionPeriod,
            address _owner,
            address _freezeVoting,
            address _childGnosisSafe
        ) = abi.decode(
                initializeParams,
                (uint256, uint256, address, address, address)
            );

        _updateTimelockPeriod(_timelockPeriod);
        _updateExecutionPeriod(_executionPeriod);
        transferOwnership(_owner);
        freezeVoting = IBaseFreezeVoting(_freezeVoting);
        childGnosisSafe = ISafe(_childGnosisSafe);

        emit MultisigFreezeGuardSetup(
            msg.sender,
            _owner,
            _freezeVoting,
            _childGnosisSafe
        );
    }

    /// @notice Allows a user to timelock the transaction, requires valid signatures
    /// @param to Destination address.
    /// @param value Ether value.
    /// @param data Data payload.
    /// @param operation Operation type.
    /// @param safeTxGas Gas that should be used for the safe transaction.
    /// @param baseGas Gas costs for that are independent of the transaction execution(e.g. base transaction fee, signature check, payment of the refund)
    /// @param gasPrice Maximum gas price that should be used for this transaction.
    /// @param gasToken Token address (or 0 if ETH) that is used for the payment.
    /// @param refundReceiver Address of receiver of gas payment (or 0 if tx.origin).
    /// @param signatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
    function timelockTransaction(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) external {
        bytes32 transactionHash = getTransactionHash(
            to,
            value,
            data,
            operation,
            safeTxGas,
            baseGas,
            gasPrice,
            gasToken,
            refundReceiver
        );

        if (
            block.number <
            transactionTimelockedBlock[transactionHash] +
                timelockPeriod +
                executionPeriod
        ) revert NotTimelockable();

        bytes memory gnosisTransactionHash = childGnosisSafe
            .encodeTransactionData(
                to,
                value,
                data,
                operation,
                safeTxGas,
                baseGas,
                gasPrice,
                gasToken,
                refundReceiver,
                childGnosisSafe.nonce()
            );

        // If signatures are not valid, this will revert
        childGnosisSafe.checkSignatures(
            keccak256(gnosisTransactionHash),
            gnosisTransactionHash,
            signatures
        );

        transactionTimelockedBlock[transactionHash] = block.number;

        emit TransactionTimelocked(msg.sender, transactionHash, signatures);
    }

    /// @notice Updates the timelock period in blocks, only callable by the owner
    /// @param _timelockPeriod The number of blocks between when a transaction is timelocked and can be executed
    function updateTimelockPeriod(uint256 _timelockPeriod) external onlyOwner {
        _updateTimelockPeriod(_timelockPeriod);
    }

    /// @notice Updates the execution period in blocks, only callable by the owner
    /// @param _executionPeriod The number of blocks a transaction has to be executed after timelock period has ended
    function updateExecutionPeriod(
        uint256 _executionPeriod
    ) external onlyOwner {
        executionPeriod = _executionPeriod;
    }

    /// @notice Updates the timelock period in blocks
    /// @param _timelockPeriod The number of blocks between when a transaction is timelocked and can be executed
    function _updateTimelockPeriod(uint256 _timelockPeriod) internal {
        timelockPeriod = _timelockPeriod;

        emit TimelockPeriodUpdated(_timelockPeriod);
    }

    /// @notice Updates the execution period in blocks
    /// @param _executionPeriod The number of blocks a transaction has to be executed after timelock period has ended
    function _updateExecutionPeriod(uint256 _executionPeriod) internal {
        executionPeriod = _executionPeriod;

        emit ExecutionPeriodUpdated(_executionPeriod);
    }

    /// @notice This function is called by the Gnosis Safe to check if the transaction should be able to be executed
    /// @notice Reverts if this transaction cannot be executed
    /// @param to Destination address.
    /// @param value Ether value.
    /// @param data Data payload.
    /// @param operation Operation type.
    /// @param safeTxGas Gas that should be used for the safe transaction.
    /// @param baseGas Gas costs for that are independent of the transaction execution(e.g. base transaction fee, signature check, payment of the refund)
    /// @param gasPrice Maximum gas price that should be used for this transaction.
    /// @param gasToken Token address (or 0 if ETH) that is used for the payment.
    /// @param refundReceiver Address of receiver of gas payment (or 0 if tx.origin).
    function checkTransaction(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory,
        address
    ) external view override(BaseGuard, IGuard) {
        bytes32 transactionHash = getTransactionHash(
            to,
            value,
            data,
            operation,
            safeTxGas,
            baseGas,
            gasPrice,
            gasToken,
            refundReceiver
        );

        if (transactionTimelockedBlock[transactionHash] == 0)
            revert NotTimelocked();

        if (
            block.number <
            transactionTimelockedBlock[transactionHash] + timelockPeriod
        ) revert Timelocked();

        if (
            block.number >
            transactionTimelockedBlock[transactionHash] +
                timelockPeriod +
                executionPeriod
        ) revert Expired();

        if (freezeVoting.isFrozen()) revert DAOFrozen();
    }

    /// @notice Does checks after transaction is executed on the Gnosis Safe
    /// @param txHash The hash of the transaction that was executed
    /// @param success Boolean indicating whether the Gnosis Safe successfully executed the tx
    function checkAfterExecution(
        bytes32 txHash,
        bool success
    ) external view override(BaseGuard, IGuard) {}

    /// @notice Gets the block number that the transaction was timelocked at
    /// @param _transactionHash The hash of the transaction data
    /// @return uint256 The block number
    function getTransactionTimelockedBlock(
        bytes32 _transactionHash
    ) public view returns (uint256) {
        return transactionTimelockedBlock[_transactionHash];
    }

    /// @dev Returns the hash of all the transaction data
    /// @dev It is important to note that this implementation is different than that in the Gnosis Safe contract
    /// @dev This implementation does not use the nonce, as this is not part of the Guard contract checkTransaction interface
    /// @dev This implementation also omits the EIP-712 related values, since these hashes are not being signed by users
    /// @param to Destination address.
    /// @param value Ether value.
    /// @param data Data payload.
    /// @param operation Operation type.
    /// @param safeTxGas Gas that should be used for the safe transaction.
    /// @param baseGas Gas costs for that are independent of the transaction execution(e.g. base transaction fee, signature check, payment of the refund)
    /// @param gasPrice Maximum gas price that should be used for this transaction.
    /// @param gasToken Token address (or 0 if ETH) that is used for the payment.
    /// @param refundReceiver Address of receiver of gas payment (or 0 if tx.origin).
    /// @return Transaction hash bytes.
    function getTransactionHash(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver
    ) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    to,
                    value,
                    keccak256(data),
                    operation,
                    safeTxGas,
                    baseGas,
                    gasPrice,
                    gasToken,
                    refundReceiver
                )
            );
    }
}
