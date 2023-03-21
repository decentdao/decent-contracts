# Solidity API

## ERC20Claim

A simple contract that allows for parent DAOs that have created a new ERC-20 
token voting subDAO to allocate a certain amount of those tokens as claimable 
by the parent DAO's token holders.

### funder

```solidity
address funder
```

### deadlineBlock

```solidity
uint256 deadlineBlock
```

### childERC20

```solidity
address childERC20
```

### parentERC20

```solidity
address parentERC20
```

### snapShotId

```solidity
uint256 snapShotId
```

### parentAllocation

```solidity
uint256 parentAllocation
```

### claimed

```solidity
mapping(address => bool) claimed
```

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

### reclaim

```solidity
function reclaim() external
```

Returns unclaimed tokens after the claim deadline to the funder.

