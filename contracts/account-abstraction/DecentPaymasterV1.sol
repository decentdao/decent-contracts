// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

import {IDecentPaymasterV1} from "../interfaces/account-abstraction/IDecentPaymasterV1.sol";
import {BasePaymasterV1} from "./BasePaymasterV1.sol";
import {SmartAccountVerificationV1} from "./SmartAccountVerificationV1.sol";
import {Version} from "../Version.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation, IPaymaster} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract DecentPaymasterV1 is
    IDecentPaymasterV1,
    Version,
    BasePaymasterV1,
    SmartAccountVerificationV1
{
    uint16 private constant VERSION = 1;

    // Mapping: contract address => function selector => is whitelisted
    mapping(address => mapping(bytes4 => bool)) private _whitelistedFunctions;

    event FunctionWhitelisted(address contractAddress, bytes4 selector);
    event FunctionUnwhitelisted(address contractAddress, bytes4 selector);

    error NotWhitelistedFunction(address target, bytes4 selector);

    constructor() {
        _disableInitializers();
    }

    /**
     * Initialize function for the proxy deployment. This standardizes the initialization
     * to better work with ProxyFactory.
     *
     * @param data The data to initialize the contract with
     * @dev The data is encoded as (address, address, address)
     */
    function initialize(bytes calldata data) public initializer {
        (
            address _owner,
            address _entryPoint,
            address _lightAccountFactory
        ) = abi.decode(data, (address, address, address));
        __BasePaymasterV1_init(_owner, IEntryPoint(_entryPoint));
        __SmartAccountVerificationV1_init(_lightAccountFactory);
    }

    /**
     * Add whitelisted function for contract
     * @param contractAddress The contract address that will be whitelisted
     * @param selector Function selector to whitelist
     */
    function whitelistFunction(
        address contractAddress,
        bytes4 selector
    ) external onlyOwner {
        _whitelistedFunctions[contractAddress][selector] = true;
        emit FunctionWhitelisted(contractAddress, selector);
    }

    /**
     * Remove whitelisted function for contract
     * @param contractAddress The contract address that will be unwhitelisted
     * @param selector Function selector to unwhitelist
     */
    function unwhitelistFunction(
        address contractAddress,
        bytes4 selector
    ) external onlyOwner {
        _whitelistedFunctions[contractAddress][selector] = false;
        emit FunctionUnwhitelisted(contractAddress, selector);
    }

    /**
     * Check if a contract has a whitelisted function
     * @param contractAddress The contract address
     * @param selector The function selector to check
     * @return bool Whether the function is whitelisted
     */
    function isFunctionWhitelisted(
        address contractAddress,
        bytes4 selector
    ) public view returns (bool) {
        return _whitelistedFunctions[contractAddress][selector];
    }

    /// @inheritdoc BasePaymasterV1
    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32,
        uint256
    )
        internal
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        (address target, bytes4 selector) = verifyUserOp(userOp);

        // Verify the function is whitelistd for this target
        if (!isFunctionWhitelisted(target, selector)) {
            revert NotWhitelistedFunction(target, selector);
        }

        return (abi.encode(), 0);
    }

    /// @inheritdoc Version
    function getVersion() public view virtual override returns (uint16) {
        return VERSION;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override returns (bool) {
        return
            interfaceId == type(IDecentPaymasterV1).interfaceId ||
            interfaceId == type(IPaymaster).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
