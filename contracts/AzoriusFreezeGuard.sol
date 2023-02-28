//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/IBaseFreezeVoting.sol";
import "@gnosis.pm/zodiac/contracts/interfaces/IGuard.sol";
import "@gnosis.pm/zodiac/contracts/factory/FactoryFriendly.sol";
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@gnosis.pm/zodiac/contracts/guard/BaseGuard.sol";

/// @notice A guard contract that prevents an Azorius module from executing
/// @notice transactions if the DAO has been frozen by its parent DAO
contract AzoriusFreezeGuard is
    FactoryFriendly,
    IGuard,
    BaseGuard
{
    IBaseFreezeVoting public freezeVoting;

    event AzoriusFreezeGuardSetup(
        address indexed creator,
        address indexed owner,
        address indexed freezeVoting
    );

    /// @notice Initialize function, will be triggered when a new proxy is deployed
    /// @param initializeParams Parameters of initialization encoded
    function setUp(bytes memory initializeParams) public override initializer {
        __Ownable_init();
        (
            address _owner,
            address _freezeVoting
        ) = abi.decode(
                initializeParams,
                (address, address)
            );

        transferOwnership(_owner);
        freezeVoting = IBaseFreezeVoting(_freezeVoting);

        emit AzoriusFreezeGuardSetup(
            msg.sender,
            _owner,
            _freezeVoting
        );
    }

    /// @notice This function is called by the Gnosis Safe to check if the transaction should be able to be executed
    /// @notice Reverts if this transaction cannot be executed
    function checkTransaction(
        address,
        uint256,
        bytes memory,
        Enum.Operation,
        uint256,
        uint256,
        uint256,
        address,
        address payable,
        bytes memory,
        address
    ) external view override (BaseGuard, IGuard) {
        require(!freezeVoting.isFrozen(), "DAO is frozen");
    }

    /// @notice Does checks after transaction is executed on the Gnosis Safe
    /// @param txHash The hash of the transaction that was executed
    /// @param success Boolean indicating whether the Gnosis Safe successfully executed the tx
    function checkAfterExecution(bytes32 txHash, bool success)
        external
        view
        override (BaseGuard, IGuard)
    {}
}
