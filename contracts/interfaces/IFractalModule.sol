//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface IFractalModule {
    /// @notice Allows an authorized user to exec a Gnosis Safe tx via the module
    /// @param execTxData Data payload of module transaction.
    function execTx(bytes memory execTxData) external;

    /// @notice Allows the module owner to add users which may exectxs
    /// @param _controllers Addresses added to the contoller list
    function addControllers(address[] memory _controllers) external;

    /// @notice Allows the module owner to remove users which may exectxs
    /// @param _controllers Addresses removed to the contoller list
    function removeControllers(address[] memory _controllers) external;
}
