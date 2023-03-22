# Solidity API

## IFractalRegistry

A utility contract which logs events pertaining to Fractal DAO metadata.

### updateDAOName

```solidity
function updateDAOName(string _name) external
```

Updates a DAO's registered "name". This is a simple string
with no restrictions or validation for uniqueness.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _name | string | new DAO name |

### declareSubDAO

```solidity
function declareSubDAO(address _subDAOAddress) external
```

Declares an address as a subDAO of the caller's address.

This declaration has no binding logic, and serves only
to allow us to find the list of "potential" subDAOs of any 
given Safe address.

Given the list of declaring events, we can then check each
Safe still has a FractalModule attached.

If no FractalModule is attached, we'll exclude it from the
DAO hierarchy.

In the case of a Safe attaching a FractalModule without calling 
to declare it, we will unfortunately not display it as a subDAO.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _subDAOAddress | address | address of the subDAO to declare       as a subDAO of the caller |

