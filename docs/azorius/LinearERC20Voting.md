# Solidity API

## LinearERC20Voting

An [Azorius](./Azorius.md) [BaseStrategy](./BaseStrategy.md) implementation that 
enables linear (i.e. 1 to 1) token voting. Each token delegated to a given address 
in an `ERC20Votes` token equals 1 vote for a Proposal.

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
  uint32 votingStartBlock;
  uint32 votingEndBlock;
  uint256 noVotes;
  uint256 yesVotes;
  uint256 abstainVotes;
  mapping(address => bool) hasVoted;
}
```

### governanceToken

```solidity
contract IVotes governanceToken
```

### votingPeriod

```solidity
uint32 votingPeriod
```

Number of blocks a new Proposal can be voted on.

### requiredProposerWeight

```solidity
uint256 requiredProposerWeight
```

Voting weight required to be able to submit Proposals.

### proposalVotes

```solidity
mapping(uint256 => struct LinearERC20Voting.ProposalVotes) proposalVotes
```

`proposalId` to `ProposalVotes`, the voting state of a Proposal.

### VotingPeriodUpdated

```solidity
event VotingPeriodUpdated(uint32 votingPeriod)
```

### RequiredProposerWeightUpdated

```solidity
event RequiredProposerWeightUpdated(uint256 requiredProposerWeight)
```

### ProposalInitialized

```solidity
event ProposalInitialized(uint32 proposalId, uint32 votingEndBlock)
```

### Voted

```solidity
event Voted(address voter, uint32 proposalId, uint8 voteType, uint256 weight)
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
| initializeParams | bytes | encoded initialization parameters: `address _owner`, `ERC20Votes _governanceToken`, `address _azoriusModule`, `uint256 _votingPeriod`, `uint256 _quorumNumerator`, `uint256 _basisNumerator` |

### updateVotingPeriod

```solidity
function updateVotingPeriod(uint32 _votingPeriod) external
```

Updates the voting time period for new Proposals.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _votingPeriod | uint32 | voting time period (in blocks) |

### updateRequiredProposerWeight

```solidity
function updateRequiredProposerWeight(uint256 _requiredProposerWeight) external
```

Updates the voting weight required to submit new Proposals.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _requiredProposerWeight | uint256 | required token voting weight |

### vote

```solidity
function vote(uint32 _proposalId, uint8 _voteType) external
```

Casts votes for a Proposal, equal to the caller's token delegation.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint32 | id of the Proposal to vote on |
| _voteType | uint8 | Proposal support as defined in VoteType (NO, YES, ABSTAIN) |

### getProposalVotes

```solidity
function getProposalVotes(uint32 _proposalId) external view returns (uint256 noVotes, uint256 yesVotes, uint256 abstainVotes, uint32 startBlock, uint32 endBlock, uint256 votingSupply)
```

Returns the current state of the specified Proposal.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint32 | id of the Proposal |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| noVotes | uint256 | current count of "NO" votes |
| yesVotes | uint256 | current count of "YES" votes |
| abstainVotes | uint256 | current count of "ABSTAIN" votes |
| startBlock | uint32 | block number voting starts |
| endBlock | uint32 | block number voting ends |
| votingSupply | uint256 |  |

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

### hasVoted

```solidity
function hasVoted(uint32 _proposalId, address _address) public view returns (bool)
```

Returns whether an address has voted on the specified Proposal.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint32 | id of the Proposal to check |
| _address | address | address to check |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bool | bool true if the address has voted on the Proposal, otherwise false |

### isPassed

```solidity
function isPassed(uint32 _proposalId) public view returns (bool)
```

Returns whether a Proposal has been passed.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint32 | proposalId to check |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bool | bool true if the proposal has passed, otherwise false |

### getProposalVotingSupply

```solidity
function getProposalVotingSupply(uint32 _proposalId) public view virtual returns (uint256)
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

### getVotingWeight

```solidity
function getVotingWeight(address _voter, uint32 _proposalId) public view returns (uint256)
```

Calculates the voting weight an address has for a specific Proposal.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _voter | address | address of the voter |
| _proposalId | uint32 | id of the Proposal |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | uint256 the address' voting weight |

### isProposer

```solidity
function isProposer(address _address) public view returns (bool)
```

Returns whether the specified address can submit a Proposal with
this [BaseStrategy](../BaseStrategy.md).

This allows a BaseStrategy to place any limits it would like on
who can create new Proposals, such as requiring a minimum token
delegation.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _address | address | address to check |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bool | bool true if the address can submit a Proposal, otherwise false |

### votingEndBlock

```solidity
function votingEndBlock(uint32 _proposalId) public view returns (uint32)
```

Returns the block number voting ends on a given Proposal.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint32 | proposalId to check |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint32 | uint32 block number when voting ends on the Proposal |

### _updateVotingPeriod

```solidity
function _updateVotingPeriod(uint32 _votingPeriod) internal
```

Internal implementation of `updateVotingPeriod`.

### _updateRequiredProposerWeight

```solidity
function _updateRequiredProposerWeight(uint256 _requiredProposerWeight) internal
```

Internal implementation of `updateRequiredProposerWeight`.

### _vote

```solidity
function _vote(uint32 _proposalId, address _voter, uint8 _voteType, uint256 _weight) internal
```

Internal function for casting a vote on a Proposal.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint32 | id of the Proposal |
| _voter | address | address casting the vote |
| _voteType | uint8 | vote support, as defined in VoteType |
| _weight | uint256 | amount of voting weight cast, typically the          total number of tokens delegated |

### quorumVotes

```solidity
function quorumVotes(uint32 _proposalId) public view returns (uint256)
```

Calculates the total number of votes required for a proposal to meet quorum.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _proposalId | uint32 | The ID of the proposal to get quorum votes for |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | uint256 The quantity of votes required to meet quorum |

