//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Storage.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Snapshot.sol";

contract VotesToken is IERC20, ERC20Snapshot, ERC20Votes, ERC165Storage {
    constructor(
        string memory _name,
        string memory _symbol,
        address[] memory _hodlers,
        uint256[] memory _allocations
    ) ERC20(_name, _symbol) ERC20Permit(_name) {
        _registerInterface(type(IERC20).interfaceId);
        for (uint256 i = 0; i < _hodlers.length; i++) {
            _mint(_hodlers[i], _allocations[i]);
        }

    }

    function captureSnapShot() external returns (uint256 snapId) {
        snapId = _snapshot();
    }

    // The functions below are overrides required by Solidity.
    function _mint(address to, uint256 amount)
        internal
        virtual
        override(ERC20, ERC20Votes)
    {
        super._mint(to, amount);
    }

    function _burn(address account, uint256 amount)
        internal
        virtual
        override(ERC20, ERC20Votes)
    {
        super._burn(account, amount);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20, ERC20Snapshot) {
        super._beforeTokenTransfer(from, to, amount);
    }

    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20, ERC20Votes) {
        super._afterTokenTransfer(from, to, amount);
    }
}
