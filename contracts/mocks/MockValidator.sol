// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

import {IFunctionValidator} from "../interfaces/account-abstraction/IFunctionValidator.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract MockValidator is IFunctionValidator, ERC165 {
    bool private shouldValidate;

    function setShouldValidate(bool _shouldValidate) external {
        shouldValidate = _shouldValidate;
    }

    function validateOperation(
        address, // sender
        address, // lightAccountOwner
        address, // targetContract
        bytes calldata // callData
    ) external view returns (bool) {
        // Return the configured validation result
        return shouldValidate;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(ERC165, IFunctionValidator) returns (bool) {
        return
            interfaceId == type(IFunctionValidator).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
