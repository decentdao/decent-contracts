// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

interface IFunctionValidator {
    // --- View Functions ---

    function validateOperation(
        address userOpSender_,
        address lightAccountOwner_,
        address target_,
        bytes calldata callData_
    ) external view returns (bool isValid);
}
