// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

import {IHats} from "./hats/IHats.sol";

/**
 * @title IHatsProposalCreationWhitelistV1
 * @dev Interface for HatsProposalCreationWhitelistV1 contract that manages proposal creation permissions
 * based on Hats Protocol.
 */
interface IHatsProposalCreationWhitelistV1 {
    /**
     * @dev Emitted when a Hat is added to the whitelist.
     */
    event HatWhitelisted(uint256 hatId);

    /**
     * @dev Emitted when a Hat is removed from the whitelist.
     */
    event HatRemovedFromWhitelist(uint256 hatId);

    /**
     * @dev Error thrown when the Hats contract address is invalid.
     */
    error InvalidHatsContract();

    /**
     * @dev Error thrown when no Hats are whitelisted.
     */
    error NoHatsWhitelisted();

    /**
     * @dev Error thrown when attempting to whitelist a Hat that is already whitelisted.
     */
    error HatAlreadyWhitelisted();

    /**
     * @dev Error thrown when attempting to remove a Hat that is not whitelisted.
     */
    error HatNotWhitelisted();

    /**
     * @dev Returns the Hats contract.
     * @return The Hats contract interface.
     */
    function hatsContract() external view returns (IHats);

    /**
     * @dev Adds a Hat to the whitelist for proposal creation.
     * @param _hatId The ID of the Hat to whitelist
     */
    function whitelistHat(uint256 _hatId) external;

    /**
     * @dev Removes a Hat from the whitelist for proposal creation.
     * @param _hatId The ID of the Hat to remove from the whitelist
     */
    function removeHatFromWhitelist(uint256 _hatId) external;

    /**
     * @dev Checks if an address is authorized to create proposals.
     * @param _address The address to check for proposal creation authorization.
     * @return Returns true if the address is wearing any of the whitelisted Hats, false otherwise.
     */
    function isProposer(address _address) external view returns (bool);

    /**
     * @dev Returns the IDs of all whitelisted Hats.
     * @return An array of whitelisted Hat IDs.
     */
    function getWhitelistedHatIds() external view returns (uint256[] memory);
}
