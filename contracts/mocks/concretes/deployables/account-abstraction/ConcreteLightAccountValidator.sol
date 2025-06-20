// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {LightAccountValidatorV1} from "../../../../deployables/account-abstraction/LightAccountValidatorV1.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";

contract ConcreteLightAccountValidator is LightAccountValidatorV1 {
    function initialize(address _lightAccountFactory) public initializer {
        __LightAccountValidatorV1_init(_lightAccountFactory);
    }

    function validateLightAccountPublic(
        address lightAccount,
        uint256 index
    ) public view returns (bool, address) {
        return _validateLightAccount(lightAccount, index);
    }

    function validateUserOpPublic(
        PackedUserOperation calldata userOp
    ) public view returns (address, address, bytes memory) {
        return _validateUserOp(userOp);
    }
}
