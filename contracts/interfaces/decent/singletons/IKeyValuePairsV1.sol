// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

interface IKeyValuePairsV1 {
    // --- Structs ---

    struct KeyValuePair {
        string key;
        string value;
    }

    // --- Events ---

    event ValueUpdated(address indexed sender, string key, string value);

    // --- State-Changing Functions ---

    function updateValues(KeyValuePair[] memory keyValuePairs_) external;
}
