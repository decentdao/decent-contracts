# Solidity API

## IBaseFreezeVoting

A specification for a contract which manages the ability to call for and cast a vote
to freeze a subDAO.

This participants of this vote are parent token holders or signers. The DAO should be
able to operate as normal throughout the freeze voting process, however if the vote
passed, further transaction executions on the subDAO should be blocked via a Safe guard
module (see MultisigFreezeGuard / AzoriusFreezeGuard).

### castFreezeVote

```solidity
function castFreezeVote() external
```

Allows an address to cast a "freeze vote", which is a vote to freeze the DAO
from executing transactions, even if they've already passed via a Proposal.

If a vote to freeze has not already been initiated, a call to this function will do
so.

This function should be publicly callable by any DAO token holder or signer.

### unfreeze

```solidity
function unfreeze() external
```

Unfreezes the DAO.

### updateFreezeVotesThreshold

```solidity
function updateFreezeVotesThreshold(uint256 _freezeVotesThreshold) external
```

Updates the freeze votes threshold for future freeze votes. This is the number of token
votes necessary to begin a freeze on the subDAO.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _freezeVotesThreshold | uint256 | number of freeze votes required to activate a freeze |

### updateFreezeProposalPeriod

```solidity
function updateFreezeProposalPeriod(uint256 _freezeProposalPeriod) external
```

Updates the freeze proposal period for future freeze votes. This is the length of time
(in blocks) that a freeze vote is conducted for.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _freezeProposalPeriod | uint256 | number of blocks a freeze proposal has to succeed |

### updateFreezePeriod

```solidity
function updateFreezePeriod(uint256 _freezePeriod) external
```

Updates the freeze period. This is the length of time (in blocks) the subDAO is actually
frozen for if a freeze vote passes.

This period can be overridden by a call to unfreeze(), which would require a passed Proposal
from the subDAO.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _freezePeriod | uint256 | number of blocks a freeze lasts, from time of freeze proposal creation |

### isFrozen

```solidity
function isFrozen() external view returns (bool)
```

Returns true if the DAO is currently frozen, false otherwise.

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bool | bool whether the DAO is currently frozen |

