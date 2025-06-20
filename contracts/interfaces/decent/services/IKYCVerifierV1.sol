// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

interface IKYCVerifierV1 {
    // --- Initializer Functions ---

    function initialize() external;

    // --- View Functions ---

    function verify(address account_) external view returns (bool verified);
}
