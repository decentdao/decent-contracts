// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "../azorius/HatsProposalCreationWhitelist.sol";

contract MockHatsProposalCreationWhitelist is HatsProposalCreationWhitelist {
    function setUp(bytes memory initializeParams) public override initializer {
        __Ownable_init();
        super.setUp(initializeParams);
    }
}
