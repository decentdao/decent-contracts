//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import { ERC20VotesUpgradeable, ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import { ERC20WrapperUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20WrapperUpgradeable.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { VotesERC20 } from "./VotesERC20.sol";

/**
 * TODO
 */
contract VotesERC20Wrapper is VotesERC20, ERC20WrapperUpgradeable {

    /**
     * Initialize function, will be triggered when a new instance is deployed.
     *
     * @param initializeParams encoded initialization parameters: `address _underlyingTokenAddress`
     */
    function setUp(bytes memory initializeParams) public override initializer {
        (address _underlyingTokenAddress) = abi.decode(initializeParams, (address));

        // not necessarily upgradeable, but required to pass into __ERC20Wrapper_init
        ERC20Upgradeable token = ERC20Upgradeable(_underlyingTokenAddress);

        __ERC20Wrapper_init(token);

        address[] memory emptyAddresses; // TODO can I not do this?
        uint256[] memory emptyAllocations;

        super.setUp(
            abi.encode(string.concat("Wrapped ", token.name()), string.concat("W", token.symbol()), emptyAddresses, emptyAllocations)
        );
    }

    // -- The functions below are overrides required by extended contracts. --

    /** Overridden without modification. */
    function _mint(
        address to,
        uint256 amount
    ) internal virtual override(ERC20Upgradeable, VotesERC20) { // TODO which of these is called?
        super._mint(to, amount);
    }

    /** Overridden without modification. */
    function _burn(
        address account,
        uint256 amount
    ) internal virtual override(ERC20Upgradeable, VotesERC20) {
        super._burn(account, amount);
    }

    /** Overridden without modification. */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20Upgradeable, VotesERC20) {
        super._beforeTokenTransfer(from, to, amount);
    }

    /** Overridden without modification. */
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20Upgradeable, VotesERC20) {
        super._afterTokenTransfer(from, to, amount);
    }

    /** Overridden without modification. */
    function decimals() public view virtual override(ERC20Upgradeable, ERC20WrapperUpgradeable) returns (uint8) {
        return super.decimals();
    }
}
