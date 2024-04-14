# Solidity API

## LinearERC721Voting

An Azorius strategy that allows multiple ERC721 tokens to be registered as governance tokens,
each with their own voting weight.

This is slightly different from ERC-20 voting, since there is no way to snapshot ERC721 holdings.
Each ERC721 id can vote once, reguardless of what address held it when a proposal was created.

Also, this uses "quorumThreshold" rather than LinearERC20Voting's quorumPercent, because the
total supply of NFTs is not knowable within the IERC721 interface. This is similar to a multisig
"total signers" required, rather than a percentage of the tokens.

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
  mapping(address => mapping(uint256 => bool)) hasVoted;
}
```

### proposalVotes

```solidity
mapping(uint256 => struct LinearERC721Voting.ProposalVotes) proposalVotes
```

`proposalId` to `ProposalVotes`, the voting state of a Proposal.

### tokenAddresses

```solidity
address[] tokenAddresses
```

The list of ERC-721 tokens that can vote.

### tokenWeights

```solidity
mapping(address => uint256) tokenWeights
```

ERC-721 address to its voting weight per NFT id.

### votingPeriod

```solidity
uint32 votingPeriod
```

Number of blocks a new Proposal can be voted on.

### quorumThreshold

```solidity
uint256 quorumThreshold
```

The total number of votes required to achieve quorum.
"Quorum threshold" is used instead of a quorum percent because IERC721 has no
totalSupply function, so the contract cannot determine this.

### proposerThreshold

```solidity
uint256 proposerThreshold
```

The minimum number of voting power required to create a new proposal.

### VotingPeriodUpdated

```solidity
event VotingPeriodUpdated(uint32 votingPeriod)
```

### QuorumThresholdUpdated

```solidity
event QuorumThresholdUpdated(uint256 quorumThreshold)
```

### ProposerThresholdUpdated

```solidity
event ProposerThresholdUpdated(uint256 proposerThreshold)
```

### ProposalInitialized

```solidity
event ProposalInitialized(uint32 proposalId, uint32 votingEndBlock)
```

### Voted

```solidity
event Voted(address voter, uint32 proposalId, uint8 voteType, uint256 weight)
```

### GovernanceTokenAdded

```solidity
event GovernanceTokenAdded(address token, uint256 weight)
```

### GovernanceTokenRemoved

```solidity
event GovernanceTokenRemoved(address token)
```

### InvalidParams

```solidity
error InvalidParams()
```

### InvalidProposal

```solidity
error InvalidProposal()
```

### VotingEnded

```solidity
error VotingEnded()
```

### InvalidVote

```solidity
error InvalidVote()
```

### InvalidTokenAddress

```solidity
error InvalidTokenAddress()
```

### NoVotingWeight

```solidity
error NoVotingWeight()
```

### TokenAlreadySet

```solidity
error TokenAlreadySet()
```

### TokenNotSet

```solidity
error TokenNotSet()
```

### IdAlreadyVoted

```solidity
error IdAlreadyVoted(uint256 tokenId)
```

### IdNotOwned

```solidity
error IdNotOwned(uint256 tokenId)
```

### setUp

```solidity
function setUp(bytes initializeParams) public
```

Sets up the contract with its initial parameters.

#### Parameters

| Name             | Type  | Description                                                                                                                                                                                                                                         |
| ---------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| initializeParams | bytes | encoded initialization parameters: `address _owner`, `address[] memory _tokens`, `uint256[] memory _weights`, `address _azoriusModule`, `uint32 _votingPeriod`, `uint256 _quorumThreshold`, `uint256 _proposerThreshold`, `uint256 _basisNumerator` |

### addGovernanceToken

```solidity
function addGovernanceToken(address _tokenAddress, uint256 _weight) external
```

Adds a new ERC-721 token as a governance token, along with its associated weight.

#### Parameters

| Name           | Type    | Description                              |
| -------------- | ------- | ---------------------------------------- |
| \_tokenAddress | address | the address of the ERC-721 token         |
| \_weight       | uint256 | the number of votes each NFT id is worth |

### updateVotingPeriod

```solidity
function updateVotingPeriod(uint32 _votingPeriod) external
```

Updates the voting time period for new Proposals.

#### Parameters

| Name           | Type   | Description                    |
| -------------- | ------ | ------------------------------ |
| \_votingPeriod | uint32 | voting time period (in blocks) |

### updateQuorumThreshold

```solidity
function updateQuorumThreshold(uint256 _quorumThreshold) external
```

Updates the quorum required for future Proposals.

#### Parameters

| Name              | Type    | Description                                    |
| ----------------- | ------- | ---------------------------------------------- |
| \_quorumThreshold | uint256 | total voting weight required to achieve quorum |

### updateProposerThreshold

```solidity
function updateProposerThreshold(uint256 _proposerThreshold) external
```

Updates the voting weight required to submit new Proposals.

#### Parameters

| Name                | Type    | Description            |
| ------------------- | ------- | ---------------------- |
| \_proposerThreshold | uint256 | required voting weight |

### getProposalVotes

```solidity
function getProposalVotes(uint32 _proposalId) external view returns (uint256 noVotes, uint256 yesVotes, uint256 abstainVotes, uint32 startBlock, uint32 endBlock)
```

Returns the current state of the specified Proposal.

#### Parameters

| Name         | Type   | Description        |
| ------------ | ------ | ------------------ |
| \_proposalId | uint32 | id of the Proposal |

#### Return Values

| Name         | Type    | Description                      |
| ------------ | ------- | -------------------------------- |
| noVotes      | uint256 | current count of "NO" votes      |
| yesVotes     | uint256 | current count of "YES" votes     |
| abstainVotes | uint256 | current count of "ABSTAIN" votes |
| startBlock   | uint32  | block number voting starts       |
| endBlock     | uint32  | block number voting ends         |

### vote

```solidity
function vote(uint32 _proposalId, uint8 _voteType, address[] _tokenAddresses, uint256[] _tokenIds) external
```

Submits a vote on an existing Proposal.

#### Parameters

| Name             | Type      | Description                                                                           |
| ---------------- | --------- | ------------------------------------------------------------------------------------- |
| \_proposalId     | uint32    | id of the Proposal to vote on                                                         |
| \_voteType       | uint8     | Proposal support as defined in VoteType (NO, YES, ABSTAIN)                            |
| \_tokenAddresses | address[] | list of ERC-721 addresses that correspond to ids in \_tokenIds                        |
| \_tokenIds       | uint256[] | list of unique token ids that correspond to their ERC-721 address in \_tokenAddresses |

### getTokenWeight

```solidity
function getTokenWeight(address _tokenAddress) external view returns (uint256)
```

Returns the current token weight for the given ERC-721 token address.

#### Parameters

| Name           | Type    | Description               |
| -------------- | ------- | ------------------------- |
| \_tokenAddress | address | the ERC-721 token address |

### hasVoted

```solidity
function hasVoted(uint32 _proposalId, address _tokenAddress, uint256 _tokenId) external view returns (bool)
```

Returns whether an NFT id has already voted.

#### Parameters

| Name           | Type    | Description                  |
| -------------- | ------- | ---------------------------- |
| \_proposalId   | uint32  | the id of the Proposal       |
| \_tokenAddress | address | the ERC-721 contract address |
| \_tokenId      | uint256 | the unique id of the NFT     |

### removeGovernanceToken

```solidity
function removeGovernanceToken(address _tokenAddress) external
```

Removes the given ERC-721 token address from the list of governance tokens.

#### Parameters

| Name           | Type    | Description                 |
| -------------- | ------- | --------------------------- |
| \_tokenAddress | address | the ERC-721 token to remove |

### initializeProposal

```solidity
function initializeProposal(bytes _data) public virtual
```

Called by the [Azorius](../Azorius.md) module. This notifies this
[BaseStrategy](../BaseStrategy.md) that a new Proposal has been created.

#### Parameters

| Name   | Type  | Description                                 |
| ------ | ----- | ------------------------------------------- |
| \_data | bytes | arbitrary data to pass to this BaseStrategy |

### isPassed

```solidity
function isPassed(uint32 _proposalId) public view returns (bool)
```

Returns whether a Proposal has been passed.

#### Parameters

| Name         | Type   | Description         |
| ------------ | ------ | ------------------- |
| \_proposalId | uint32 | proposalId to check |

#### Return Values

| Name | Type | Description                                           |
| ---- | ---- | ----------------------------------------------------- |
| [0]  | bool | bool true if the proposal has passed, otherwise false |

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

| Name      | Type    | Description      |
| --------- | ------- | ---------------- |
| \_address | address | address to check |

#### Return Values

| Name | Type | Description                                                     |
| ---- | ---- | --------------------------------------------------------------- |
| [0]  | bool | bool true if the address can submit a Proposal, otherwise false |

### votingEndBlock

```solidity
function votingEndBlock(uint32 _proposalId) public view returns (uint32)
```

Returns the block number voting ends on a given Proposal.

#### Parameters

| Name         | Type   | Description         |
| ------------ | ------ | ------------------- |
| \_proposalId | uint32 | proposalId to check |

#### Return Values

| Name | Type   | Description                                          |
| ---- | ------ | ---------------------------------------------------- |
| [0]  | uint32 | uint32 block number when voting ends on the Proposal |

### \_addGovernanceToken

```solidity
function _addGovernanceToken(address _tokenAddress, uint256 _weight) internal
```

Internal implementation of `addGovernanceToken`

### \_updateVotingPeriod

```solidity
function _updateVotingPeriod(uint32 _votingPeriod) internal
```

Internal implementation of `updateVotingPeriod`.

### \_updateQuorumThreshold

```solidity
function _updateQuorumThreshold(uint256 _quorumThreshold) internal
```

Internal implementation of `updateQuorumThreshold`.

### \_updateProposerThreshold

```solidity
function _updateProposerThreshold(uint256 _proposerThreshold) internal
```

Internal implementation of `updateProposerThreshold`.

### \_vote

```solidity
function _vote(uint32 _proposalId, address _voter, uint8 _voteType, address[] _tokenAddresses, uint256[] _tokenIds) internal
```

Internal function for casting a vote on a Proposal.

#### Parameters

| Name             | Type      | Description                                                                           |
| ---------------- | --------- | ------------------------------------------------------------------------------------- |
| \_proposalId     | uint32    | id of the Proposal                                                                    |
| \_voter          | address   | address casting the vote                                                              |
| \_voteType       | uint8     | vote support, as defined in VoteType                                                  |
| \_tokenAddresses | address[] | list of ERC-721 addresses that correspond to ids in \_tokenIds                        |
| \_tokenIds       | uint256[] | list of unique token ids that correspond to their ERC-721 address in \_tokenAddresses |
