// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IVotesERC20V1} from "../../interfaces/decent/deployables/IVotesERC20V1.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IDeploymentBlockV1} from "../../interfaces/decent/IDeploymentBlockV1.sol";
import {DeploymentBlockV1} from "../../DeploymentBlockV1.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {NoncesUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/NoncesUpgradeable.sol";
import {ERC20VotesUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {VotesUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/utils/VotesUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

contract VotesERC20V1 is
    IVotesERC20V1,
    IVersion,
    ERC20VotesUpgradeable,
    ERC20PermitUpgradeable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    DeploymentBlockV1,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /// @custom:storage-location erc7201:Decent.VotesERC20.main
    struct VotesERC20Storage {
        bool locked;
        uint256 maxTotalSupply;
        uint48 unlockTime;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.VotesERC20.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant VOTES_ERC20_STORAGE_LOCATION =
        0x57c985480a3f326e09e0fd6059ce967a04828718ff6302d3fa09f8d24851e200;

    function _getVotesERC20Storage()
        internal
        pure
        returns (VotesERC20Storage storage $)
    {
        assembly {
            $.slot := VOTES_ERC20_STORAGE_LOCATION
        }
    }

    bytes32 public constant TRANSFER_FROM_ROLE =
        keccak256("TRANSFER_FROM_ROLE");
    bytes32 public constant TRANSFER_TO_ROLE = keccak256("TRANSFER_TO_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // ======================================================================
    // MODIFIERS
    // ======================================================================

    modifier isTransferable(address from_, address to_) {
        VotesERC20Storage storage $ = _getVotesERC20Storage();
        if (
            $.locked &&
            // overrides while locked
            !hasRole(TRANSFER_FROM_ROLE, from_) && // whitelisted addresses can always transfer
            !hasRole(TRANSFER_TO_ROLE, to_)
        ) {
            revert IsLocked();
        }
        _;
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function initialize(
        Metadata calldata metadata_,
        Allocation[] calldata allocations_,
        address owner_,
        bool locked_,
        uint256 maxTotalSupply_
    ) public virtual override initializer {
        __ERC20_init(metadata_.name, metadata_.symbol);
        __ERC20Permit_init(metadata_.name);
        __ERC20Votes_init();
        __UUPSUpgradeable_init();
        __DeploymentBlockV1_init();
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, owner_);
        _grantRole(MINTER_ROLE, owner_);

        // owner can always transfer
        _grantRole(TRANSFER_FROM_ROLE, owner_);

        // can always mint when locked
        _grantRole(TRANSFER_FROM_ROLE, address(0));

        // can always burn when locked
        _grantRole(TRANSFER_TO_ROLE, address(0));

        VotesERC20Storage storage $ = _getVotesERC20Storage();
        $.locked = locked_;
        $.maxTotalSupply = maxTotalSupply_;

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
    ) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

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

    function locked() public view virtual override returns (bool) {
        VotesERC20Storage storage $ = _getVotesERC20Storage();
        return $.locked;
    }

    function maxTotalSupply() public view virtual override returns (uint256) {
        VotesERC20Storage storage $ = _getVotesERC20Storage();
        return $.maxTotalSupply;
    }

    function getUnlockTime() public view virtual override returns (uint48) {
        VotesERC20Storage storage $ = _getVotesERC20Storage();
        return $.unlockTime;
    }

    // --- State-Changing Functions ---

    function lock(
        bool locked_
    ) public virtual override onlyRole(DEFAULT_ADMIN_ROLE) {
        VotesERC20Storage storage $ = _getVotesERC20Storage();
        if (!locked_) {
            $.unlockTime = uint48(block.timestamp);
        }
        $.locked = locked_;
        emit Locked(locked_);
    }

    function setMaxTotalSupply(
        uint256 newMaxTotalSupply_
    ) public virtual override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newMaxTotalSupply_ < totalSupply()) {
            revert InvalidMaxTotalSupply();
        }

        VotesERC20Storage storage $ = _getVotesERC20Storage();
        $.maxTotalSupply = newMaxTotalSupply_;
        emit MaxTotalSupplyUpdated(newMaxTotalSupply_);
    }

    function mint(
        address to_,
        uint256 amount_
    ) public virtual override onlyRole(MINTER_ROLE) {
        uint256 newTotalSupply = totalSupply() + amount_;

        VotesERC20Storage storage $ = _getVotesERC20Storage();
        if (newTotalSupply > $.maxTotalSupply) {
            revert ExceedMaxTotalSupply();
        }

        _mint(to_, amount_);
    }

    function burn(uint256 amount_) public virtual override {
        _burn(msg.sender, amount_);
    }

    // ======================================================================
    // ERC20VotesUpgradeable
    // ======================================================================

    // --- Internal Functions ---

    function _update(
        address from_,
        address to_,
        uint256 value_
    )
        internal
        virtual
        override(ERC20Upgradeable, ERC20VotesUpgradeable)
        isTransferable(from_, to_)
    {
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
    )
        public
        view
        virtual
        override(AccessControlUpgradeable, ERC165)
        returns (bool)
    {
        return
            interfaceId_ == type(IVotesERC20V1).interfaceId ||
            interfaceId_ == type(IERC20).interfaceId ||
            interfaceId_ == type(IERC20Permit).interfaceId ||
            interfaceId_ == type(IVotes).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            interfaceId_ == type(IAccessControl).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
