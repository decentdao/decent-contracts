// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

import {BasePaymasterV1, IEntryPoint} from "./BasePaymasterV1.sol";
import {IDecentPaymasterV1} from "../interfaces/account-abstraction/IDecentPaymasterV1.sol";
import {Version} from "../Version.sol";
import {PackedUserOperation, IPaymaster} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract DecentPaymasterV1 is
    IDecentPaymasterV1,
    Version,
    BasePaymasterV1,
    UUPSUpgradeable
{
    uint16 private constant VERSION = 1;

    // Mapping: contract address => function selector => is approved
    mapping(address => mapping(bytes4 => bool)) private _approvedFunctions;

    event FunctionApproved(
        address contractAddress,
        bytes4 selector,
        bool approved
    );

    error UnauthorizedFunction();
    error InvalidCallDataLength();
    error ZeroAddressContract();
    error InvalidArrayLength();

    constructor() {
        _disableInitializers();
    }

    /**
     * Initialize function for the proxy deployment. This standardizes the initialization
     * to better work with ProxyFactory.
     *
     * @param _owner Address that will own the proxy and be able to upgrade it
     * @param _entryPoint The EntryPoint address this paymaster will work with
     */
    function initialize(
        address _owner,
        address _entryPoint
    ) public initializer {
        __BasePaymaster_init(_owner, IEntryPoint(_entryPoint));
        __UUPSUpgradeable_init();
    }

    /**
     * @dev Function that should revert when `msg.sender` is not authorized to upgrade the contract.
     * Called by {upgradeTo} and {upgradeToAndCall}.
     *
     * Reverts if the sender is not the owner of the contract.
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal virtual override onlyOwner {
        // Authorization is handled by the onlyOwner modifier
    }

    /**
     * Add or remove approved functions for a strategy contract
     * @param contractAddress The contract address that will be whitelisted
     * @param selectors Array of function selectors to approve/disapprove
     * @param approved Whether to approve or remove approval for the selectors
     */
    function whitelistFunctions(
        address contractAddress,
        bytes4[] calldata selectors,
        bool[] calldata approved
    ) external onlyOwner {
        if (contractAddress == address(0)) revert ZeroAddressContract();
        if (selectors.length != approved.length) revert InvalidArrayLength();
        for (uint256 i = 0; i < selectors.length; i++) {
            _approvedFunctions[contractAddress][selectors[i]] = approved[i];
            emit FunctionApproved(contractAddress, selectors[i], approved[i]);
        }
    }

    /**
     * Check if a function is approved for a strategy
     * @param contractAddress The contract address
     * @param selector The function selector to check
     * @return bool Whether the function is approved
     */
    function isFunctionWhitelisted(
        address contractAddress,
        bytes4 selector
    ) public view returns (bool) {
        return _approvedFunctions[contractAddress][selector];
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
        bytes calldata callData = userOp.callData;

        // Verify we have at least 4 bytes for the selector
        if (callData.length < 4) {
            revert InvalidCallDataLength();
        }

        // Extract and verify the LightSmartAccount's "execute" function selector
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

        // Verify the function is approved for this target
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
