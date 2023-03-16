//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "@gnosis.pm/zodiac/contracts/factory/FactoryFriendly.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Storage.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20SnapshotUpgradeable.sol";

contract VotesToken is
    IERC20Upgradeable,
    ERC20SnapshotUpgradeable,
    ERC20VotesUpgradeable,
    ERC165Storage,
    FactoryFriendly
{
    /// @notice Initialize function, will be triggered when a new proxy is deployed
    /// @param initializeParams Parameters of initialization encoded
    function setUp(bytes memory initializeParams) public override initializer {
        (
            string memory _name,
            string memory _symbol,
            address[] memory _hodlers,
            uint256[] memory _allocations // Address(0) == msg.sender
        ) = abi.decode(
                initializeParams,
                (string, string, address[], uint256[])
            );

        __ERC20_init(_name, _symbol);
        __ERC20Permit_init(_name);
        _registerInterface(type(IERC20Upgradeable).interfaceId);

        uint256 hodlersLength = _hodlers.length;
        for (uint256 i; i < hodlersLength; ) {
            _mint(_hodlers[i], _allocations[i]);
            unchecked {
                ++i;
            }
        }
    }

    function captureSnapShot() external returns (uint256 snapId) {
        snapId = _snapshot();
    }

    // The functions below are overrides required by Solidity.
    function _mint(
        address to,
        uint256 amount
    ) internal virtual override(ERC20Upgradeable, ERC20VotesUpgradeable) {
        super._mint(to, amount);
    }

    function _burn(
        address account,
        uint256 amount
    ) internal virtual override(ERC20Upgradeable, ERC20VotesUpgradeable) {
        super._burn(account, amount);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20Upgradeable, ERC20SnapshotUpgradeable) {
        super._beforeTokenTransfer(from, to, amount);
    }

    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20Upgradeable, ERC20VotesUpgradeable) {
        super._afterTokenTransfer(from, to, amount);
    }
}
