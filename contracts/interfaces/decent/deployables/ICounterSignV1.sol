// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

interface ICounterSignV1 {
    enum Operation {
        Call,
        DelegateCall
    }

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        Operation operation;
    }

    function getAgreementUrl() external view returns (string memory);

    function signAgreement(string memory name) external;

    function executeAgreement() external;

    function getSigners() external view returns (address[] memory);

    function getHasSigned(address signerAddress) external view returns (bool);

    function getIsExecutable() external view returns (bool);

    function getHasExecuted() external view returns (bool);
}
