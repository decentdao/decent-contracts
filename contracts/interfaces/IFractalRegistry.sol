//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

interface IFractalRegistry {
    event FractalNameUpdated(address indexed daoAddress, string daoName);
    event FractalSubDAODeclared(address indexed parentDAOAddress, address indexed subDAOAddress);

    /// @notice Updates the DAO's registered name
    /// @param _name The new DAO name
    function updateDAOName(string memory _name) external;

    /// @notice Declares certain address as subDAO of parentDAO.
    /// @param _subDAOAddress Address of subDAO to declare as child of parentDAO.
    function declareSubDAO(address _subDAOAddress) external;
}
