# Solidity API

## BaseQuorumPercent

An Azorius extension contract that enables percent based quorums.
Intended to be implemented by BaseStrategy implementations.

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

### quorum

```solidity
function quorum(uint256 _blockNumber) public view virtual returns (uint256)
```

Calculates the number of votes needed to achieve quorum at a specific block number.

Because token supply is not necessarily static, it is required to calculate
quorum based on the supply at the time of a Proposal's creation.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _blockNumber | uint256 | block number to calculate quorum at |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | uint256 the number of votes needed for quorum |

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

Internal implementation of updateQuorumNumerator.

