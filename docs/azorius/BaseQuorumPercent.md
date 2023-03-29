# Solidity API

## BaseQuorumPercent

An Azorius extension contract that enables percent based quorums.
Intended to be implemented by [BaseStrategy](./BaseStrategy.md) implementations.

### quorumNumerator

```solidity
uint256 quorumNumerator
```

The numerator to use when calculating quorum (adjustable).

### QUORUM_DENOMINATOR

```solidity
uint256 QUORUM_DENOMINATOR
```

The denominator to use when calculating quorum (1,000,000).

### InvalidQuorumNumerator

```solidity
error InvalidQuorumNumerator()
```

Ensures the numerator cannot be larger than the denominator.

### QuorumNumeratorUpdated

```solidity
event QuorumNumeratorUpdated(uint256 quorumNumerator)
```

### updateQuorumNumerator

```solidity
function updateQuorumNumerator(uint256 _quorumNumerator) public virtual
```

Updates the quorum required for future Proposals.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _quorumNumerator | uint256 | numerator to use when calculating quorum (over 1,000,000) |

### _updateQuorumNumerator

```solidity
function _updateQuorumNumerator(uint256 _quorumNumerator) internal virtual
```

Internal implementation of `updateQuorumNumerator`.

### meetsQuorum

```solidity
function meetsQuorum(uint256 _totalSupply, uint256 _yesVotes, uint256 _abstainVotes) public view returns (bool)
```

Calculates whether a vote meets quorum. This is calculated based on yes votes + abstain
votes.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _totalSupply | uint256 | the total supply of tokens |
| _yesVotes | uint256 | number of votes in favor |
| _abstainVotes | uint256 | number of votes abstaining |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bool | bool whether the total number of yes votes + abstain meets the quorum |

