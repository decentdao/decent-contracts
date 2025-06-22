// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IUUPSUpgradeableExtended} from "./interfaces/decent/IUUPSUpgradeableExtended.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";

/**
 * @title UUPSUpgradeableExtended
 * @author Decent Labs
 * @notice Abstract contract extending UUPS upgradeable pattern with implementation address getter
 * @dev This contract extends OpenZeppelin's UUPSUpgradeable to provide additional functionality
 * for retrieving the current implementation address. This is useful for verification and
 * debugging purposes.
 *
 * Key features:
 * - Inherits all UUPS upgrade functionality from OpenZeppelin
 * - Exposes the current implementation address via a public view function
 * - Must be inherited by concrete implementations that define _authorizeUpgrade
 *
 * @custom:security-contact security@decentlabs.io
 */
abstract contract UUPSUpgradeableExtended is
    UUPSUpgradeable,
    IUUPSUpgradeableExtended
{
    /**
     * @inheritdoc IUUPSUpgradeableExtended
     * @dev Uses ERC1967Utils to read the implementation slot defined in EIP-1967
     */
    function implementation() public view returns (address) {
        return ERC1967Utils.getImplementation();
    }
}
