# Solidity API

## MockVotingStrategy

A mock [BaseStrategy](../BaseStrategy.md) used only for testing purposes.
Not intended for actual on-chain use.

### proposer

```solidity
address proposer
```

### setUp

```solidity
function setUp(bytes initializeParams) public
```

Sets up the contract with its initial parameters.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| initializeParams | bytes | encoded initialization parameters |

### initializeProposal

```solidity
function initializeProposal(bytes _data) external
```

### isPassed

```solidity
function isPassed(uint32) external pure returns (bool)
```

### isProposer

```solidity
function isProposer(address _proposer) external view returns (bool)
```

### votingEndBlock

```solidity
function votingEndBlock(uint32) external pure returns (uint32)
```

