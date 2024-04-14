# Solidity API

## ISafe

The specification of methods available on a Safe contract wallet.

This interface does not encompass every available function on a Safe,
only those which are used within the Azorius contracts.

For the complete set of functions available on a Safe, see:
https://github.com/safe-global/safe-contracts/blob/main/contracts/Safe.sol

### nonce

```solidity
function nonce() external view returns (uint256)
```

Returns the current transaction nonce of the Safe.
Each transaction should has a different nonce to prevent replay attacks.

#### Return Values

| Name | Type    | Description                       |
| ---- | ------- | --------------------------------- |
| [0]  | uint256 | uint256 current transaction nonce |

### setGuard

```solidity
function setGuard(address _guard) external
```

Set a guard contract that checks transactions before execution.
This can only be done via a Safe transaction.

See https://docs.gnosis-safe.io/learn/safe-tools/guards.
See https://github.com/safe-global/safe-contracts/blob/main/contracts/base/GuardManager.sol.

#### Parameters

| Name    | Type    | Description                                                         |
| ------- | ------- | ------------------------------------------------------------------- |
| \_guard | address | address of the guard to be used or the 0 address to disable a guard |

### execTransaction

```solidity
function execTransaction(address _to, uint256 _value, bytes _data, enum Enum.Operation _operation, uint256 _safeTxGas, uint256 _baseGas, uint256 _gasPrice, address _gasToken, address payable _refundReceiver, bytes _signatures) external payable returns (bool success)
```

Executes an arbitrary transaction on the Safe.

#### Parameters

| Name             | Type                | Description                                                 |
| ---------------- | ------------------- | ----------------------------------------------------------- |
| \_to             | address             | destination address                                         |
| \_value          | uint256             | ETH value                                                   |
| \_data           | bytes               | data payload                                                |
| \_operation      | enum Enum.Operation | Operation type, Call or DelegateCall                        |
| \_safeTxGas      | uint256             | gas that should be used for the safe transaction            |
| \_baseGas        | uint256             | gas costs that are independent of the transaction execution |
| \_gasPrice       | uint256             | max gas price that should be used for this transaction      |
| \_gasToken       | address             | token address (or 0 if ETH) that is used for the payment    |
| \_refundReceiver | address payable     | address of the receiver of gas payment (or 0 if tx.origin)  |
| \_signatures     | bytes               | packed signature data                                       |

#### Return Values

| Name    | Type | Description                                        |
| ------- | ---- | -------------------------------------------------- |
| success | bool | bool whether the transaction was successful or not |

### checkSignatures

```solidity
function checkSignatures(bytes32 _dataHash, bytes _data, bytes _signatures) external view
```

Checks whether the signature provided is valid for the provided data and hash. Reverts otherwise.

#### Parameters

| Name         | Type    | Description                                                                                                                                              |
| ------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| \_dataHash   | bytes32 | Hash of the data (could be either a message hash or transaction hash)                                                                                    |
| \_data       | bytes   | That should be signed (this is passed to an external validator contract)                                                                                 |
| \_signatures | bytes   | Signature data that should be verified. Can be packed ECDSA signature ({bytes32 r}{bytes32 s}{uint8 v}), contract signature (EIP-1271) or approved hash. |

### encodeTransactionData

```solidity
function encodeTransactionData(address _to, uint256 _value, bytes _data, enum Enum.Operation _operation, uint256 _safeTxGas, uint256 _baseGas, uint256 _gasPrice, address _gasToken, address _refundReceiver, uint256 _nonce) external view returns (bytes)
```

Returns the pre-image of the transaction hash.

#### Parameters

| Name             | Type                | Description                                                 |
| ---------------- | ------------------- | ----------------------------------------------------------- |
| \_to             | address             | destination address                                         |
| \_value          | uint256             | ETH value                                                   |
| \_data           | bytes               | data payload                                                |
| \_operation      | enum Enum.Operation | Operation type, Call or DelegateCall                        |
| \_safeTxGas      | uint256             | gas that should be used for the safe transaction            |
| \_baseGas        | uint256             | gas costs that are independent of the transaction execution |
| \_gasPrice       | uint256             | max gas price that should be used for this transaction      |
| \_gasToken       | address             | token address (or 0 if ETH) that is used for the payment    |
| \_refundReceiver | address             | address of the receiver of gas payment (or 0 if tx.origin)  |
| \_nonce          | uint256             | transaction nonce                                           |

#### Return Values

| Name | Type  | Description      |
| ---- | ----- | ---------------- |
| [0]  | bytes | bytes hash bytes |

### isOwner

```solidity
function isOwner(address _owner) external view returns (bool)
```

Returns if the given address is an owner of the Safe.

See https://github.com/safe-global/safe-contracts/blob/main/contracts/base/OwnerManager.sol.

#### Parameters

| Name    | Type    | Description          |
| ------- | ------- | -------------------- |
| \_owner | address | the address to check |

#### Return Values

| Name | Type | Description                                  |
| ---- | ---- | -------------------------------------------- |
| [0]  | bool | bool whether \_owner is an owner of the Safe |
