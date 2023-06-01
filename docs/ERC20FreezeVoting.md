# Solidity API

## ERC20FreezeVoting

A [BaseFreezeVoting](./BaseFreezeVoting.md) implementation which handles 
freezes on ERC20 based token voting DAOs.

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
| initializeParams | bytes | encoded initialization parameters: `address _owner`, `uint256 _freezeVotesThreshold`, `uint256 _freezeProposalPeriod`, `uint256 _freezePeriod`, `address _votesERC20` |

### castFreezeVote

```solidity
function castFreezeVote() external
```

Casts a positive vote to freeze the subDAO. This function is intended to be called
by the individual token holders themselves directly, and will allot their token
holdings a "yes" votes towards freezing.

Additionally, if a vote to freeze is not already running, calling this will initiate
a new vote to freeze it.

