// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

import {HatsProposalCreationWhitelistV1} from "../azorius/strategies/HatsProposalCreationWhitelistV1.sol";

contract ConcreteHatsProposalCreationWhitelistV1 is
    HatsProposalCreationWhitelistV1
{
    function setUp(
        address owner,
        bytes memory initializeParams
    ) public initializer {
        __Ownable_init();
        transferOwnership(owner);
        super.setUp(initializeParams);
    }
}
