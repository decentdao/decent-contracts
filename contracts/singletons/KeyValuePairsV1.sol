// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IKeyValuePairsV1} from "../interfaces/decent/singletons/IKeyValuePairsV1.sol";
import {IVersion} from "../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlockV1} from "../interfaces/decent/IDeploymentBlockV1.sol";
import {DeploymentBlockV1NonUpgradeable} from "../DeploymentBlockV1NonUpgradeable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract KeyValuePairsV1 is
    IKeyValuePairsV1,
    IVersion,
    DeploymentBlockV1NonUpgradeable,
    ERC165
{
    // ======================================================================
    // IKeyValuePairs
    // ======================================================================

    // --- State-Changing Functions ---

    function updateValues(
        KeyValuePair[] calldata keyValuePairs_
    ) public virtual override {
        for (uint256 i; i < keyValuePairs_.length; ) {
            KeyValuePair memory keyValuePair = keyValuePairs_[i];

            emit ValueUpdated(msg.sender, keyValuePair.key, keyValuePair.value);

            unchecked {
                ++i;
            }
        }
    }

    // ======================================================================
    // IVersion
    // ======================================================================

    // --- View Functions ---

    function version() public pure virtual override returns (uint16) {
        return 1;
    }

    // ======================================================================
    // ERC165
    // ======================================================================

    // --- View Functions ---

    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IKeyValuePairsV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
