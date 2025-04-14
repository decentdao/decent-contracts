// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

import {ILightAccount} from "../../interfaces/ILightAccount.sol";
import {SmartAccountValidationV1} from "../../account-abstraction/SmartAccountValidationV1.sol";

/**
 * Functionality to support ERC4337 (Account Abstraction) by properly identifying the voter
 * when a contract account is used to interact with the voting system.
 */
abstract contract ERC4337VoterSupportV1 is SmartAccountValidationV1 {
    constructor() {
        _disableInitializers();
    }

    function __ERC4337VoterSupportV1_init(
        address _lightAccountFactory
    ) internal {
        __SmartAccountValidationV1_init(_lightAccountFactory);
    }

    /**
     * Returns the address of the voter which owns the voting weight
     * @param _msgSender address of the sender. It can be the wallet address, or the smart account address with EOA as owner
     * @return address of the voter
     */
    function _voter(
        address _msgSender
    ) internal view virtual returns (address) {
        if (!validateSmartAccount(_msgSender)) {
            return _msgSender;
        }

        // This call is safe, because `validateSmartAccount` ensures that the address implements
        // the `ILightAccount` interface, and so calling `owner()` will not revert.
        return ILightAccount(_msgSender).owner();
    }
}
