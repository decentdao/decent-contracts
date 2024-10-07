// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IHats} from "../interfaces/hats/IHats.sol";

abstract contract HatsProposalCreationWhitelist is OwnableUpgradeable {
    event HatWhitelisted(uint256 hatId);
    event HatRemovedFromWhitelist(uint256 hatId);

    IHats public hatsContract;

    /** Array to store whitelisted Hat IDs. */
    uint256[] public whitelistedHatIds;

    error InvalidHatsContract();
    error NoHatsWhitelisted();
    error HatAlreadyWhitelisted();
    error HatNotWhitelisted();

    /**
     * Sets up the contract with its initial parameters.
     *
     * @param initializeParams encoded initialization parameters:
     * `address _hatsContract`, `uint256[] _initialWhitelistedHats`
     */
    function setUp(bytes memory initializeParams) public virtual {
        (address _hatsContract, uint256[] memory _initialWhitelistedHats) = abi
            .decode(initializeParams, (address, uint256[]));

        if (_hatsContract == address(0)) revert InvalidHatsContract();
        hatsContract = IHats(_hatsContract);

        if (_initialWhitelistedHats.length == 0) revert NoHatsWhitelisted();
        for (uint256 i = 0; i < _initialWhitelistedHats.length; i++) {
            _whitelistHat(_initialWhitelistedHats[i]);
        }
    }

    /**
     * Adds a Hat to the whitelist for proposal creation.
     * @param _hatId The ID of the Hat to whitelist
     */
    function whitelistHat(uint256 _hatId) external onlyOwner {
        _whitelistHat(_hatId);
    }

    /**
     * Internal function to add a Hat to the whitelist.
     * @param _hatId The ID of the Hat to whitelist
     */
    function _whitelistHat(uint256 _hatId) internal {
        for (uint256 i = 0; i < whitelistedHatIds.length; i++) {
            if (whitelistedHatIds[i] == _hatId) revert HatAlreadyWhitelisted();
        }
        whitelistedHatIds.push(_hatId);
        emit HatWhitelisted(_hatId);
    }

    /**
     * Removes a Hat from the whitelist for proposal creation.
     * @param _hatId The ID of the Hat to remove from the whitelist
     */
    function removeHatFromWhitelist(uint256 _hatId) external onlyOwner {
        bool found = false;
        for (uint256 i = 0; i < whitelistedHatIds.length; i++) {
            if (whitelistedHatIds[i] == _hatId) {
                whitelistedHatIds[i] = whitelistedHatIds[
                    whitelistedHatIds.length - 1
                ];
                whitelistedHatIds.pop();
                found = true;
                break;
            }
        }
        if (!found) revert HatNotWhitelisted();

        emit HatRemovedFromWhitelist(_hatId);
    }

    /**
     * @dev Checks if an address is authorized to create proposals.
     * @param _address The address to check for proposal creation authorization.
     * @return bool Returns true if the address is wearing any of the whitelisted Hats, false otherwise.
     * @notice This function overrides the isProposer function from the parent contract.
     * It iterates through all whitelisted Hat IDs and checks if the given address
     * is wearing any of them using the Hats Protocol.
     */
    function isProposer(address _address) public view virtual returns (bool) {
        for (uint256 i = 0; i < whitelistedHatIds.length; i++) {
            if (hatsContract.isWearerOfHat(_address, whitelistedHatIds[i])) {
                return true;
            }
        }
        return false;
    }

    /**
     * Returns the number of whitelisted hats.
     * @return The number of whitelisted hats
     */
    function getWhitelistedHatsCount() public view returns (uint256) {
        return whitelistedHatIds.length;
    }

    /**
     * Checks if a hat is whitelisted.
     * @param _hatId The ID of the Hat to check
     * @return True if the hat is whitelisted, false otherwise
     */
    function isHatWhitelisted(uint256 _hatId) public view returns (bool) {
        for (uint256 i = 0; i < whitelistedHatIds.length; i++) {
            if (whitelistedHatIds[i] == _hatId) {
                return true;
            }
        }
        return false;
    }
}
