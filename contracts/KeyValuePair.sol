//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "./interfaces/IKeyValuePair.sol";

/**
 * A simple contract to log key/value pair events for the calling address.
 */
contract KeyValuePair is IKeyValuePair {

    /** @inheritdoc IKeyValuePair*/
    function updateValue(string memory _key, string memory _value) external {
        emit ValueUpdated(msg.sender, _key, _value);
    }
}
