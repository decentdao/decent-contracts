# Solidity API

## MultisigFreezeVoting

A BaseFreezeVoting implementation which handles freezes on multi-sig (Safe) based DAOs.

### parentGnosisSafe

```solidity
contract ISafe parentGnosisSafe
```

### MultisigFreezeVotingSetup

```solidity
event MultisigFreezeVotingSetup(address owner, address parentGnosisSafe)
```

### NotOwner

```solidity
error NotOwner()
```

### AlreadyVoted

```solidity
error AlreadyVoted()
```

### setUp

```solidity
function setUp(bytes initializeParams) public
```

Initialize function, will be triggered when a new instance is deployed.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| initializeParams | bytes | encoded initialization parameters: `address _owner`, `uint256 _freezeVotesThreshold`, `uint256 _freezeProposalPeriod`, `uint256 _freezePeriod`, `address _parentGnosisSafe` |

### castFreezeVote

```solidity
function castFreezeVote() external
```

