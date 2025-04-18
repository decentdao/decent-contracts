// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

interface IFunctionValidator {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);

    function validateOperation(
        address userOpSender,
        address lightAccountOwner,
        address target,
        bytes calldata callData
    ) external view returns (bool isValid);
}
