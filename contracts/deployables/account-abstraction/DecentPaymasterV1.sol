// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

import {BasePaymasterV1, IEntryPoint} from "./BasePaymasterV1.sol";
import {IDecentPaymasterV1} from "../../interfaces/decent/deployables/IDecentPaymasterV1.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {PackedUserOperation, IPaymaster} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

contract DecentPaymasterV1 is
    IDecentPaymasterV1,
    BasePaymasterV1,
    ERC165,
    UUPSUpgradeable,
    Initializable
{
    // Mapping: strategy address => function selector => is approved
    mapping(address => mapping(bytes4 => bool)) public approvedFunctions;

    event FunctionApproved(address strategy, bytes4 selector, bool approved);

    error UnauthorizedStrategy();
    error InvalidCallDataLength();
    error ZeroAddressStrategy();
    error InvalidArrayLength();

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner,
        address entryPoint
    ) public virtual initializer {
        _initialize(owner, entryPoint);
    }

    function _initialize(address owner, address entryPoint) internal virtual {
        __BasePaymaster_init(owner, IEntryPoint(entryPoint));
    }

    /**
     * Add or remove approved functions for a strategy contract
     * @param strategy The strategy contract address
     * @param selectors Array of function selectors to approve/disapprove
     * @param approved Whether to approve or remove approval for the selectors
     */
    function setStrategyFunctionApproval(
        address strategy,
        bytes4[] calldata selectors,
        bool[] calldata approved
    ) external onlyOwner {
        if (strategy == address(0)) revert ZeroAddressStrategy();
        if (selectors.length != approved.length) revert InvalidArrayLength();
        for (uint256 i = 0; i < selectors.length; i++) {
            approvedFunctions[strategy][selectors[i]] = approved[i];
            emit FunctionApproved(strategy, selectors[i], approved[i]);
        }
    }

    /**
     * Check if a function is approved for a strategy
     * @param strategy The strategy contract address
     * @param selector The function selector to check
     * @return bool Whether the function is approved
     */
    function isFunctionApproved(
        address strategy,
        bytes4 selector
    ) public view returns (bool) {
        return approvedFunctions[strategy][selector];
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

        // Require minimum length for selector and target address
        if (callData.length < 24) {
            revert InvalidCallDataLength();
        }

        // Extract function selector and target address
        bytes4 selector = bytes4(callData[:4]);
        address target;
        assembly {
            target := shr(96, calldataload(add(callData.offset, 4)))
        }

        // Verify the function is approved for this strategy
        if (!isFunctionApproved(target, selector)) {
            revert UnauthorizedStrategy();
        }

        return (abi.encode(), 0);
    }

    /// @inheritdoc ERC165
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC165) returns (bool) {
        return
            interfaceId == type(IPaymaster).interfaceId ||
            interfaceId == type(IDecentPaymasterV1).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal view override {
        (newImplementation);
        _onlyOwner();
    }

    /// @inheritdoc IVersion
    function getVersion() external pure override returns (uint16) {
        return 1;
    }
}
