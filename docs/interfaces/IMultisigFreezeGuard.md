# Solidity API

## IMultisigFreezeGuard

A specification for a Safe Guard contract which allows for multi-sig DAOs (Safes)
to operate in a fashion similar to Azorius token voting DAOs.

This Guard is intended to add a timelock period and execution period to a Safe
multisig contract, allowing parent DAO's to have the ability to properly
freeze multi-sig subDAOs.

Without a timelock period, a vote to freeze the Safe would not be possible
as the multi-sig child could immediately execute any transactions they would like
in response.

An execution period is also required. This is to prevent executing the transaction after
a potential freeze period is enacted. Without it a subDAO could just wait for a freeze
period to elapse and then execute their desired transaction.

See also https://docs.safe.global/learn/safe-core/safe-core-protocol/guards

### timelockTransaction

```solidity
function timelockTransaction(address _to, uint256 _value, bytes _data, enum Enum.Operation _operation, uint256 _safeTxGas, uint256 _baseGas, uint256 _gasPrice, address _gasToken, address payable _refundReceiver, bytes _signatures) external
```

Allows the caller to begin the "timelock" of a transaction.

Timelock is the period during which a proposed transaction must wait before being
executed, after it has passed.  This period is intended to allow the parent DAO
sufficient time to potentially freeze the DAO, if they should vote to do so.

The parameters for doing so are identical to ISafe's execTransaction function.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _to | address | destination address |
| _value | uint256 | ETH value |
| _data | bytes | data payload |
| _operation | enum Enum.Operation | Operation type, Call or DelegateCall |
| _safeTxGas | uint256 | gas that should be used for the safe transaction |
| _baseGas | uint256 | gas costs that are independent of the transaction execution |
| _gasPrice | uint256 | max gas price that should be used for this transaction |
| _gasToken | address | token address (or 0 if ETH) that is used for the payment |
| _refundReceiver | address payable | address of the receiver of gas payment (or 0 if tx.origin) |
| _signatures | bytes | packed signature data |

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

### getTransactionTimelockedBlock

```solidity
function getTransactionTimelockedBlock(bytes32 _transactionHash) external view returns (uint256)
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

