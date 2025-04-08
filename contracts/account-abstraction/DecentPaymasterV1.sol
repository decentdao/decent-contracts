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

    error InvalidSmartAccount();
    error UnauthorizedFunction();
    error InvalidCallDataLength();

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
        if (!verifySmartAccount(userOp.sender)) {
            revert InvalidSmartAccount();
        }

        // If we're here, we've confirmed that the sender is an actual instance of a LightAccount,
        // and so therefore its "execute" function behaves as expected.
        //
        // This prevents a potential exploit where a user crafts a malicious UserOp
        // which targets a contract that is expected to be a LightAccount, but is not,
        // and allows the implementation of that contract's "execute" function to perform
        // any arbitrary logic (aka logic which does not execute the whitelisted function
        // encoded in the UserOp).

        bytes calldata callData = userOp.callData;
        // Verify we have at least 4 bytes for the selector
        if (callData.length < 4) {
            revert InvalidCallDataLength();
        }

        // Extract and verify the LightAccount's "execute" function selector
        // 0xb61d27f6 = bytes4(keccak256("execute(address,uint256,bytes)"))
        if (bytes4(callData) != 0xb61d27f6) {
            revert UnauthorizedFunction();
        }

        // Decode the "execute" function parameters
        (address target, , bytes memory innerCallData) = abi.decode(
            callData[4:],
            (address, uint256, bytes)
        );

        // Extract the actual function selector from the innerCallData
        if (innerCallData.length < 4) {
            revert InvalidCallDataLength();
        }
        bytes4 selector = bytes4(innerCallData);

        // Verify the function is whitelistd for this target
        if (!isFunctionWhitelisted(target, selector)) {
            revert UnauthorizedFunction();
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
