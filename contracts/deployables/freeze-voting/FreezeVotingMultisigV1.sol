// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IFreezeVotingBaseV1} from "../../interfaces/decent/deployables/IFreezeVotingBaseV1.sol";
import {IFreezeVotingMultisigV1} from "../../interfaces/decent/deployables/IFreezeVotingMultisigV1.sol";
import {IVoterResolverV1} from "../../interfaces/decent/deployables/IVoterResolverV1.sol";
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

    ISafe internal _parentSafe;
    mapping(uint48 freezeProposalCreated => mapping(address voter => bool hasFreezeVoted))
        internal _accountHasFreezeVoted;

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
        _parentSafe = ISafe(parentSafe_);
    }

    // ======================================================================
    // IFreezeVotingMultisigV1
    // ======================================================================

    // --- View Functions ---

    function parentSafe() public view virtual override returns (address) {
        return address(_parentSafe);
    }

    function accountHasFreezeVoted(
        uint48 freezeProposalCreated_,
        address account_
    ) public view virtual override returns (bool) {
        return _accountHasFreezeVoted[freezeProposalCreated_][account_];
    }

    // --- State-Changing Functions ---

    function castFreezeVote() public virtual override {
        address resolvedVoter = voter(msg.sender);

        if (block.timestamp > _freezeProposalCreated + _freezeProposalPeriod) {
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
            interfaceId_ == type(IVoterResolverV1).interfaceId ||
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
        if (!_parentSafe.isOwner(voter_)) {
            return 0;
        }

        if (_accountHasFreezeVoted[_freezeProposalCreated][voter_]) {
            return 0;
        }

        _accountHasFreezeVoted[_freezeProposalCreated][voter_] = true;

        return 1;
    }
}
