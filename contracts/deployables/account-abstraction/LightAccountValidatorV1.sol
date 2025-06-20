// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {ILightAccountValidatorV1} from "../../interfaces/decent/deployables/ILightAccountValidatorV1.sol";
import {ILightAccount} from "../../interfaces/light-account/ILightAccount.sol";
import {ILightAccountFactory} from "../../interfaces/light-account/ILightAccountFactory.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

abstract contract LightAccountValidatorV1 is
    ILightAccountValidatorV1,
    Initializable
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /// @custom:storage-location erc7201:Decent.LightAccountValidator.main
    struct LightAccountValidatorStorage {
        ILightAccountFactory lightAccountFactory;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.LightAccountValidator.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant LIGHT_ACCOUNT_VALIDATOR_STORAGE_LOCATION =
        0xed41a089afe75bc52b13df3ad8919290164082b965c18c56b129dc0b8138e700;

    function _getLightAccountValidatorStorage()
        internal
        pure
        returns (LightAccountValidatorStorage storage $)
    {
        assembly {
            $.slot := LIGHT_ACCOUNT_VALIDATOR_STORAGE_LOCATION
        }
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function __LightAccountValidatorV1_init(
        address lightAccountFactory_
    ) internal onlyInitializing {
        LightAccountValidatorStorage
            storage $ = _getLightAccountValidatorStorage();
        $.lightAccountFactory = ILightAccountFactory(lightAccountFactory_);
    }

    // ======================================================================
    // ILightAccountValidatorV1
    // ======================================================================

    // --- View Functions ---

    function lightAccountFactory()
        public
        view
        virtual
        override
        returns (address)
    {
        LightAccountValidatorStorage
            storage $ = _getLightAccountValidatorStorage();
        return address($.lightAccountFactory);
    }

    function potentialLightAccountResolvedOwner(
        address potentialLightAccount_,
        uint256 lightAccountIndex_
    ) public view virtual override returns (address) {
        (bool _isValid, address _lightAccountOwner) = _validateLightAccount(
            potentialLightAccount_,
            lightAccountIndex_
        );

        if (!_isValid) {
            return potentialLightAccount_;
        }

        return _lightAccountOwner;
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    function _validateLightAccount(
        address lightAccount_,
        uint256 lightAccountIndex_
    ) internal view virtual returns (bool, address) {
        // First check if the address has code (is a contract)
        uint256 size;
        assembly {
            size := extcodesize(lightAccount_)
        }

        // If it's an EOA (no code), it's not a `LightAccount`
        if (size == 0) {
            return (false, address(0));
        }

        try ILightAccount(lightAccount_).owner() returns (
            address lightAccountOwner_
        ) {
            LightAccountValidatorStorage
                storage $ = _getLightAccountValidatorStorage();

            // Regenerate the expected light account address
            address lightAccountAddress = $.lightAccountFactory.getAddress(
                lightAccountOwner_,
                lightAccountIndex_
            );

            // If the given `lightAccount` address is the same as the derived
            // `lightAccountAddress`, then we know that the `lightAccount`
            // was created by the `LightAccountFactory` and therefore can be trusted.
            return (lightAccountAddress == lightAccount_, lightAccountOwner_);
        } catch {
            // `lightAccount` does not implement `owner()`
            // so it's definitely not a `LightAccount`
            return (false, address(0));
        }
    }

    function _validateUserOp(
        PackedUserOperation calldata userOp_
    ) internal view virtual returns (address, address, bytes memory) {
        // Extract the light account index from paymaster data if present
        uint256 lightAccountIndex = _extractLightAccountIndex(
            userOp_.paymasterAndData
        );

        (bool _isValid, address _lightAccountOwner) = _validateLightAccount(
            userOp_.sender,
            lightAccountIndex
        );

        if (!_isValid) {
            revert InvalidLightAccount();
        }

        // If we're here, we've confirmed that the sender is an actual instance of a LightAccount,
        // and so therefore its "execute" function behaves as expected.
        //
        // This prevents a potential exploit where a user crafts a malicious UserOp
        // which targets a contract that is expected to be a LightAccount, but is not,
        // and allows the implementation of that contract's "execute" function to perform
        // any arbitrary logic (aka logic which does not execute the whitelisted function
        // encoded in the UserOp).

        // Validate that we have at least 4 bytes for the selector
        if (userOp_.callData.length < 4) {
            revert InvalidUserOpCallDataLength();
        }

        // Extract and validate the LightAccount's "execute" function selector
        // 0xb61d27f6 = bytes4(keccak256("execute(address,uint256,bytes)"))
        if (bytes4(userOp_.callData) != 0xb61d27f6) {
            revert InvalidCallData();
        }

        // Decode the "execute" function parameters
        (address target, , bytes memory innerCallData) = abi.decode(
            userOp_.callData[4:],
            (address, uint256, bytes)
        );

        // Extract the actual function selector from the innerCallData
        if (innerCallData.length < 4) {
            revert InvalidInnerCallDataLength();
        }

        return (_lightAccountOwner, target, innerCallData);
    }

    function _extractLightAccountIndex(
        bytes calldata paymasterAndData_
    ) internal pure virtual returns (uint256) {
        // Check if we have paymaster data beyond the standard fields
        // Standard fields take up 52 bytes (20 + 16 + 16)
        // 52 (standard fields) + 32 (index) = 84
        // so if the length is >= 84, we can extract the index without an out of bounds error
        if (paymasterAndData_.length >= 84) {
            // The index is encoded as the first 32 bytes after the standard fields
            return uint256(bytes32(paymasterAndData_[52:84]));
        }

        // Default to 0 for backward compatibility
        return 0;
    }
}
