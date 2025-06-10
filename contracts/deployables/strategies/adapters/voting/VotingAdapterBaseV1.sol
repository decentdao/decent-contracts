// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IVotingAdapterBaseV1} from "../../../../interfaces/decent/deployables/IVotingAdapterBaseV1.sol";
import {IStrategyV1} from "../../../../interfaces/decent/deployables/IStrategyV1.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

abstract contract VotingAdapterBaseV1 is IVotingAdapterBaseV1, Initializable {
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    IStrategyV1 internal _strategy;

    // ======================================================================
    // MODIFIERS
    // ======================================================================

    modifier onlyStrategy() {
        if (msg.sender != address(_strategy)) revert NotStrategy();
        _;
    }

    modifier onlyAuthorizedFreezeVoter() {
        if (!IStrategyV1(_strategy).isAuthorizedFreezeVoter(msg.sender)) {
            revert UnauthorizedFreezeVoter(msg.sender);
        }
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
        _strategy = IStrategyV1(strategy_);
    }

    // ======================================================================
    // IVotingAdapterBaseV1
    // ======================================================================

    // --- View Functions ---

    function strategy() public view virtual override returns (address) {
        return address(_strategy);
    }
}
