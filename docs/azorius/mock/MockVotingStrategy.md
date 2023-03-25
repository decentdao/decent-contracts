# Solidity API

## MockVotingStrategy

### proposer

```solidity
address proposer
```

### setUp

```solidity
function setUp(bytes initParams) public
```

Sets up the contract with its initial parameters.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| initParams | bytes | initial setup parameters, encoded as bytes |

### initializeProposal

```solidity
function initializeProposal(bytes _data) external
```

### isPassed

```solidity
function isPassed(uint256) external pure returns (bool)
```

### isProposer

```solidity
function isProposer(address _proposer) external view returns (bool)
```

### votingEndBlock

```solidity
function votingEndBlock(uint256) external pure returns (uint256)
```

