//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "./interfaces/IFractalRegistry.sol";

/**
 * Implementation of IFractalRegistry.
 */
contract FractalRegistry is IFractalRegistry {
    event FractalNameUpdated(address indexed daoAddress, string daoName);
    event FractalSubDAODeclared(address indexed parentDAOAddress, address indexed subDAOAddress);

    /// @inheritdoc IFractalRegistry
    function updateDAOName(string memory _name) external {
        emit FractalNameUpdated(msg.sender, _name);
    }

    /// @inheritdoc IFractalRegistry
    function declareSubDAO(address _subDAOAddress) external {
        emit FractalSubDAODeclared(msg.sender, _subDAOAddress);
    }
}
