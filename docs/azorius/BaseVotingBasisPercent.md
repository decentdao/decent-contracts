# Solidity API

## BaseVotingBasisPercent

An Azorius extension contract that enables percent based voting basis calculations.

Intended to be implemented by BaseStrategy implementations, this allows for voting strategies
to dictate any basis strategy for passing a Proposal between >50% (simple majority) to 100%.

See https://en.wikipedia.org/wiki/Voting#Voting_basis.
See https://en.wikipedia.org/wiki/Supermajority.

### basisNumerator

```solidity
uint256 basisNumerator
```

The numerator to use when calculating basis (adjustable).

### BASIS_DENOMINATOR

```solidity
uint256 BASIS_DENOMINATOR
```

The denominator to use when calculating basis (1,000,000).

### InvalidBasisNumerator

```solidity
error InvalidBasisNumerator()
```

### BasisNumeratorUpdated

```solidity
event BasisNumeratorUpdated(uint256 basisNumerator)
```

### updateBasisNumerator

```solidity
function updateBasisNumerator(uint256 _basisNumerator) public virtual
```

Updates the `basisNumerator` for future Proposals.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _basisNumerator | uint256 | numerator to use |

### _updateBasisNumerator

```solidity
function _updateBasisNumerator(uint256 _basisNumerator) internal virtual
```

Internal implementation of `updateBasisNumerator`.

### meetsBasis

```solidity
function meetsBasis(uint256 _yesVotes, uint256 _noVotes) public view returns (bool)
```

Calculates whether a vote meets its basis.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _yesVotes | uint256 | number of votes in favor |
| _noVotes | uint256 | number of votes against |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bool | bool whether the yes votes meets the set basis |

