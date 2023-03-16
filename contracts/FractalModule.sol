//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "@gnosis.pm/zodiac/contracts/core/Module.sol";
import "./interfaces/IFractalModule.sol";

contract FractalModule is IFractalModule, Module {
    mapping(address => bool) public controllers; // A DAO may authorize users to act on the behalf of the parent DAO.

    event ControllersAdded(address[] controllers);
    event ControllersRemoved(address[] controllers);

    error Unauthorized();
    error TxFailed();

    /// @dev Throws if called by any account other than the owner.
    modifier onlyAuthorized() {
        if (owner() != msg.sender && !controllers[msg.sender])
            revert Unauthorized();
        _;
    }

    /// @dev Initialize function
    /// @param initializeParams Parameters of initialization encoded
    function setUp(bytes memory initializeParams) public override initializer {
        __Ownable_init();
        (
            address _owner, // Controlling DAO
            address _avatar,
            address _target,
            address[] memory _controllers // Authorized controllers
        ) = abi.decode(
                initializeParams,
                (address, address, address, address[])
            );

        setAvatar(_avatar);
        setTarget(_target);
        addControllers(_controllers);
        transferOwnership(_owner);
    }

    /// @notice Allows an authorized user to exec a Gnosis Safe tx via the module
    /// @param execTxData Data payload of module transaction.
    function execTx(bytes memory execTxData) public onlyAuthorized {
        (
            address _target,
            uint256 _value,
            bytes memory _data,
            Enum.Operation _operation
        ) = abi.decode(execTxData, (address, uint256, bytes, Enum.Operation));
        if(!exec(_target, _value, _data, _operation)) revert TxFailed();
    }

    /// @notice Allows the module owner to add users which may exectxs
    /// @param _controllers Addresses added to the contoller list
    function addControllers(address[] memory _controllers) public onlyOwner {
        uint256 controllersLength = _controllers.length;
        for (uint256 i; i < controllersLength; ) {
            controllers[_controllers[i]] = true;
            unchecked {
                ++i;
            }
        }
        emit ControllersAdded(_controllers);
    }

    /// @notice Allows the module owner to remove users which may exectxs
    /// @param _controllers Addresses removed to the contoller list
    function removeControllers(
        address[] memory _controllers
    ) external onlyOwner {
        uint256 controllersLength = _controllers.length;
        for (uint256 i; i < controllersLength; ) {
            controllers[_controllers[i]] = false;
            unchecked {
                ++i;
            }
        }
        emit ControllersRemoved(_controllers);
    }
}
