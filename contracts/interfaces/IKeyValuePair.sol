//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

/**
 * A utility contract to log key/value pair events for the calling address.
 */
interface IKeyValuePair {

    event ValueUpdated(address indexed theAddress, string key, string value);

    /**
     * Logs the given key/value pair, along with the caller's address.
     *
     * @param _key the key
     * @param _value the value
     */
    function updateValue(string memory _key, string memory _value) external;
}
