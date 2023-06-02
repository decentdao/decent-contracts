# Solidity API

## KeyValuePairs

Implementation of [IKeyValuePairs](./interfaces/IKeyValuePairs.md), a utility 
contract to log key / value pair events for the calling address.

### ValueUpdated

```solidity
event ValueUpdated(address theAddress, string key, string value)
```

### IncorrectValueCount

```solidity
error IncorrectValueCount()
```

### updateValues

```solidity
function updateValues(string[] _keys, string[] _values) external
```

Logs the given key / value pairs, along with the caller's address.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _keys | string[] | the keys |
| _values | string[] | the values |

