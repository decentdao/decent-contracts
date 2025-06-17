// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IVotesERC20V1} from "../../interfaces/decent/deployables/IVotesERC20V1.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IDeploymentBlockV1} from "../../interfaces/decent/IDeploymentBlockV1.sol";
import {DeploymentBlockV1} from "../../DeploymentBlockV1.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {NoncesUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/NoncesUpgradeable.sol";
import {ERC20VotesUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {VotesUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/utils/VotesUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

contract VotesERC20V1 is
    IVotesERC20V1,
    IVersion,
    ERC20VotesUpgradeable,
    ERC20PermitUpgradeable,
    UUPSUpgradeable,
    Ownable2StepUpgradeable,
    DeploymentBlockV1,
    ERC165
{
    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function initialize(
        Metadata calldata metadata_,
        Allocation[] calldata allocations_,
        address owner_
    ) public virtual override initializer {
        __ERC20_init(metadata_.name, metadata_.symbol);
        __ERC20Permit_init(metadata_.name);
        __ERC20Votes_init();
        __UUPSUpgradeable_init();
        __Ownable_init(owner_);
        __DeploymentBlockV1_init();

        uint256 holderCount = allocations_.length;
        for (uint256 i; i < holderCount; ) {
            _mint(allocations_[i].to, allocations_[i].amount);
            unchecked {
                ++i;
            }
        }
    }

    // ======================================================================
    // UUPS UPGRADEABLE
    // ======================================================================

    // --- Internal Functions ---

    function _authorizeUpgrade(
        address newImplementation_
    ) internal virtual override onlyOwner {}

    // ======================================================================
    // IVotesERC20V1
    // ======================================================================

    // --- Pure Functions ---

    function CLOCK_MODE()
        public
        pure
        virtual
        override(IVotesERC20V1, VotesUpgradeable)
        returns (string memory)
    {
        return "mode=timestamp";
    }

    // --- View Functions ---

    function clock()
        public
        view
        virtual
        override(IVotesERC20V1, VotesUpgradeable)
        returns (uint48)
    {
        return uint48(block.timestamp);
    }

    // ======================================================================
    // ERC20VotesUpgradeable
    // ======================================================================

    // --- Internal Functions ---

    function _update(
        address from_,
        address to_,
        uint256 value_
    ) internal virtual override(ERC20Upgradeable, ERC20VotesUpgradeable) {
        super._update(from_, to_, value_);
    }

    // ======================================================================
    // NoncesUpgradeable
    // ======================================================================

    // --- View Functions ---

    function nonces(
        address owner_
    )
        public
        view
        virtual
        override(ERC20PermitUpgradeable, NoncesUpgradeable)
        returns (uint256)
    {
        return super.nonces(owner_);
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

    // --- View Functions ---

    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IVotesERC20V1).interfaceId ||
            interfaceId_ == type(IERC20).interfaceId ||
            interfaceId_ == type(IERC20Permit).interfaceId ||
            interfaceId_ == type(IVotes).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
