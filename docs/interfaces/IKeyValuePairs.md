# Solidity API

## IKeyValuePairs

A utility contract to log key / value pair events for the calling address.

### updateValues

```solidity
function updateValues(string[] _keys, string[] _values) external
```

Logs the given key / value pairs, along with the caller's address.

#### Parameters

| Name     | Type     | Description |
| -------- | -------- | ----------- |
| \_keys   | string[] | the keys    |
| \_values | string[] | the values  |
