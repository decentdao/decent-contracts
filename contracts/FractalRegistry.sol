//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/IFractalRegistry.sol";

/// @notice A contract for registering Fractal DAO name strings
/// @notice These names are non-unique, and should not be used as the identifer of a DAO
contract FractalRegistry is IFractalRegistry {
    /// @notice Updates the DAO's registered name
    /// @param _name The new DAO name
    function updateDAOName(string memory _name) external {
        emit FractalNameUpdated(msg.sender, _name);
    }

    /// @notice Declares certain address as subDAO of parentDAO.
    /// @param _subDAOAddress Address of subDAO to declare as child of parentDAO.
    function declareSubDAO(address _subDAOAddress) external {
        emit FractalSubDAODeclared(msg.sender, _subDAOAddress);
    }
}
