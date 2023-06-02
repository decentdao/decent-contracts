# Solidity API

## LinearERC20WrappedVoting

An extension of [LinearERC20Voting](./azorius/LinearERC20Voting.md) that properly supports
[VotesERC20Wrapper](./VotesERC20Wrapper.md) token governance.

This snapshots and uses the total supply of the underlying token for calculating quorum,
rather than the total supply of *wrapped* tokens, as would be the case without it.

### votingSupply

```solidity
mapping(uint256 => uint256) votingSupply
```

`proposalId` to "past total supply" of tokens.

### initializeProposal

```solidity
function initializeProposal(bytes _data) public virtual
```

Called by the [Azorius](../Azorius.md) module. This notifies this 
[BaseStrategy](../BaseStrategy.md) that a new Proposal has been created.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _data | bytes | arbitrary data to pass to this BaseStrategy |

### getProposalVotingSupply

```solidity
function getProposalVotingSupply(uint32 _proposalId) public view returns (uint256)
```

Returns a snapshot of total voting supply for a given Proposal.  Because token supplies can change,
it is necessary to calculate quorum from the supply available at the time of the Proposal's creation,
not when it is being voted on passes / fails.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint32 | id of the Proposal |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | uint256 voting supply snapshot for the given _proposalId |

