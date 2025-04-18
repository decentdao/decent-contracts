// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

import {ERC4337VoterSupportV1} from "../azorius/strategies/ERC4337VoterSupportV1.sol";
import {ILightAccountFactory} from "../interfaces/ILightAccountFactory.sol";

/**
 * A concrete implementation of ERC4337VoterSupportV1 for testing purposes.
 */
contract ConcreteERC4337VoterSupportV1 is ERC4337VoterSupportV1 {
    function initialize(address _lightAccountFactory) public initializer {
        __ERC4337VoterSupportV1_init(_lightAccountFactory);
    }

    /**
     * A public function that exposes the _voter function for testing.
     */
    function voter(address msgSender) public view returns (address) {
        return _voter(msgSender);
    }

    /**
     * A public function that allows setting the _votingPeriodEnded mapping for testing.
     */
    function setVotingPeriodEnded(uint32 proposalId, bool ended) public {
        _votingPeriodEnded[proposalId] = ended;
    }
}
