# Solidity API

## BaseStrategy

The base abstract contract for all voting strategies in Azorius.

### AzoriusSet

```solidity
event AzoriusSet(address azoriusModule)
```

### StrategySetUp

```solidity
event StrategySetUp(address azoriusModule, address owner)
```

### OnlyAzorius

```solidity
error OnlyAzorius()
```

### azoriusModule

```solidity
contract IAzorius azoriusModule
```

### onlyAzorius

```solidity
modifier onlyAzorius()
```

Ensures that only the [Azorius](./Azorius.md) contract that pertains to this 
[BaseStrategy](./BaseStrategy.md) can call functions on it.

### setAzorius

```solidity
function setAzorius(address _azoriusModule) external
```

Sets the address of the [Azorius](../Azorius.md) contract this 
[BaseStrategy](../BaseStrategy.md) is being used on.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _azoriusModule | address | address of the Azorius Safe module |

### initializeProposal

```solidity
function initializeProposal(bytes _data) external virtual
```

Called by the [Azorius](../Azorius.md) module. This notifies this 
[BaseStrategy](../BaseStrategy.md) that a new Proposal has been created.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _data | bytes | arbitrary data to pass to this BaseStrategy |

### isPassed

```solidity
function isPassed(uint32 _proposalId) external view virtual returns (bool)
```

Returns whether a Proposal has been passed.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint32 | proposalId to check |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bool | bool true if the proposal has passed, otherwise false |

### isProposer

```solidity
function isProposer(address _address) external view virtual returns (bool)
```

Returns whether the specified address can submit a Proposal with
this [BaseStrategy](../BaseStrategy.md).

This allows a BaseStrategy to place any limits it would like on
who can create new Proposals, such as requiring a minimum token
delegation.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _address | address | address to check |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bool | bool true if the address can submit a Proposal, otherwise false |

### votingEndBlock

```solidity
function votingEndBlock(uint32 _proposalId) external view virtual returns (uint32)
```

Returns the block number voting ends on a given Proposal.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint32 | proposalId to check |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint32 | uint32 block number when voting ends on the Proposal |

### _setAzorius

```solidity
function _setAzorius(address _azoriusModule) internal
```

Sets the address of the [Azorius](Azorius.md) module contract.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _azoriusModule | address | address of the Azorius module |

