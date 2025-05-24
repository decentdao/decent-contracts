// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

interface IProposerAdapterBaseV1 {
    function isProposer(address _proposer) external view returns (bool);
}
