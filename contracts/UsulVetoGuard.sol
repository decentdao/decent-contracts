//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./interfaces/IUsulVetoGuard.sol";
import "./interfaces/IVetoVoting.sol";
import "./interfaces/IOZLinearVoting.sol";
import "./interfaces/IUsul.sol";
import "./TransactionHasher.sol";
import "./FractalBaseGuard.sol";
import "@gnosis.pm/zodiac/contracts/factory/FactoryFriendly.sol";
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";

/// @notice A guard contract that prevents transactions that have been vetoed from being executed a Gnosis Safe
/// @notice through a Usul module with an attached OZLinearVoting strategy
contract UsulVetoGuard is
    IUsulVetoGuard,
    TransactionHasher,
    FactoryFriendly,
    FractalBaseGuard
{
    IVetoVoting public vetoVoting;
    IOZLinearVoting public ozLinearVoting;
    IUsul public usul;
    mapping(bytes32 => uint256) transactionQueuedBlock;

    /// @notice Initialize function, will be triggered when a new proxy is deployed
    /// @param initializeParams Parameters of initialization encoded
    function setUp(bytes memory initializeParams) public override initializer {
        __Ownable_init();
        (
            address _owner,
            address _vetoVoting,
            address _ozLinearVoting,
            address _usul
        ) = abi.decode(initializeParams, (address, address, address, address));

        transferOwnership(_owner);
        vetoVoting = IVetoVoting(_vetoVoting);
        ozLinearVoting = IOZLinearVoting(_ozLinearVoting);
        usul = IUsul(_usul);

        emit UsulVetoGuardSetup(
            msg.sender,
            _owner,
            _vetoVoting,
            _ozLinearVoting,
            _usul
        );
    }

    /// @notice Queues a transaction for execution
    /// @param proposalId The ID of the proposal to queue
    function queueProposal(uint256 proposalId) external {
        // If proposal is not yet timelocked, then finalize the strategy
        if(usul.state(proposalId) == 0) ozLinearVoting.finalizeStrategy(proposalId);
        
        require(usul.state(proposalId) == 2, "Proposal must be timelocked before queuing");

        uint256 txIndex;

        // While look is used since the Usul interface does not support getting the quantity of TX hashes
        // stored within a given proposal. This loops through and gets the hash from each index until the call
        // reverts, and then the function is exited
        while (true) {
            try usul.getTxHash(proposalId, txIndex) returns (bytes32 txHash) {
                transactionQueuedBlock[txHash] = block.number;
                txIndex++;
            } catch {
                require(txIndex > 0, "Invalid proposal ID");

                emit ProposalQueued(msg.sender, proposalId);

                return;
            }
        }
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
    ) external view override {
        bytes32 txHash = usul.getTransactionHash(to, value, data, operation);

        require(
            transactionQueuedBlock[txHash] > 0,
            "Transaction has not been queued yet"
        );

        require(!vetoVoting.getIsVetoed(txHash), "Transaction has been vetoed");

        require(!vetoVoting.isFrozen(), "DAO is frozen");
    }

    /// @notice Does checks after transaction is executed on the Gnosis Safe
    /// @param txHash The hash of the transaction that was executed
    /// @param success Boolean indicating whether the Gnosis Safe successfully executed the tx
    function checkAfterExecution(bytes32 txHash, bool success)
        external
        view
        override
    {}

    // / @notice Gets the block number that the transaction was queued at
    // / @param _transactionHash The hash of the transaction data
    // / @return uint256 The block number the transaction was queued at
    function getTransactionQueuedBlock(bytes32 _transactionHash)
        public
        view
        returns (uint256)
    {
        return transactionQueuedBlock[_transactionHash];
    }

    /// @notice Can be used to check if this contract supports the specified interface
    /// @param interfaceId The bytes representing the interfaceId being checked
    /// @return bool True if this contract supports the checked interface
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(FractalBaseGuard)
        returns (bool)
    {
        return
            interfaceId == type(IUsulVetoGuard).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
