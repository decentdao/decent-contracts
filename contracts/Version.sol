// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

import {IVersion} from "./interfaces/IVersion.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/**
 * @title Version
 * @dev Abstract contract providing standardized contract identification
 *
 * Inheriting contracts MUST implement:
 * - getVersion()
 */
abstract contract Version is IVersion, ERC165 {
    /**
     * @dev Returns the version number of this contract implementation
     * Inheriting contracts MUST override this function.
     */
    function getVersion() public view virtual returns (uint16);

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override returns (bool) {
        return
            interfaceId == type(IVersion).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
