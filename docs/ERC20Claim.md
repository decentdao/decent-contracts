# Solidity API

## ERC20Claim

A simple contract that allows for parent DAOs that have created a new ERC-20 
token voting subDAO to allocate a certain amount of those tokens as claimable 
by the parent DAO's token holders.

### funder

```solidity
address funder
```

The address of the initial holder of the claimable `childERC20` tokens.

### deadlineBlock

```solidity
uint256 deadlineBlock
```

The deadline block to claim tokens by, or 0 for indefinite.

### childERC20

```solidity
address childERC20
```

Child ERC20 token address, to calculate the percentage claimable.

### parentERC20

```solidity
address parentERC20
```

Parent ERC20 token address, for calculating a snapshot of holdings.

### snapShotId

```solidity
uint256 snapShotId
```

Id of a snapshot of token holdings for this claim (see [VotesERC20](./VotesERC20.md)).

### parentAllocation

```solidity
uint256 parentAllocation
```

Total amount of `childERC20` tokens allocated for claiming by parent holders.

### claimed

```solidity
mapping(address => bool) claimed
```

Mapping of address to bool of whether the address has claimed already.

### ERC20Claimed

```solidity
event ERC20Claimed(address pToken, address cToken, address claimer, uint256 amount)
```

### NoAllocation

```solidity
error NoAllocation()
```

### AllocationClaimed

```solidity
error AllocationClaimed()
```

### NotTheFunder

```solidity
error NotTheFunder()
```

### NoDeadline

```solidity
error NoDeadline()
```

### DeadlinePending

```solidity
error DeadlinePending()
```

### ERC20ClaimCreated

```solidity
event ERC20ClaimCreated(address parentToken, address childToken, uint256 parentAllocation, uint256 snapshotId, uint256 deadline)
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

### claimTokens

```solidity
function claimTokens(address claimer) external
```

Allows parent token holders to claim tokens allocated by a 
subDAO during its creation.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| claimer | address | address which is being claimed for, allowing any address to      process a claim for any other address |

### reclaim

```solidity
function reclaim() external
```

Returns unclaimed tokens after the claim deadline to the funder.

### getClaimAmount

```solidity
function getClaimAmount(address claimer) public view returns (uint256)
```

Gets an address' token claim amount.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| claimer | address | address to check the claim amount of |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | uint256 the given address' claim amount |

