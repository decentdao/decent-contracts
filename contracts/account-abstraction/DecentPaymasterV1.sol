// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

import {IDecentPaymasterV1} from "../interfaces/account-abstraction/IDecentPaymasterV1.sol";
import {BasePaymasterV1} from "./BasePaymasterV1.sol";
import {SmartAccountValidationV1} from "./SmartAccountValidationV1.sol";
import {Version} from "../Version.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation, IPaymaster} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IFunctionValidator} from "../interfaces/account-abstraction/IFunctionValidator.sol";

contract DecentPaymasterV1 is
    IDecentPaymasterV1,
    Version,
    BasePaymasterV1,
    SmartAccountValidationV1
{
    uint16 private constant VERSION = 1;

    // Mapping: contract address => function selector => validator contract
    mapping(address => mapping(bytes4 => address)) private _functionValidators;

    event FunctionValidatorSet(
        address target,
        bytes4 selector,
        address validator
    );
    event FunctionValidatorRemoved(address target, bytes4 selector);

    error NotWhitelistedFunction(address target, bytes4 selector);
    error ValidationFailed(address target, bytes4 selector);
    error InvalidValidator();

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
        __SmartAccountValidationV1_init(_lightAccountFactory);
    }

    /**
     * Set validator for a specific function
     * @param target The target contract address
     * @param selector Function selector to validate
     * @param validator Address of the validator contract
     */
    function setFunctionValidator(
        address target,
        bytes4 selector,
        address validator
    ) external onlyOwner {
        if (validator == address(0)) revert InvalidValidator();

        // Verify the validator implements IFunctionValidator interface
        if (
            !IFunctionValidator(validator).supportsInterface(
                type(IFunctionValidator).interfaceId
            )
        ) {
            revert InvalidValidator();
        }

        _functionValidators[target][selector] = validator;
        emit FunctionValidatorSet(target, selector, validator);
    }

    /**
     * Remove validator for a specific function
     * @param target The target contract address
     * @param selector Function selector to remove validation for
     */
    function removeFunctionValidator(
        address target,
        bytes4 selector
    ) external onlyOwner {
        _functionValidators[target][selector] = address(0);
        emit FunctionValidatorRemoved(target, selector);
    }

    /**
     * Check if a function has a validator
     * @param target The contract address
     * @param selector The function selector to check
     * @return bool Whether the function has a validator
     */
    function hasFunctionValidator(
        address target,
        bytes4 selector
    ) public view returns (bool) {
        return _functionValidators[target][selector] != address(0);
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
        (
            address lightAccountOwner,
            address target,
            bytes4 selector
        ) = validateUserOp(userOp);

        // Check if function has a validator
        address validator = _functionValidators[target][selector];
        if (validator == address(0)) {
            revert NotWhitelistedFunction(target, selector);
        }

        // Extract the inner calldata from the UserOp
        (, , bytes memory innerCallData) = abi.decode(
            userOp.callData[4:],
            (address, uint256, bytes)
        );

        // Validate the operation will succeed
        bool isValid = IFunctionValidator(validator).validateOperation(
            userOp.sender,
            lightAccountOwner,
            target,
            innerCallData
        );

        if (!isValid) {
            revert ValidationFailed(target, selector);
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
