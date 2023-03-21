//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "./interfaces/IMultisigFreezeGuard.sol";
import "./interfaces/IBaseFreezeVoting.sol";
import "./interfaces/ISafe.sol";
import "@gnosis.pm/zodiac/contracts/interfaces/IGuard.sol";
import "@gnosis.pm/zodiac/contracts/factory/FactoryFriendly.sol";
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@gnosis.pm/zodiac/contracts/guard/BaseGuard.sol";

/**
 * A Safe Transaction Guard contract that prevents an multisig (Safe) subDAO from executing transactions 
 * if it has been frozen by its parentDAO.
 *
 * see https://docs.safe.global/learn/safe-core/safe-core-protocol/guards
 */
contract MultisigFreezeGuard is FactoryFriendly, IGuard, IMultisigFreezeGuard, BaseGuard {

    uint256 public timelockPeriod; // timelock period in number of blocks
    uint256 public executionPeriod; // execution period in number of blocks
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

    /**
     * Initialize function, will be triggered when a new instance is deployed.
     *
     * @param initializeParams encoded initialization parameters
     */
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

    /// @inheritdoc IMultisigFreezeGuard
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

        // if signatures are not valid, this will revert
        childGnosisSafe.checkSignatures(
            keccak256(gnosisTransactionHash),
            gnosisTransactionHash,
            signatures
        );

        transactionTimelockedBlock[transactionHash] = block.number;

        emit TransactionTimelocked(msg.sender, transactionHash, signatures);
    }

    /// @inheritdoc IMultisigFreezeGuard
    function updateTimelockPeriod(uint256 _timelockPeriod) external onlyOwner {
        _updateTimelockPeriod(_timelockPeriod);
    }

    /** Internal implementation of updateTimelockPeriod */
    function _updateTimelockPeriod(uint256 _timelockPeriod) internal {
        timelockPeriod = _timelockPeriod;
        emit TimelockPeriodUpdated(_timelockPeriod);
    }

    /// @inheritdoc IMultisigFreezeGuard
    function updateExecutionPeriod(uint256 _executionPeriod) external onlyOwner {
        executionPeriod = _executionPeriod;
    }

    /** Internal implementation of updateExecutionPeriod */
    function _updateExecutionPeriod(uint256 _executionPeriod) internal {
        executionPeriod = _executionPeriod;
        emit ExecutionPeriodUpdated(_executionPeriod);
    }

    /**
     * This function is called by the Safe to check if the transaction
     * is able to be executed and reverts if the guard conditions are
     * not met.
     */
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

    /**
     * A callback performed after a transaction in executed on the Safe.
     *
     * @param txHash hash of the transaction that was executed
     * @param success bool indicating whether the Safe successfully executed the transaction
     */
    function checkAfterExecution(bytes32 txHash, bool success) external view override(BaseGuard, IGuard) {
        // not implementated
    }

    /// @inheritdoc IMultisigFreezeGuard
    function getTransactionTimelockedBlock(bytes32 _transactionHash) public view returns (uint256) {
        return transactionTimelockedBlock[_transactionHash];
    }

    /**
     * Returns the hash of all the transaction data.
     *
     * It is important to note that this implementation is different than that 
     * in the Gnosis Safe contract. This implementation does not use the nonce, 
     * as this is not part of the Guard contract checkTransaction interface.
     *
     * This implementation also omits the EIP-712 related values, since these hashes 
     * are not being signed by users
     *
     * @param to destination address
     * @param value ETH value
     * @param data payload
     * @param operation Operation type
     * @param safeTxGas gas that should be used for the safe transaction
     * @param baseGas gas costs for that are independent of the transaction execution
     *      (e.g. base transaction fee, signature check, payment of the refund)
     * @param gasPrice maxiumum gas price that should be used for this transaction
     * @param gasToken token address (or 0 if ETH) that is used for the payment
     * @param refundReceiver address of receiver of gas payment (or 0 if tx.origin)
     * @return bytes32 transaction hash bytes
     */
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
