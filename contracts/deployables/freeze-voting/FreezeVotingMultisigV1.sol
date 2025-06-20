// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IFreezeVotingBaseV1} from "../../interfaces/decent/deployables/IFreezeVotingBaseV1.sol";
import {IFreezeVotingMultisigV1} from "../../interfaces/decent/deployables/IFreezeVotingMultisigV1.sol";
import {ILightAccountValidatorV1} from "../../interfaces/decent/deployables/ILightAccountValidatorV1.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlockV1} from "../../interfaces/decent/IDeploymentBlockV1.sol";
import {ISafe} from "../../interfaces/safe/ISafe.sol";
import {FreezeVotingBaseV1} from "./FreezeVotingBaseV1.sol";
import {DeploymentBlockV1} from "../../DeploymentBlockV1.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract FreezeVotingMultisigV1 is
    IFreezeVotingMultisigV1,
    IVersion,
    FreezeVotingBaseV1,
    DeploymentBlockV1,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /// @custom:storage-location erc7201:Decent.FreezeVotingMultisig.main
    struct FreezeVotingMultisigStorage {
        ISafe parentSafe;
        mapping(uint48 freezeProposalCreated => mapping(address voter => bool hasFreezeVoted)) accountHasFreezeVoted;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.FreezeVotingMultisig.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant FREEZE_VOTING_MULTISIG_STORAGE_LOCATION =
        0x03420cdda0f62079c98c6fb6a90eb9dcb80ca14f81a2a84283aa39b5ef26ab00;

    function _getFreezeVotingMultisigStorage()
        internal
        pure
        returns (FreezeVotingMultisigStorage storage $)
    {
        assembly {
            $.slot := FREEZE_VOTING_MULTISIG_STORAGE_LOCATION
        }
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        uint256 freezeVotesThreshold_,
        uint32 freezeProposalPeriod_,
        uint32 freezePeriod_,
        address parentSafe_,
        address lightAccountFactory_
    ) public virtual override initializer {
        __FreezeVotingBaseV1_init(
            owner_,
            freezeProposalPeriod_,
            freezePeriod_,
            freezeVotesThreshold_,
            lightAccountFactory_
        );
        __DeploymentBlockV1_init();

        FreezeVotingMultisigStorage
            storage $ = _getFreezeVotingMultisigStorage();
        $.parentSafe = ISafe(parentSafe_);
    }

    // ======================================================================
    // IFreezeVotingMultisigV1
    // ======================================================================

    // --- View Functions ---

    function parentSafe() public view virtual override returns (address) {
        FreezeVotingMultisigStorage
            storage $ = _getFreezeVotingMultisigStorage();
        return address($.parentSafe);
    }

    function accountHasFreezeVoted(
        uint48 freezeProposalCreated_,
        address account_
    ) public view virtual override returns (bool) {
        FreezeVotingMultisigStorage
            storage $ = _getFreezeVotingMultisigStorage();
        return $.accountHasFreezeVoted[freezeProposalCreated_][account_];
    }

    // --- State-Changing Functions ---

    function castFreezeVote(
        uint256 lightAccountIndex_
    ) public virtual override {
        address resolvedVoter = potentialLightAccountResolvedOwner(
            msg.sender,
            lightAccountIndex_
        );

        FreezeVotingBaseStorage storage $base = _getFreezeVotingBaseStorage();

        if (
            block.timestamp >
            $base.freezeProposalCreated + $base.freezeProposalPeriod
        ) {
            _initializeFreezeVote();
            emit FreezeProposalCreated(resolvedVoter);
        }

        _recordFreezeVote(
            resolvedVoter,
            _getVotesAndUpdateHasVoted(resolvedVoter)
        );
    }

    // ======================================================================
    // IVersion
    // ======================================================================

    // --- Pure Functions ---

    function version() public pure virtual override returns (uint16) {
        return 1;
    }

    // ======================================================================
    // ERC165
    // ======================================================================

    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IFreezeVotingMultisigV1).interfaceId ||
            interfaceId_ == type(IFreezeVotingBaseV1).interfaceId ||
            interfaceId_ == type(ILightAccountValidatorV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    function _getVotesAndUpdateHasVoted(
        address voter_
    ) internal virtual returns (uint256) {
        FreezeVotingMultisigStorage
            storage $ = _getFreezeVotingMultisigStorage();

        if (!$.parentSafe.isOwner(voter_)) {
            return 0;
        }

        FreezeVotingBaseStorage storage $base = _getFreezeVotingBaseStorage();

        if ($.accountHasFreezeVoted[$base.freezeProposalCreated][voter_]) {
            return 0;
        }

        $.accountHasFreezeVoted[$base.freezeProposalCreated][voter_] = true;

        return 1;
    }
}
