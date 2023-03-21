# Solidity API

## FractalModule

### controllers

```solidity
mapping(address => bool) controllers
```

### ControllersAdded

```solidity
event ControllersAdded(address[] controllers)
```

### ControllersRemoved

```solidity
event ControllersRemoved(address[] controllers)
```

### Unauthorized

```solidity
error Unauthorized()
```

### TxFailed

```solidity
error TxFailed()
```

### onlyAuthorized

```solidity
modifier onlyAuthorized()
```

_Throws if called by any account other than the owner._

### setUp

```solidity
function setUp(bytes initializeParams) public
```

_Initialize function_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| initializeParams | bytes | Parameters of initialization encoded |

### execTx

```solidity
function execTx(bytes execTxData) public
```

Allows an authorized user to exec a Gnosis Safe tx via the module

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| execTxData | bytes | Data payload of module transaction. |

### addControllers

```solidity
function addControllers(address[] _controllers) public
```

Allows the module owner to add users which may exectxs

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _controllers | address[] | Addresses added to the contoller list |

### removeControllers

```solidity
function removeControllers(address[] _controllers) external
```

Allows the module owner to remove users which may exectxs

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _controllers | address[] | Addresses removed to the contoller list |

