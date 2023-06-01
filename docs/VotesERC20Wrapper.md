# Solidity API

## VotesERC20Wrapper

An extension of `VotesERC20` which supports wrapping / unwrapping an existing ERC20 token,
to allow for importing an existing token into the Azorius governance framework.

### constructor

```solidity
constructor() public
```

### setUp

```solidity
function setUp(bytes initializeParams) public
```

Initialize function, will be triggered when a new instance is deployed.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| initializeParams | bytes | encoded initialization parameters: `address _underlyingTokenAddress` |

### _mint

```solidity
function _mint(address to, uint256 amount) internal virtual
```

Overridden without modification.

### _burn

```solidity
function _burn(address account, uint256 amount) internal virtual
```

Overridden without modification.

### _beforeTokenTransfer

```solidity
function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual
```

Overridden without modification.

### _afterTokenTransfer

```solidity
function _afterTokenTransfer(address from, address to, uint256 amount) internal virtual
```

Overridden without modification.

### decimals

```solidity
function decimals() public view virtual returns (uint8)
```

Overridden without modification.

