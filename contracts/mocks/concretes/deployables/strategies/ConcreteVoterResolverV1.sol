// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {VoterResolverV1} from "../../../../deployables/strategies/VoterResolverV1.sol";
import {ILightAccountFactory} from "../../../../interfaces/light-account/ILightAccountFactory.sol";

/**
 * A concrete implementation of VoterResolverV1 for testing purposes.
 */
contract ConcreteVoterResolverV1 is VoterResolverV1 {
    function initialize(address _lightAccountFactory) public initializer {
        __VoterResolverV1_init(_lightAccountFactory);
    }
}
