// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity =0.8.19;

import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {LinearERC20VotingExtensible} from "./LinearERC20VotingExtensible.sol";
import {IHats} from "../interfaces/hats/IHats.sol";

/**
 * An [Azorius](./Azorius.md) [BaseStrategy](./BaseStrategy.md) implementation that
 * enables linear (i.e. 1 to 1) token voting, with proposal creation restricted to
 * users wearing whitelisted Hats.
 */
contract LinearERC20VotingWithHatsProposalCreation is
    LinearERC20VotingExtensible
{
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
     * @param initializeParams encoded initialization parameters: `address _owner`,
     * `address _governanceToken`, `address _azoriusModule`, `uint32 _votingPeriod`,
     * `uint256 _quorumNumerator`, `uint256 _basisNumerator`, `address _hatsContract`,
     * `uint256[] _initialWhitelistedHats`
     */
    function setUp(bytes memory initializeParams) public override {
        (
            address _owner,
            address _governanceToken,
            address _azoriusModule,
            uint32 _votingPeriod,
            uint256 _quorumNumerator,
            uint256 _basisNumerator,
            address _hatsContract,
            uint256[] memory _initialWhitelistedHats
        ) = abi.decode(
                initializeParams,
                (
                    address,
                    address,
                    address,
                    uint32,
                    uint256,
                    uint256,
                    address,
                    uint256[]
                )
            );

        super.setUp(
            abi.encode(
                _owner,
                _governanceToken,
                _azoriusModule,
                _votingPeriod,
                0, // requiredProposerWeight is zero because we only care about the hat check
                _quorumNumerator,
                _basisNumerator
            )
        );

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

    /** @inheritdoc LinearERC20VotingExtensible*/
    function isProposer(address _address) public view override returns (bool) {
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
