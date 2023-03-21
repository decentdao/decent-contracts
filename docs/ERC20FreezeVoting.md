# Solidity API

## ERC20FreezeVoting

A BaseFreezeVoting implementation which handles freezes on ERC20 based token voting DAOs.

### votesERC20

```solidity
contract IVotes votesERC20
```

A reference to the ERC20 voting token of the subDAO.

### ERC20FreezeVotingSetUp

```solidity
event ERC20FreezeVotingSetUp(address owner, address votesERC20)
```

### NoVotes

```solidity
error NoVotes()
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
| initializeParams | bytes | encoded initialization parameters |

### castFreezeVote

```solidity
function castFreezeVote() external
```

