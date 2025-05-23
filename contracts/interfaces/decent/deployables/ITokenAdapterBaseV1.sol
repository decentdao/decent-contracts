// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

interface ITokenAdapterBaseV1 {
    function isProposer(address _proposer) external view returns (bool);
}
