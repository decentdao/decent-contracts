// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {ITokenAdapterBaseV1} from "../interfaces/decent/deployables/ITokenAdapterBaseV1.sol";

contract MockTokenAdapter is ITokenAdapterBaseV1 {
    mapping(address => bool) public proposerStatusToReturn;

    function isProposer(
        address _proposer
    ) external view override returns (bool) {
        return proposerStatusToReturn[_proposer];
    }

    // mock setters

    function setProposerStatus(address _proposer, bool _isProposer) external {
        proposerStatusToReturn[_proposer] = _isProposer;
    }
}
