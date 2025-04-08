// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

import {ILightAccount} from "../interfaces/ILightAccount.sol";
import {ILightAccountFactory} from "../interfaces/ILightAccountFactory.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

abstract contract SmartAccountVerificationV1 is Initializable {
    ILightAccountFactory public lightAccountFactory;

    error InvalidSmartAccount();
    error InvalidUserOpCallDataLength();
    error InvalidCallData();
    error InvalidInnerCallDataLength();

    constructor() {
        _disableInitializers();
    }

    function __SmartAccountVerificationV1_init(
        address _lightAccountFactory
    ) internal {
        lightAccountFactory = ILightAccountFactory(_lightAccountFactory);
    }

    function verifySmartAccount(
        address smartAccount
    ) internal view virtual returns (bool) {
        // First check if the address has code (is a contract)
        uint256 size;
        assembly {
            size := extcodesize(smartAccount)
        }

        // If it's an EOA (no code), it's not a `LightAccount`
        if (size == 0) {
            return false;
        }

        try ILightAccount(smartAccount).owner() returns (
            address lightAccountOwner
        ) {
            // Regenerate the expected light account address
            address lightAccountAddress = lightAccountFactory.getAddress(
                lightAccountOwner,
                0 // we assume that Decent App is only creating one account per user
            );

            // If the given `smartAccount` address is the same as the derived
            // `lightAccountAddress`, then we know that the `smartAccount`
            // was created by the `LightAccountFactory` and therefore can be trusted.
            return lightAccountAddress == smartAccount;
        } catch {
            // `smartAccount` does not implement `owner()`
            // so it's definitely not a `LightAccount`
            return false;
        }
    }

    function verifyUserOp(
        PackedUserOperation calldata userOp
    ) internal view virtual returns (address, bytes4) {
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

        // Verify we have at least 4 bytes for the selector
        if (userOp.callData.length < 4) {
            revert InvalidUserOpCallDataLength();
        }

        // Extract and verify the LightAccount's "execute" function selector
        // 0xb61d27f6 = bytes4(keccak256("execute(address,uint256,bytes)"))
        if (bytes4(userOp.callData) != 0xb61d27f6) {
            revert InvalidCallData();
        }

        // Decode the "execute" function parameters
        (address target, , bytes memory innerCallData) = abi.decode(
            userOp.callData[4:],
            (address, uint256, bytes)
        );

        // Extract the actual function selector from the innerCallData
        if (innerCallData.length < 4) {
            revert InvalidInnerCallDataLength();
        }

        return (target, bytes4(innerCallData));
    }
}
