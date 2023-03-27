# Solidity API

## BaseFreezeVoting

The base abstract contract which holds the state of a vote to freeze a childDAO.

The freeze feature gives a way for parentDAOs to have a limited measure of control
over their created subDAOs.

Normally a subDAO operates independently, and can vote on or sign transactions, 
however should the parent disagree with a decision made by the subDAO, any parent
token holder can initiate a vote to "freeze" it, making executing transactions impossible
for the time denoted by `freezePeriod`.

This requires a number of votes equal to `freezeVotesThreshold`, within the `freezeProposalPeriod`
to be successful.

Following a successful freeze vote, the childDAO will be unable to execute transactions, due to
a Safe Transaction Guard, until the `freezePeriod` has elapsed.

### freezeVotesThreshold

```solidity
uint256 freezeVotesThreshold
```

Number of freeze votes required to activate a freeze.

### freezeProposalCreatedBlock

```solidity
uint256 freezeProposalCreatedBlock
```

Block number the freeze proposal was created at.

### freezeProposalVoteCount

```solidity
uint256 freezeProposalVoteCount
```

Number of accrued freeze votes.

### freezeProposalPeriod

```solidity
uint256 freezeProposalPeriod
```

Number of blocks a freeze proposal has to succeed.

### freezePeriod

```solidity
uint256 freezePeriod
```

Number of blocks a freeze lasts, from time of freeze proposal creation.

### userHasFreezeVoted

```solidity
mapping(address => mapping(uint256 => bool)) userHasFreezeVoted
```

Mapping of address to the block the freeze vote was started to 
whether the address has voted yet on the freeze proposal.

### FreezeVoteCast

```solidity
event FreezeVoteCast(address voter, uint256 votesCast)
```

### FreezeProposalCreated

```solidity
event FreezeProposalCreated(address creator)
```

### FreezeVotesThresholdUpdated

```solidity
event FreezeVotesThresholdUpdated(uint256 freezeVotesThreshold)
```

### FreezePeriodUpdated

```solidity
event FreezePeriodUpdated(uint256 freezePeriod)
```

### FreezeProposalPeriodUpdated

```solidity
event FreezeProposalPeriodUpdated(uint256 freezeProposalPeriod)
```

### castFreezeVote

```solidity
function castFreezeVote() external virtual
```

Casts a positive vote to freeze the subDAO. This function is intended to be called
by the individual token holders themselves directly, and will allot their token
holdings a "yes" votes towards freezing.

Additionally, if a vote to freeze is not already running, calling this will initiate
a new vote to freeze it.

### isFrozen

```solidity
function isFrozen() external view returns (bool)
```

Returns true if the DAO is currently frozen, false otherwise.

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bool | bool whether the DAO is currently frozen |

### unfreeze

```solidity
function unfreeze() external
```

Unfreezes the DAO, only callable by the owner (parentDAO).

### updateFreezeVotesThreshold

```solidity
function updateFreezeVotesThreshold(uint256 _freezeVotesThreshold) external
```

Updates the freeze votes threshold, the number of votes required to enact a freeze.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _freezeVotesThreshold | uint256 | number of freeze votes required to activate a freeze |

### updateFreezeProposalPeriod

```solidity
function updateFreezeProposalPeriod(uint256 _freezeProposalPeriod) external
```

Updates the freeze proposal period, the time that parent token holders have to cast votes
after a freeze vote has been initiated.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _freezeProposalPeriod | uint256 | number of blocks a freeze vote has to succeed to enact a freeze |

### updateFreezePeriod

```solidity
function updateFreezePeriod(uint256 _freezePeriod) external
```

Updates the freeze period, the time the DAO will be unable to execute transactions for,
should a freeze vote pass.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _freezePeriod | uint256 | number of blocks a freeze lasts, from time of freeze proposal creation |

### _updateFreezeVotesThreshold

```solidity
function _updateFreezeVotesThreshold(uint256 _freezeVotesThreshold) internal
```

Internal implementation of `updateFreezeVotesThreshold`.

### _updateFreezeProposalPeriod

```solidity
function _updateFreezeProposalPeriod(uint256 _freezeProposalPeriod) internal
```

Internal implementation of `updateFreezeProposalPeriod`.

### _updateFreezePeriod

```solidity
function _updateFreezePeriod(uint256 _freezePeriod) internal
```

Internal implementation of `updateFreezePeriod`.

