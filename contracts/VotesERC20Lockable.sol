//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import {VotesERC20} from "./VotesERC20.sol";

/**
 * An implementation of the Open Zeppelin `IVotes` voting token standard.
 */
contract VotesERC20Lockable is VotesERC20 {
    bool public locked;
    mapping(address => bool) public whitelisted;

    event Locked(bool locked);
    event Whitelisted(address indexed account, bool isWhitelisted);

    constructor() {
        _disableInitializers();
    }

    /**
     * Initialize function, will be triggered when a new instance is deployed.
     *
     * @param initializeParams encoded initialization parameters: `address _owner`,
     * `bool _locked`, `string memory _name`, `string memory _symbol`,
     * `address[] memory _allocationAddresses`, `uint256[] memory _allocationAmounts`
     */
    function setUp(bytes memory initializeParams) public virtual override {
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
        if (_locked) {
            require(!locked, "Token is already locked");
        } else {
            require(locked, "Token is not locked");
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

    modifier isTransferable(address from) {
        require(
            !locked || from == owner() || whitelisted[from],
            "Token is locked"
        );
        _;
    }

    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override isTransferable(from) {
        super._transfer(from, to, amount);
    }
}
