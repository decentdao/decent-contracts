# Solidity API

## LinearERC20Voting

An [Azorius](./Azorius.md) [BaseStrategy](./BaseStrategy.md) implementation that 
enables linear (i.e. 1 to 1) token voting. Each token delegated to a given address 
in an `ERC20Votes` token equals 1 vote for a Proposal. // TODO we're actually using ERC20Votes here?

### VoteType

```solidity
enum VoteType {
  NO,
  YES,
  ABSTAIN
}
```

### ProposalVotes

```solidity
struct ProposalVotes {
  uint256 noVotes;
  uint256 yesVotes;
  uint256 abstainVotes;
  uint256 votingStartBlock;
  uint256 votingEndBlock;
  mapping(address => bool) hasVoted;
}
```

### governanceToken

```solidity
contract ERC20Votes governanceToken
```

### votingPeriod

```solidity
uint256 votingPeriod
```

Number of blocks a new Proposal can be voted on.

### proposalVotes

```solidity
mapping(uint256 => struct LinearERC20Voting.ProposalVotes) proposalVotes
```

`proposalId` to `ProposalVotes`, the voting state of a Proposal.

### VotingPeriodUpdated

```solidity
event VotingPeriodUpdated(uint256 votingPeriod)
```

### ProposalInitialized

```solidity
event ProposalInitialized(uint256 proposalId, uint256 votingEndBlock)
```

### Voted

```solidity
event Voted(address voter, uint256 proposalId, uint8 voteType, uint256 weight)
```

### InvalidProposal

```solidity
error InvalidProposal()
```

### VotingEnded

```solidity
error VotingEnded()
```

### AlreadyVoted

```solidity
error AlreadyVoted()
```

### InvalidVote

```solidity
error InvalidVote()
```

### InvalidTokenAddress

```solidity
error InvalidTokenAddress()
```

### setUp

```solidity
function setUp(bytes initializeParams) public
```

Sets up the contract with its initial parameters.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| initializeParams | bytes | encoded initialization parameters: `address _owner`, `ERC20Votes _governanceToken`, `address _azoriusModule`, `uint256 _votingPeriod`, `uint256 _quorumNumerator` |

### updateVotingPeriod

```solidity
function updateVotingPeriod(uint256 _votingPeriod) external
```

Updates the voting time period for new Proposals.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _votingPeriod | uint256 | voting time period (in blocks) |

### initializeProposal

```solidity
function initializeProposal(bytes _data) external virtual
```

Called by the [Azorius](../Azorius.md) module. This notifies this 
[BaseStrategy](../BaseStrategy.md) that a new Proposal has been created.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _data | bytes | arbitrary data to pass to this BaseStrategy |

### vote

```solidity
function vote(uint256 _proposalId, uint8 _voteType, bytes) external
```

Casts votes for a Proposal, equal to the caller's token delegation.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint256 | id of the Proposal to vote on |
| _voteType | uint8 | Proposal support as defined in VoteType (NO, YES, ABSTAIN) |
|  | bytes |  |

### getProposalVotes

```solidity
function getProposalVotes(uint256 _proposalId) external view returns (uint256 noVotes, uint256 yesVotes, uint256 abstainVotes, uint256 startBlock, uint256 endBlock)
```

Returns the current state of the specified Proposal.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint256 | id of the Proposal |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| noVotes | uint256 | current count of "NO" votes |
| yesVotes | uint256 | current count of "YES" votes |
| abstainVotes | uint256 | current count of "ABSTAIN" votes |
| startBlock | uint256 | block number voting starts |
| endBlock | uint256 | block number voting ends |

### hasVoted

```solidity
function hasVoted(uint256 _proposalId, address _address) public view returns (bool)
```

Returns whether an address has voted on the specified Proposal.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint256 | id of the Proposal to check |
| _address | address | address to check |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bool | bool true if the address has voted on the Proposal, otherwise false |

### isPassed

```solidity
function isPassed(uint256 _proposalId) public view returns (bool)
```

Returns whether a Proposal has been passed.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint256 | proposalId to check |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bool | bool true if the proposal has passed, otherwise false |

### quorum

```solidity
function quorum(uint256 _blockNumber) public view returns (uint256)
```

Calculates the number of votes needed to achieve quorum at a specific block number.

Because token supply is not necessarily static, it is required to calculate
quorum based on the supply at the time of a Proposal's creation.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _blockNumber | uint256 | block number to calculate quorum at |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | uint256 the number of votes needed for quorum |

### getVotingWeight

```solidity
function getVotingWeight(address _voter, uint256 _proposalId) public view returns (uint256)
```

Calculates the voting weight an address has for a specific Proposal.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _voter | address | address of the voter |
| _proposalId | uint256 | id of the Proposal |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | uint256 the address' voting weight |

### isProposer

```solidity
function isProposer(address) public pure returns (bool)
```

Returns whether the specified address can submit a Proposal with
this [BaseStrategy](../BaseStrategy.md).

This allows a BaseStrategy to place any limits it would like on
who can create new Proposals, such as requiring a minimum token
delegation.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
|  | address |  |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bool | bool true if the address can submit a Proposal, otherwise false |

### votingEndBlock

```solidity
function votingEndBlock(uint256 _proposalId) public view returns (uint256)
```

Returns the block number voting ends on a given Proposal.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint256 | proposalId to check |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | uint256 block number when voting ends on the Proposal |

### _updateVotingPeriod

```solidity
function _updateVotingPeriod(uint256 _votingPeriod) internal
```

Internal implementation of `updateVotingPeriod`.

### _vote

```solidity
function _vote(uint256 _proposalId, address _voter, uint8 _voteType, uint256 _weight) internal
```

Internal function for casting a vote on a Proposal.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint256 | id of the Proposal |
| _voter | address | address casting the vote |
| _voteType | uint8 | vote support, as defined in VoteType |
| _weight | uint256 | amount of voting weight cast, typically the          total number of tokens delegated |

