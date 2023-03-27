# Solidity API

## IAzorius

The base interface for the Azorius governance Safe module.
Azorius conforms to the Zodiac pattern for Safe modules: https://github.com/gnosis/zodiac

Azorius manages the state of Proposals submitted to a DAO, along with the associated strategies
([BaseStrategy](../BaseStrategy.md)) for voting that are enabled on the DAO.

Any given DAO can support multiple voting BaseStrategies, and these strategies are intended to be
as customizable as possible.

Proposals begin in the `ACTIVE` state and will ultimately end in either
the `EXECUTED`, `EXPIRED`, or `FAILED` state.

`ACTIVE` - a new proposal begins in this state, and stays in this state
         for the duration of its voting period.

`TIMELOCKED` - A proposal that passes enters the `TIMELOCKED` state, during which
         it cannot yet be executed.  This is to allow time for token holders
         to potentially exit their position, as well as parent DAOs time to
         initiate a freeze, if they choose to do so. A proposal stays timelocked
         for the duration of its `timelockPeriod`.

`EXECUTABLE` - Following the `TIMELOCKED` state, a passed proposal becomes `EXECUTABLE`,
         and can then finally be executed on chain by anyone.

`EXECUTED` - the final state for a passed proposal.  The proposal has been executed
         on the blockchain.

`EXPIRED` - a passed proposal which is not executed before its `executionPeriod` has
         elapsed will be `EXPIRED`, and can no longer be executed.

`FAILED` - a failed proposal (as defined by its [BaseStrategy](../BaseStrategy.md) 
         `isPassed` function). For a basic strategy, this would mean it received more 
         NO votes than YES or did not achieve quorum.

### Transaction

```solidity
struct Transaction {
  address to;
  uint256 value;
  bytes data;
  enum Enum.Operation operation;
}
```

### Proposal

```solidity
struct Proposal {
  address strategy;
  bytes32[] txHashes;
  uint256 timelockPeriod;
  uint256 executionPeriod;
  uint256 executionCounter;
}
```

### ProposalState

```solidity
enum ProposalState {
  ACTIVE,
  TIMELOCKED,
  EXECUTABLE,
  EXECUTED,
  EXPIRED,
  FAILED
}
```

### enableStrategy

```solidity
function enableStrategy(address _strategy) external
```

Enables a [BaseStrategy](../BaseStrategy.md) implementation for newly created Proposals.

Multiple strategies can be enabled, and new Proposals will be able to be
created using any of the currently enabled strategies.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _strategy | address | contract address of the BaseStrategy to be enabled |

### disableStrategy

```solidity
function disableStrategy(address _prevStrategy, address _strategy) external
```

Disables a previously enabled [BaseStrategy](../BaseStrategy.md) implementation for new proposals.
This has no effect on existing Proposals, either `ACTIVE` or completed.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _prevStrategy | address | BaseStrategy address that pointed in the linked list to the strategy to be removed |
| _strategy | address | address of the BaseStrategy to be removed |

### updateTimelockPeriod

```solidity
function updateTimelockPeriod(uint256 _timelockPeriod) external
```

Updates the `timelockPeriod` for newly created Proposals.
This has no effect on existing Proposals, either `ACTIVE` or completed.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _timelockPeriod | uint256 | timelockPeriod (in blocks) to be used for new Proposals |

### submitProposal

```solidity
function submitProposal(address _strategy, bytes _data, struct IAzorius.Transaction[] _transactions, string _metadata) external
```

Submits a new Proposal, using one of the enabled [BaseStrategies](../BaseStrategy.md).
New Proposals begin immediately in the `ACTIVE` state.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _strategy | address | address of the BaseStrategy implementation which the Proposal will use |
| _data | bytes | arbitrary data passed to the BaseStrategy implementation |
| _transactions | struct IAzorius.Transaction[] | array of transactions to propose |
| _metadata | string | additional data such as a title/description to submit with the proposal |

### executeProposal

```solidity
function executeProposal(uint256 _proposalId, address[] _targets, uint256[] _values, bytes[] _data, enum Enum.Operation[] _operations) external
```

Executes all transactions within a Proposal.
This will only be able to be called if the Proposal passed.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint256 | identifier of the Proposal |
| _targets | address[] | target contracts for each transaction |
| _values | uint256[] | ETH values to be sent with each transaction |
| _data | bytes[] | transaction data to be executed |
| _operations | enum Enum.Operation[] | Calls or Delegatecalls |

### isStrategyEnabled

```solidity
function isStrategyEnabled(address _strategy) external view returns (bool)
```

Returns whether a [BaseStrategy](../BaseStrategy.md) implementation is enabled.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _strategy | address | contract address of the BaseStrategy to check |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bool | bool True if the strategy is enabled, otherwise False |

### getStrategies

```solidity
function getStrategies(address _startAddress, uint256 _count) external view returns (address[] _strategies, address _next)
```

Returns an array of enabled [BaseStrategy](../BaseStrategy.md) contract addresses.
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

### proposalState

```solidity
function proposalState(uint256 _proposalId) external view returns (enum IAzorius.ProposalState)
```

Gets the state of a Proposal.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint256 | identifier of the Proposal |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | enum IAzorius.ProposalState | ProposalState uint256 ProposalState enum value representing the         current state of the proposal |

### generateTxHashData

```solidity
function generateTxHashData(address _to, uint256 _value, bytes _data, enum Enum.Operation _operation, uint256 _nonce) external view returns (bytes)
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
function getTxHash(address _to, uint256 _value, bytes _data, enum Enum.Operation _operation) external view returns (bytes32)
```

Returns the `keccak256` hash of the specified transaction.

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

Returns the transaction hashes associated with a given `proposalId`.

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

