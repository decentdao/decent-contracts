//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "./interfaces/IBaseFreezeVoting.sol";
import "@gnosis.pm/zodiac/contracts/interfaces/IGuard.sol";
import "@gnosis.pm/zodiac/contracts/factory/FactoryFriendly.sol";
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@gnosis.pm/zodiac/contracts/guard/BaseGuard.sol";

/**
 * A Safe Transaction Guard contract that prevents an [Azorius](./azorius/Azorius.md) 
 * subDAO from executing transactions if it has been frozen by its parentDAO.
 *
 * See https://docs.safe.global/learn/safe-core/safe-core-protocol/guards.
 */
contract AzoriusFreezeGuard is FactoryFriendly, IGuard, BaseGuard {

    /**
     * A reference to the freeze voting contract, which manages the freeze
     * voting process and maintains the frozen / unfrozen state of the DAO.
     */
    IBaseFreezeVoting public freezeVoting;

    event AzoriusFreezeGuardSetUp(
        address indexed creator,
        address indexed owner,
        address indexed freezeVoting
    );

    error DAOFrozen();

    /**
     * Initialize function, will be triggered when a new instance is deployed.
     *
     * @param initializeParams encoded initialization parameters
     */
    function setUp(bytes memory initializeParams) public override initializer {
        __Ownable_init();
        (address _owner, address _freezeVoting) = abi.decode(
            initializeParams,
            (address, address)
        );

        transferOwnership(_owner);
        freezeVoting = IBaseFreezeVoting(_freezeVoting);

        emit AzoriusFreezeGuardSetUp(msg.sender, _owner, _freezeVoting);
    }

    /**
     * This function is called by the Safe to check if the transaction
     * is able to be executed and reverts if the guard conditions are
     * not met.
     *
     * In our implementation, this reverts if the DAO is frozen.
     */
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
    ) external view override(BaseGuard, IGuard) {
        // if the DAO is currently frozen, revert
        // see BaseFreezeVoting for freeze voting details
        if(freezeVoting.isFrozen()) revert DAOFrozen();
    }

    /**
     * A callback performed after a transaction in executed on the Safe.
     *
     * @param txHash hash of the transaction that was executed
     * @param success bool indicating whether the Safe successfully executed the transaction
     */
    function checkAfterExecution(bytes32 txHash, bool success) external view override(BaseGuard, IGuard) {
        // not implementated
    }
}
