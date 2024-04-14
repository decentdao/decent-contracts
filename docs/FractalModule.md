# Solidity API

## FractalModule

Implementation of [IFractalModule](./interfaces/IFractalModule.md).

A Safe module contract that allows for a "parent-child" DAO relationship.

Adding the module allows for a designated set of addresses to execute
transactions on the Safe, which in our implementation is the set of parent
DAOs.

### controllers

```solidity
mapping(address => bool) controllers
```

Mapping of whether an address is a controller (typically a parentDAO).

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

Allows only authorized controllers to execute transactions on the Safe.

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

| Name             | Type  | Description                                                                                                                |
| ---------------- | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| initializeParams | bytes | encoded initialization parameters: `address _owner`, `address _avatar`, `address _target`, `address[] memory _controllers` |

### removeControllers

```solidity
function removeControllers(address[] _controllers) external
```

Removes `_controllers` from the list of controllers.

#### Parameters

| Name          | Type      | Description                                  |
| ------------- | --------- | -------------------------------------------- |
| \_controllers | address[] | addresses to remove from the controller list |

### execTx

```solidity
function execTx(bytes execTxData) public
```

Allows an authorized address to execute arbitrary transactions on the Safe.

#### Parameters

| Name       | Type  | Description                        |
| ---------- | ----- | ---------------------------------- |
| execTxData | bytes | data of the transaction to execute |

### addControllers

```solidity
function addControllers(address[] _controllers) public
```

Adds `_controllers` to the list of controllers, which are allowed
to execute transactions on the Safe.

#### Parameters

| Name          | Type      | Description                            |
| ------------- | --------- | -------------------------------------- |
| \_controllers | address[] | addresses to add to the contoller list |
