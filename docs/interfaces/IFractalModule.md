# Solidity API

## IFractalModule

A specification for a Safe module contract that allows for a "parent-child"
DAO relationship.

Adding the module should allow for a designated set of addresses to execute
transactions on the Safe, which in our implementation is the set of parent
DAOs.

### execTx

```solidity
function execTx(bytes execTxData) external
```

Allows an authorized address to execute arbitrary transactions on the Safe.

#### Parameters

| Name       | Type  | Description                        |
| ---------- | ----- | ---------------------------------- |
| execTxData | bytes | data of the transaction to execute |

### addControllers

```solidity
function addControllers(address[] _controllers) external
```

Adds `_controllers` to the list of controllers, which are allowed
to execute transactions on the Safe.

#### Parameters

| Name          | Type      | Description                            |
| ------------- | --------- | -------------------------------------- |
| \_controllers | address[] | addresses to add to the contoller list |

### removeControllers

```solidity
function removeControllers(address[] _controllers) external
```

Removes `_controllers` from the list of controllers.

#### Parameters

| Name          | Type      | Description                                  |
| ------------- | --------- | -------------------------------------------- |
| \_controllers | address[] | addresses to remove from the controller list |
