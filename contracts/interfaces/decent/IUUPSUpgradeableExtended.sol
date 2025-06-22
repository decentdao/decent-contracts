// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

/**
 * @title IUUPSUpgradeableExtended
 * @author Decent Labs
 * @notice Interface for UUPS upgradeable contracts with implementation address getter
 * @dev This interface extends the standard UUPS pattern by exposing the implementation
 * address, which is useful for verification, monitoring, and debugging purposes.
 *
 * @custom:security-contact security@decentlabs.io
 */
interface IUUPSUpgradeableExtended {
    /**
     * @notice Returns the current implementation address of the proxy
     * @dev This function allows external contracts and tools to query which implementation
     * a proxy is currently pointing to
     * @return implementation The address of the current implementation contract
     */
    function implementation() external view returns (address implementation);
}
