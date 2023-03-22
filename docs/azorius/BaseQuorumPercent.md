# Solidity API

## BaseQuorumPercent

### quorumNumerator

```solidity
uint256 quorumNumerator
```

### QUORUM_DENOMINATOR

```solidity
uint256 QUORUM_DENOMINATOR
```

### InvalidQuorumNumerator

```solidity
error InvalidQuorumNumerator()
```

### QuorumNumeratorUpdated

```solidity
event QuorumNumeratorUpdated(uint256 quorumNumerator)
```

### quorum

```solidity
function quorum(uint256 _blockNumber) public view virtual returns (uint256)
```

### updateQuorumNumerator

```solidity
function updateQuorumNumerator(uint256 _quorumNumerator) public virtual
```

### _updateQuorumNumerator

```solidity
function _updateQuorumNumerator(uint256 _quorumNumerator) internal virtual
```

