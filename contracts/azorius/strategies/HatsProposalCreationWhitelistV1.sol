// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

import {IHatsProposalCreationWhitelistV1} from "../../interfaces/IHatsProposalCreationWhitelistV1.sol";
import {IHats} from "../../interfaces/hats/IHats.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

abstract contract HatsProposalCreationWhitelistV1 is
    IHatsProposalCreationWhitelistV1,
    OwnableUpgradeable,
    ERC165
{
    IHats public hatsContract;

    /** Array to store whitelisted Hat IDs. */
    uint256[] private whitelistedHatIds;

    constructor() {
        _disableInitializers();
    }

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
     * @dev Returns the IDs of all whitelisted Hats.
     * @return uint256[] memory An array of whitelisted Hat IDs.
     */
    function getWhitelistedHatIds() public view returns (uint256[] memory) {
        return whitelistedHatIds;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override returns (bool) {
        return
            interfaceId == type(IHatsProposalCreationWhitelistV1).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
