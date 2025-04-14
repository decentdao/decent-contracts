// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

import {ILockableV1} from "./interfaces/ILockableV1.sol";
import {IMintableV1} from "./interfaces/IMintableV1.sol";
import {VotesERC20} from "./VotesERC20.sol";
import {Version} from "./Version.sol";
import {ERC165Storage} from "@openzeppelin/contracts/utils/introspection/ERC165Storage.sol";

contract VotesERC20LockableV1 is ILockableV1, IMintableV1, VotesERC20, Version {
    uint16 private constant VERSION = 1;

    bool public locked;
    mapping(address => bool) public whitelisted;

    constructor() {
        _disableInitializers();
    }

    modifier isTransferable(address from) {
        if (
            locked &&
            // overrides while locked
            !(from == owner() || // owner can always transfer
                whitelisted[from] || // whitelisted addresses can always transfer
                from == address(0)) // can always mint when locked
        ) {
            revert IsLocked();
        }
        _;
    }

    /**
     * Initialize function, will be triggered when a new instance is deployed.
     *
     * @param initializeParams encoded initialization parameters: `address _owner`,
     * `bool _locked`, `string memory _name`, `string memory _symbol`,
     * `address[] memory _allocationAddresses`, `uint256[] memory _allocationAmounts`
     */
    function initialize(bytes memory initializeParams) public virtual {
        (
            address _owner, // token owner
            bool _locked, // whether the token is locked
            string memory _name, // token name
            string memory _symbol, // token symbol
            address[] memory _allocationAddresses, // addresses of initial allocations
            uint256[] memory _allocationAmounts // amounts of initial allocations
        ) = abi.decode(
                initializeParams,
                (address, bool, string, string, address[], uint256[])
            );
        super.setUp(
            abi.encode(_name, _symbol, _allocationAddresses, _allocationAmounts)
        );
        _transferOwnership(_owner);
        locked = _locked;
    }

    function lock(bool _locked) external onlyOwner {
        if (_locked == locked) {
            revert CannotSwitchLockState(_locked);
        }
        locked = _locked;
        emit Locked(_locked);
    }

    function whitelist(address account, bool isWhitelisted) external onlyOwner {
        bool currentlyWhitelisted = whitelisted[account];
        whitelisted[account] = isWhitelisted;
        if (currentlyWhitelisted != isWhitelisted) {
            emit Whitelisted(account, isWhitelisted);
        }
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override isTransferable(from) {
        super._beforeTokenTransfer(from, to, amount);
    }

    function getVersion() public view virtual override returns (uint16) {
        return VERSION;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(ERC165Storage, Version) returns (bool) {
        return
            interfaceId == type(ILockableV1).interfaceId ||
            interfaceId == type(IMintableV1).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
