# Solidity API

## IERC20Claim

A simple specification for an ERC-20 claim contract, that allows for parent 
DAOs that have created a new ERC-20 token voting subDAO to allocate a certain
amount of those tokens as claimable by the parent DAO token holders or signers.

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
function getClaimAmount(address claimer) external view returns (uint256)
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

