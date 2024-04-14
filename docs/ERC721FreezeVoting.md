# Solidity API

## ERC721FreezeVoting

A [BaseFreezeVoting](./BaseFreezeVoting.md) implementation which handles
freezes on ERC721 based token voting DAOs.

### strategy

```solidity
contract IERC721VotingStrategy strategy
```

A reference to the voting strategy of the parent DAO.

### idHasFreezeVoted

```solidity
mapping(uint256 => mapping(address => mapping(uint256 => bool))) idHasFreezeVoted
```

Mapping of block the freeze vote was started on, to the token address, to token id,
to whether that token has been used to vote already.

### ERC721FreezeVotingSetUp

```solidity
event ERC721FreezeVotingSetUp(address owner, address strategy)
```

### NoVotes

```solidity
error NoVotes()
```

### NotSupported

```solidity
error NotSupported()
```

### UnequalArrays

```solidity
error UnequalArrays()
```

### setUp

```solidity
function setUp(bytes initializeParams) public
```

Initialize function, will be triggered when a new instance is deployed.

#### Parameters

| Name             | Type  | Description                        |
| ---------------- | ----- | ---------------------------------- |
| initializeParams | bytes | encoded initialization parameters. |

### castFreezeVote

```solidity
function castFreezeVote() external pure
```

Casts a positive vote to freeze the subDAO. This function is intended to be called
by the individual token holders themselves directly, and will allot their token
holdings a "yes" votes towards freezing.

Additionally, if a vote to freeze is not already running, calling this will initiate
a new vote to freeze it.

### castFreezeVote

```solidity
function castFreezeVote(address[] _tokenAddresses, uint256[] _tokenIds) external
```

### \_getVotesAndUpdateHasVoted

```solidity
function _getVotesAndUpdateHasVoted(address[] _tokenAddresses, uint256[] _tokenIds, address _voter) internal returns (uint256)
```
