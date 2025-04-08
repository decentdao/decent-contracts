// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

import {SmartAccountVerificationV1} from "../account-abstraction/SmartAccountVerificationV1.sol";

contract ConcreteSmartAccountVerification is SmartAccountVerificationV1 {
    function initialize(address _lightAccountFactory) public initializer {
        __SmartAccountVerificationV1_init(_lightAccountFactory);
    }

    function verifySmartAccountPublic(
        address smartAccount
    ) public view returns (bool) {
        return verifySmartAccount(smartAccount);
    }
}
