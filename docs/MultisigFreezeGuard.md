# Solidity API

## MultisigFreezeGuard

Implementation of [IMultisigFreezeGuard](./interfaces/IMultisigFreezeGuard.md).

### timelockPeriod

```solidity
uint32 timelockPeriod
```

Timelock period (in blocks).

### executionPeriod

```solidity
uint32 executionPeriod
```

Execution period (in blocks).

### freezeVoting

```solidity
contract IBaseFreezeVoting freezeVoting
```

Reference to the [IBaseFreezeVoting](./interfaces/IBaseFreezeVoting.md) 
implementation that determines whether the Safe is frozen.

### childGnosisSafe

```solidity
contract ISafe childGnosisSafe
```

Reference to the Safe that can be frozen.

### transactionTimelockedBlock

```solidity
mapping(bytes32 => uint32) transactionTimelockedBlock
```

Mapping of signatures hash to the block during which it was timelocked.

### MultisigFreezeGuardSetup

```solidity
event MultisigFreezeGuardSetup(address creator, address owner, address freezeVoting, address childGnosisSafe)
```

### TransactionTimelocked

```solidity
event TransactionTimelocked(address timelocker, bytes32 signaturesHash, bytes signatures)
```

### TimelockPeriodUpdated

```solidity
event TimelockPeriodUpdated(uint32 timelockPeriod)
```

### ExecutionPeriodUpdated

```solidity
event ExecutionPeriodUpdated(uint32 executionPeriod)
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
| initializeParams | bytes | encoded initialization parameters: `uint256 _timelockPeriod`, `uint256 _executionPeriod`, `address _owner`, `address _freezeVoting`, `address _childGnosisSafe` |

### timelockTransaction

```solidity
function timelockTransaction(address to, uint256 value, bytes data, enum Enum.Operation operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes signatures) external
```

Allows the caller to begin the `timelock` of a transaction.

Timelock is the period during which a proposed transaction must wait before being
executed, after it has passed.  This period is intended to allow the parent DAO
sufficient time to potentially freeze the DAO, if they should vote to do so.

The parameters for doing so are identical to [ISafe's](./ISafe.md) `execTransaction` function.

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
function updateTimelockPeriod(uint32 _timelockPeriod) external
```

Sets the subDAO's timelock period.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _timelockPeriod | uint32 | new timelock period for the subDAO (in blocks) |

### updateExecutionPeriod

```solidity
function updateExecutionPeriod(uint32 _executionPeriod) external
```

Updates the execution period.

Execution period is the time period during which a subDAO's passed Proposals must be executed,
otherwise they will be expired.

This period begins immediately after the timelock period has ended.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _executionPeriod | uint32 | number of blocks a transaction has to be executed within |

### checkTransaction

```solidity
function checkTransaction(address, uint256, bytes, enum Enum.Operation, uint256, uint256, uint256, address, address payable, bytes signatures, address) external view
```

Called by the Safe to check if the transaction is able to be executed and reverts 
if the guard conditions are not met.

### checkAfterExecution

```solidity
function checkAfterExecution(bytes32, bool) external view
```

A callback performed after a transaction is executed on the Safe. This is a required
function of the `BaseGuard` and `IGuard` interfaces that we do not make use of.

### getTransactionTimelockedBlock

```solidity
function getTransactionTimelockedBlock(bytes32 _signaturesHash) public view returns (uint32)
```

Gets the block number that the given transaction was timelocked at.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _signaturesHash | bytes32 | hash of the transaction signatures |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint32 | uint32 block number in which the transaction began its timelock period |

### _updateTimelockPeriod

```solidity
function _updateTimelockPeriod(uint32 _timelockPeriod) internal
```

Internal implementation of `updateTimelockPeriod`

### _updateExecutionPeriod

```solidity
function _updateExecutionPeriod(uint32 _executionPeriod) internal
```

Internal implementation of `updateExecutionPeriod`

