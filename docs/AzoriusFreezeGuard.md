# Solidity API

## AzoriusFreezeGuard

A Safe Transaction Guard contract that prevents an [Azorius](./azorius/Azorius.md)
subDAO from executing transactions if it has been frozen by its parentDAO.

See https://docs.safe.global/learn/safe-core/safe-core-protocol/guards.

### freezeVoting

```solidity
contract IBaseFreezeVoting freezeVoting
```

A reference to the freeze voting contract, which manages the freeze
voting process and maintains the frozen / unfrozen state of the DAO.

### AzoriusFreezeGuardSetUp

```solidity
event AzoriusFreezeGuardSetUp(address creator, address owner, address freezeVoting)
```

### DAOFrozen

```solidity
error DAOFrozen()
```

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

| Name             | Type  | Description                                                                  |
| ---------------- | ----- | ---------------------------------------------------------------------------- |
| initializeParams | bytes | encoded initialization parameters: `address _owner`, `address _freezeVoting` |

### checkTransaction

```solidity
function checkTransaction(address, uint256, bytes, enum Enum.Operation, uint256, uint256, uint256, address, address payable, bytes, address) external view
```

This function is called by the Safe to check if the transaction
is able to be executed and reverts if the guard conditions are
not met.

In our implementation, this reverts if the DAO is frozen.

### checkAfterExecution

```solidity
function checkAfterExecution(bytes32, bool) external view
```

A callback performed after a transaction is executed on the Safe. This is a required
function of the `BaseGuard` and `IGuard` interfaces that we do not make use of.
