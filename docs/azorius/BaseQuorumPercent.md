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

Returns the quorum achieved at the given block number.

### updateQuorumNumerator

```solidity
function updateQuorumNumerator(uint256 _quorumNumerator) public virtual
```

Updates the quorum required for future Proposals.

### _updateQuorumNumerator

```solidity
function _updateQuorumNumerator(uint256 _quorumNumerator) internal virtual
```

Internal implementation of updateQuorumNumerator.

