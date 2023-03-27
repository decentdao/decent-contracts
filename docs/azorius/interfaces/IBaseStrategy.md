# Solidity API

## IBaseStrategy

The specification for a voting strategy in Azorius.

Each IBaseStrategy implementation need only implement the given functions here,
which allows for highly composable but simple or complex voting strategies.

It should be noted that while many voting strategies make use of parameters such as
voting period or quorum, that is a detail of the individual strategy itself, and not
a requirement for the Azorius protocol.

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
function initializeProposal(bytes _data) external
```

Called by the [Azorius](../Azorius.md) module. This notifies this 
[BaseStrategy](../BaseStrategy.md) that a new Proposal has been created.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _data | bytes | arbitrary data to pass to this BaseStrategy |

### isPassed

```solidity
function isPassed(uint256 _proposalId) external view returns (bool)
```

Returns whether a Proposal has been passed.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint256 | proposalId to check |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bool | bool true if the proposal has passed, otherwise false |

### isProposer

```solidity
function isProposer(address _address) external view returns (bool)
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
function votingEndBlock(uint256 _proposalId) external view returns (uint256)
```

Returns the block number voting ends on a given Proposal.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint256 | proposalId to check |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | uint256 block number when voting ends on the Proposal |

