# Solidity API

## VotesERC20

An implementation of the Open Zeppelin `IVotes` voting token standard.

### constructor

```solidity
constructor() public
```

### setUp

```solidity
function setUp(bytes initializeParams) public virtual
```

Initialize function, will be triggered when a new instance is deployed.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| initializeParams | bytes | encoded initialization parameters: `string memory _name`, `string memory _symbol`, `address[] memory _allocationAddresses`,  `uint256[] memory _allocationAmounts` |

### captureSnapShot

```solidity
function captureSnapShot() external returns (uint256 snapId)
```

See `ERC20SnapshotUpgradeable._snapshot()`.

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

