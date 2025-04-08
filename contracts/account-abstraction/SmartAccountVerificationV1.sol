// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

import {ILightAccount} from "../interfaces/ILightAccount.sol";
import {ILightAccountFactory} from "../interfaces/ILightAccountFactory.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

abstract contract SmartAccountVerificationV1 is Initializable {
    ILightAccountFactory public lightAccountFactory;

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
}
