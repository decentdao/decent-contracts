# Solidity API

## MultisigFreezeGuard

A Safe Transaction Guard contract that prevents an multisig (Safe) subDAO from executing transactions 
if it has been frozen by its parentDAO.

see https://docs.safe.global/learn/safe-core/safe-core-protocol/guards

### timelockPeriod

```solidity
uint256 timelockPeriod
```

### executionPeriod

```solidity
uint256 executionPeriod
```

### freezeVoting

```solidity
contract IBaseFreezeVoting freezeVoting
```

### childGnosisSafe

```solidity
contract ISafe childGnosisSafe
```

### transactionTimelockedBlock

```solidity
mapping(bytes32 => uint256) transactionTimelockedBlock
```

### MultisigFreezeGuardSetup

```solidity
event MultisigFreezeGuardSetup(address creator, address owner, address freezeVoting, address childGnosisSafe)
```

### TransactionTimelocked

```solidity
event TransactionTimelocked(address timelocker, bytes32 transactionHash, bytes signatures)
```

### TimelockPeriodUpdated

```solidity
event TimelockPeriodUpdated(uint256 timelockPeriod)
```

### ExecutionPeriodUpdated

```solidity
event ExecutionPeriodUpdated(uint256 executionPeriod)
```

### NotTimelockable

```solidity
error NotTimelockable()
```

### NotTimelocked

```solidity
error NotTimelocked()
```

### Timelocked

```solidity
error Timelocked()
```

### Expired

```solidity
error Expired()
```

### DAOFrozen

```solidity
error DAOFrozen()
```

### setUp

```solidity
function setUp(bytes initializeParams) public
```

Initialize function, will be triggered when a new instance is deployed.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| initializeParams | bytes | encoded initialization parameters |

### timelockTransaction

```solidity
function timelockTransaction(address to, uint256 value, bytes data, enum Enum.Operation operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes signatures) external
```

Allows the caller to begin the "timelock" of a transaction.

Timelock is the period during which a proposed transaction must wait before being
executed, after it has passed.  This period is intended to allow the parent DAO
sufficient time to potentially freeze the DAO, if they should vote to do so.

The parameters for doing so are identical to ISafe's execTransaction function.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| to | address |  |
| value | uint256 |  |
| data | bytes |  |
| operation | enum Enum.Operation |  |
| safeTxGas | uint256 |  |
| baseGas | uint256 |  |
| gasPrice | uint256 |  |
| gasToken | address |  |
| refundReceiver | address payable |  |
| signatures | bytes |  |

### updateTimelockPeriod

```solidity
function updateTimelockPeriod(uint256 _timelockPeriod) external
```

Sets the subDAO's timelock period.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _timelockPeriod | uint256 | new timelock period for the subDAO (in blocks) |

### updateExecutionPeriod

```solidity
function updateExecutionPeriod(uint256 _executionPeriod) external
```

Updates the execution period.

Execution period is the time period during which a subDAO's passed Proposals must be executed,
otherwise they will be expired.

This period begins immediately after the timelock period has ended.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _executionPeriod | uint256 | number of blocks a transaction has to be executed within |

### checkTransaction

```solidity
function checkTransaction(address to, uint256 value, bytes data, enum Enum.Operation operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes, address) external view
```

This function is called by the Safe to check if the transaction
is able to be executed and reverts if the guard conditions are
not met.

### checkAfterExecution

```solidity
function checkAfterExecution(bytes32 txHash, bool success) external view
```

A callback performed after a transaction in executed on the Safe.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| txHash | bytes32 | hash of the transaction that was executed |
| success | bool | bool indicating whether the Safe successfully executed the transaction |

### getTransactionTimelockedBlock

```solidity
function getTransactionTimelockedBlock(bytes32 _transactionHash) public view returns (uint256)
```

Gets the block number that the given transaction was timelocked at.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _transactionHash | bytes32 | hash of the transaction data |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | uint256 block number in which the transaction began its timelock period |

### getTransactionHash

```solidity
function getTransactionHash(address to, uint256 value, bytes data, enum Enum.Operation operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver) public pure returns (bytes32)
```

Returns the hash of all the transaction data.

It is important to note that this implementation is different than that 
in the Gnosis Safe contract. This implementation does not use the nonce, 
as this is not part of the Guard contract checkTransaction interface.

This implementation also omits the EIP-712 related values, since these hashes 
are not being signed by users

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| to | address | destination address |
| value | uint256 | ETH value |
| data | bytes | payload |
| operation | enum Enum.Operation | Operation type |
| safeTxGas | uint256 | gas that should be used for the safe transaction |
| baseGas | uint256 | gas costs for that are independent of the transaction execution      (e.g. base transaction fee, signature check, payment of the refund) |
| gasPrice | uint256 | maxiumum gas price that should be used for this transaction |
| gasToken | address | token address (or 0 if ETH) that is used for the payment |
| refundReceiver | address | address of receiver of gas payment (or 0 if tx.origin) |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bytes32 | bytes32 transaction hash bytes |

### _updateTimelockPeriod

```solidity
function _updateTimelockPeriod(uint256 _timelockPeriod) internal
```

Internal implementation of updateTimelockPeriod

### _updateExecutionPeriod

```solidity
function _updateExecutionPeriod(uint256 _executionPeriod) internal
```

Internal implementation of updateExecutionPeriod

