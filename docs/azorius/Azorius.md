# Solidity API

## Azorius

### SENTINEL_STRATEGY

```solidity
address SENTINEL_STRATEGY
```

The sentinel node of the linked list of enabled BaseStrategies.
https://en.wikipedia.org/wiki/Sentinel_node

### DOMAIN_SEPARATOR_TYPEHASH

```solidity
bytes32 DOMAIN_SEPARATOR_TYPEHASH
```

keccak256(
     "EIP712Domain(uint256 chainId,address verifyingContract)"
);

A unique hash intended to prevent signature collisions.
See https://eips.ethereum.org/EIPS/eip-712 for details.

### TRANSACTION_TYPEHASH

```solidity
bytes32 TRANSACTION_TYPEHASH
```

keccak256(
     "Transaction(address to,uint256 value,bytes data,uint8 operation,uint256 nonce)"
);

See https://eips.ethereum.org/EIPS/eip-712 for details.

### totalProposalCount

```solidity
uint256 totalProposalCount
```

### timelockPeriod

```solidity
uint256 timelockPeriod
```

### executionPeriod

```solidity
uint256 executionPeriod
```

### proposals

```solidity
mapping(uint256 => struct IAzorius.Proposal) proposals
```

### strategies

```solidity
mapping(address => address) strategies
```

### AzoriusSetUp

```solidity
event AzoriusSetUp(address creator, address owner, address avatar, address target)
```

### ProposalCreated

```solidity
event ProposalCreated(address strategy, uint256 proposalId, address proposer, struct IAzorius.Transaction[] transactions, string metadata)
```

### ProposalExecuted

```solidity
event ProposalExecuted(uint256 proposalId, bytes32[] txHashes)
```

### EnabledStrategy

```solidity
event EnabledStrategy(address strategy)
```

### DisabledStrategy

```solidity
event DisabledStrategy(address strategy)
```

### TimelockPeriodUpdated

```solidity
event TimelockPeriodUpdated(uint256 timelockPeriod)
```

### ExecutionPeriodUpdated

```solidity
event ExecutionPeriodUpdated(uint256 executionPeriod)
```

### InvalidStrategy

```solidity
error InvalidStrategy()
```

### StrategyEnabled

```solidity
error StrategyEnabled()
```

### StrategyDisabled

```solidity
error StrategyDisabled()
```

### InvalidProposal

```solidity
error InvalidProposal()
```

### InvalidProposer

```solidity
error InvalidProposer()
```

### ProposalNotExecutable

```solidity
error ProposalNotExecutable()
```

### InvalidTxHash

```solidity
error InvalidTxHash()
```

### TxFailed

```solidity
error TxFailed()
```

### InvalidTxs

```solidity
error InvalidTxs()
```

### InvalidArrayLengths

```solidity
error InvalidArrayLengths()
```

### setUp

```solidity
function setUp(bytes initParams) public
```

### updateTimelockPeriod

```solidity
function updateTimelockPeriod(uint256 _timelockPeriod) external
```

Updates the timelockPeriod for newly created Proposals.
This has no effect on existing Proposals, either ACTIVE or completed.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _timelockPeriod | uint256 | The timelockPeriod (in blocks) to be used for new Proposals. |

### submitProposal

```solidity
function submitProposal(address _strategy, bytes _data, struct IAzorius.Transaction[] _transactions, string _metadata) external
```

Submits a new Proposal, using one of the enabled BaseStrategies.
New Proposals begin immediately in the ACTIVE state.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _strategy | address | address of the BaseStrategy implementation which the Proposal will use. |
| _data | bytes | arbitrary data passed to the BaseStrategy implementation |
| _transactions | struct IAzorius.Transaction[] | array of transactions to propose |
| _metadata | string | additional data such as a title/description to submit with the proposal |

### executeProposal

```solidity
function executeProposal(uint256 _proposalId, address[] _targets, uint256[] _values, bytes[] _data, enum Enum.Operation[] _operations) external
```

Executes all transactions within a Proposal.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint256 | identifier of the Proposal |
| _targets | address[] | target contracts for each transaction |
| _values | uint256[] | ETH values to be sent with each transaction |
| _data | bytes[] | transaction data to be executed |
| _operations | enum Enum.Operation[] | Calls or Delegatecalls |

### updateExecutionPeriod

```solidity
function updateExecutionPeriod(uint256 _executionPeriod) external
```

Updates the execution period for future Proposals.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _executionPeriod | uint256 | new execution period (in blocks) |

### getStrategies

```solidity
function getStrategies(address _startAddress, uint256 _count) external view returns (address[] _strategies, address _next)
```

Returns an array of enabled BaseStrategy contract addresses.
Because the list of BaseStrategies is technically unbounded, this
requires the address of the first strategy you would like, along
with the total count of strategies to return, rather than
returning the whole list at once.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _startAddress | address | contract address of the BaseStrategy to start with |
| _count | uint256 | maximum number of BaseStrategies that should be returned |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| _strategies | address[] | array of BaseStrategies |
| _next | address | next BaseStrategy contract address in the linked list |

