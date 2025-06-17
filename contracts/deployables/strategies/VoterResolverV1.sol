// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IVoterResolverV1} from "../../interfaces/decent/deployables/IVoterResolverV1.sol";
import {SmartAccountValidationV1} from "../account-abstraction/SmartAccountValidationV1.sol";

abstract contract VoterResolverV1 is
    IVoterResolverV1,
    SmartAccountValidationV1
{
    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function __VoterResolverV1_init(
        address lightAccountFactory_
    ) internal onlyInitializing {
        __SmartAccountValidationV1_init(lightAccountFactory_);
    }

    // ======================================================================
    // IVoterResolverV1
    // ======================================================================

    // --- View Functions ---

    function voter(
        address voter_
    ) public view virtual override returns (address) {
        (bool isValid, address lightAccountOwner) = _validateSmartAccount(
            voter_
        );
        if (!isValid) {
            return voter_;
        }

        return lightAccountOwner;
    }
}
