// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IVotingAdapterBase} from "../../../../interfaces/decent/deployables/IVotingAdapterBase.sol";
import {IStrategyV1} from "../../../../interfaces/decent/deployables/IStrategyV1.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title VotingAdapterBase
 * @author Decent Labs
 * @notice Abstract base implementation for voting adapters in the Azorius governance system
 * @dev This contract implements IVotingAdapterBase, providing common functionality
 * for all voting adapters.
 *
 * Implementation details:
 * - Uses EIP-7201 namespaced storage pattern for upgradeability safety
 * - Provides access control modifiers for strategy-only and freeze voter functions
 * - Stores reference to the associated strategy contract
 * - Child contracts must implement weight calculation and vote recording logic
 * - Supports both regular proposal voting and freeze voting mechanisms
 *
 * @custom:security-contact security@decentlabs.io
 */
abstract contract VotingAdapterBase is IVotingAdapterBase, Initializable {
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /**
     * @notice Main storage struct for VotingAdapterBase following EIP-7201
     * @dev Contains reference to the strategy contract that manages this adapter
     * @custom:storage-location erc7201:Decent.VotingAdapterBase.main
     */
    struct VotingAdapterBaseStorage {
        /** @notice The strategy contract that this adapter is associated with */
        IStrategyV1 strategy;
    }

    /**
     * @dev Storage slot for VotingAdapterBaseStorage calculated using EIP-7201 formula:
     * keccak256(abi.encode(uint256(keccak256("Decent.VotingAdapterBase.main")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 internal constant VOTING_ADAPTER_BASE_STORAGE_LOCATION =
        0x13444dea181293cfa50cbfe292735b153109b99f6cc300533814de79e823b200;

    /**
     * @dev Returns the storage struct for VotingAdapterBase
     * Following the EIP-7201 namespaced storage pattern to avoid storage collisions
     */
    function _getVotingAdapterBaseStorage()
        internal
        pure
        returns (VotingAdapterBaseStorage storage $)
    {
        assembly {
            $.slot := VOTING_ADAPTER_BASE_STORAGE_LOCATION
        }
    }

    // ======================================================================
    // MODIFIERS
    // ======================================================================

    /**
     * @notice Restricts function access to the strategy contract
     * @dev Used by recordVote to ensure only the strategy can record votes
     * @custom:throws NotStrategy if msg.sender is not the strategy contract
     */
    modifier onlyStrategy() {
        VotingAdapterBaseStorage storage $ = _getVotingAdapterBaseStorage();

        if (msg.sender != address($.strategy)) revert NotStrategy();
        _;
    }

    /**
     * @notice Restricts function access to authorized freeze voter contracts
     * @dev Queries the strategy to check if caller is an authorized freeze voter
     * @custom:throws UnauthorizedFreezeVoter if msg.sender is not authorized
     */
    modifier onlyAuthorizedFreezeVoter() {
        VotingAdapterBaseStorage storage $ = _getVotingAdapterBaseStorage();

        if (!IStrategyV1($.strategy).isAuthorizedFreezeVoter(msg.sender))
            revert UnauthorizedFreezeVoter(msg.sender);

        _;
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Internal initializer for VotingAdapterBase
     * @dev Called by child contracts during their initialization
     * @param strategy_ The address of the strategy contract that will manage this adapter
     */
    function __VotingAdapterBase_init(
        address strategy_
    ) internal onlyInitializing {
        VotingAdapterBaseStorage storage $ = _getVotingAdapterBaseStorage();
        $.strategy = IStrategyV1(strategy_);
    }

    // ======================================================================
    // IVotingAdapterBase
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IVotingAdapterBase
     */
    function strategy() public view virtual override returns (address) {
        VotingAdapterBaseStorage storage $ = _getVotingAdapterBaseStorage();
        return address($.strategy);
    }
}
