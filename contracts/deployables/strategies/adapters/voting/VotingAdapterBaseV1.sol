// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IVotingAdapterBaseV1} from "../../../../interfaces/decent/deployables/IVotingAdapterBaseV1.sol";
import {IStrategyV1} from "../../../../interfaces/decent/deployables/IStrategyV1.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

abstract contract VotingAdapterBaseV1 is IVotingAdapterBaseV1, Initializable {
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /// @custom:storage-location erc7201:Decent.VotingAdapterBase.main
    struct VotingAdapterBaseStorage {
        IStrategyV1 strategy;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.VotingAdapterBase.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant VOTING_ADAPTER_BASE_STORAGE_LOCATION =
        0x13444dea181293cfa50cbfe292735b153109b99f6cc300533814de79e823b200;

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

    modifier onlyStrategy() {
        VotingAdapterBaseStorage storage $ = _getVotingAdapterBaseStorage();

        if (msg.sender != address($.strategy)) revert NotStrategy();
        _;
    }

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

    function __VotingAdapterBaseV1_init(
        address strategy_
    ) internal onlyInitializing {
        VotingAdapterBaseStorage storage $ = _getVotingAdapterBaseStorage();
        $.strategy = IStrategyV1(strategy_);
    }

    // ======================================================================
    // IVotingAdapterBaseV1
    // ======================================================================

    // --- View Functions ---

    function strategy() public view virtual override returns (address) {
        VotingAdapterBaseStorage storage $ = _getVotingAdapterBaseStorage();
        return address($.strategy);
    }
}
