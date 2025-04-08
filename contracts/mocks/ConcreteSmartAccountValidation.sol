// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

import {SmartAccountValidationV1} from "../account-abstraction/SmartAccountValidationV1.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";

contract ConcreteSmartAccountValidation is SmartAccountValidationV1 {
    function initialize(address _lightAccountFactory) public initializer {
        __SmartAccountValidationV1_init(_lightAccountFactory);
    }

    function validateSmartAccountPublic(
        address smartAccount
    ) public view returns (bool) {
        return validateSmartAccount(smartAccount);
    }

    function validateUserOpPublic(
        PackedUserOperation calldata userOp
    ) public view returns (address, bytes4) {
        return validateUserOp(userOp);
    }
}
