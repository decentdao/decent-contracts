# Solidity API

## IERC721VotingStrategy

Interface of functions required for ERC-721 freeze voting associated with an ERC-721
voting strategy.

### getTokenWeight

```solidity
function getTokenWeight(address _tokenAddress) external view returns (uint256)
```

Returns the current token weight for the given ERC-721 token address.

#### Parameters

| Name           | Type    | Description               |
| -------------- | ------- | ------------------------- |
| \_tokenAddress | address | the ERC-721 token address |