### getProposalTxHash

```solidity
function getProposalTxHash(uint256 _proposalId, uint256 _txIndex) external view returns (bytes32)
```

Returns the hash of a transaction in a Proposal.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint256 | identifier of the Proposal |
| _txIndex | uint256 | index of the transaction within the Proposal |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bytes32 | bytes32 hash of the specified transaction |

### getProposalTxHashes

```solidity
function getProposalTxHashes(uint256 _proposalId) external view returns (bytes32[])
```

Returns the transaction hashes associated with a given proposalId.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint256 | identifier of the Proposal to get transaction hashes for |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bytes32[] | bytes32[] array of transaction hashes |

### getProposal

```solidity
function getProposal(uint256 _proposalId) external view returns (address _strategy, bytes32[] _txHashes, uint256 _timelockPeriod, uint256 _executionPeriod, uint256 _executionCounter)
```

Returns details about the specified Proposal.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint256 | identifier of the Proposal |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| _strategy | address | address of the BaseStrategy contract the Proposal is on |
| _txHashes | bytes32[] | hashes of the transactions the Proposal contains |
| _timelockPeriod | uint256 | time (in blocks) the Proposal is timelocked for |
| _executionPeriod | uint256 | time (in blocks) the Proposal must be executed within, after timelock ends |
| _executionCounter | uint256 | counter of how many of the Proposals transactions have been executed |

### enableStrategy

```solidity
function enableStrategy(address _strategy) public
```

Enables a BaseStrategy implementation for newly created Proposals.

Multiple strategies can be enabled, and new Proposals will be able to be
created using any of the currently enabled strategies.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _strategy | address | contract address of the BaseStrategy to be enabled. |

### disableStrategy

```solidity
function disableStrategy(address _prevStrategy, address _strategy) public
```

Disables a previously enabled BaseStrategy implementation for new proposal.
This has no effect on existing Proposals, either ACTIVE or completed.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _prevStrategy | address | BaseStrategy that pointed to the strategy to be removed in the linked list |
| _strategy | address | BaseStrategy implementation to be removed |

### isStrategyEnabled

```solidity
function isStrategyEnabled(address _strategy) public view returns (bool)
```

Returns whether a BaseStrategy implementation is enabled.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _strategy | address | contract address of the BaseStrategy to check |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bool | bool True if the strategy is enabled, otherwise False |

### proposalState

```solidity
function proposalState(uint256 _proposalId) public view returns (enum IAzorius.ProposalState)
```

Gets the state of a Proposal.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint256 | identifier of the Proposal |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | enum IAzorius.ProposalState | ProposalState uint256 ProposalState enum value representing of the         current state of the proposal |

### generateTxHashData

```solidity
function generateTxHashData(address _to, uint256 _value, bytes _data, enum Enum.Operation _operation, uint256 _nonce) public view returns (bytes)
```

Generates the data for the module transaction hash (required for signing).

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _to | address | target address of the transaction |
| _value | uint256 | ETH value to send with the transaction |
| _data | bytes | encoded function call data of the transaction |
| _operation | enum Enum.Operation | Enum.Operation to use for the transaction |
| _nonce | uint256 | Safe nonce of the transaction |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bytes | bytes hashed transaction data |

### getTxHash

```solidity
function getTxHash(address _to, uint256 _value, bytes _data, enum Enum.Operation _operation) public view returns (bytes32)
```

Returns the keccak256 hash of the specified transaction.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _to | address | target address of the transaction |
| _value | uint256 | ETH value to send with the transaction |
| _data | bytes | encoded function call data of the transaction |
| _operation | enum Enum.Operation | Enum.Operation to use for the transaction |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bytes32 | bytes32 transaction hash |

### _executeProposalTx

```solidity
function _executeProposalTx(uint256 _proposalId, address _target, uint256 _value, bytes _data, enum Enum.Operation _operation) internal returns (bytes32 txHash)
```

Executes the specified transaction in a Proposal, by index.
Transactions in a proposal must be called in order.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint256 | identifier of the proposal |
| _target | address | contract to be called by the avatar |
| _value | uint256 | ETH value to pass with the call |
| _data | bytes | data to be executed from the call |
| _operation | enum Enum.Operation | Call or Delegatecall |

### _setUpStrategies

```solidity
function _setUpStrategies(address[] _strategies) internal
```

Enables the specified array of BaseStrategy contract addresses.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _strategies | address[] | array of BaseStrategy contract addresses to enable |

### _updateTimelockPeriod

```solidity
function _updateTimelockPeriod(uint256 _timelockPeriod) internal
```

Updates the timelock period for future Proposals.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _timelockPeriod | uint256 | new timelock period (in blocks) |

### _updateExecutionPeriod

```solidity
function _updateExecutionPeriod(uint256 _executionPeriod) internal
```

Updates the execution period for future Proposals.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _executionPeriod | uint256 | new execution period (in blocks) |

