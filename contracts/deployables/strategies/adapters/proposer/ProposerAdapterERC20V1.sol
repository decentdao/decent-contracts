// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IProposerAdapterERC20V1} from "../../../../interfaces/decent/deployables/IProposerAdapterERC20V1.sol";
import {IProposerAdapterBaseV1} from "../../../../interfaces/decent/deployables/IProposerAdapterBaseV1.sol";
import {IVersion} from "../../../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlockV1} from "../../../../interfaces/decent/IDeploymentBlockV1.sol";
import {DeploymentBlockV1} from "../../../../DeploymentBlockV1.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract ProposerAdapterERC20V1 is
    IProposerAdapterERC20V1,
    IVersion,
    DeploymentBlockV1,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /// @custom:storage-location erc7201:Decent.ProposerAdapterERC20.main
    struct ProposerAdapterERC20Storage {
        IVotes token;
        uint256 proposerThreshold;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.ProposerAdapterERC20.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant PROPOSER_ADAPTER_ERC20_STORAGE_LOCATION =
        0xd0ff3bfab69583661d8803345254b7701c2125007ad7e3ef64473e569aca5400;

    function _getProposerAdapterERC20Storage()
        internal
        pure
        returns (ProposerAdapterERC20Storage storage $)
    {
        assembly {
            $.slot := PROPOSER_ADAPTER_ERC20_STORAGE_LOCATION
        }
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address token_,
        uint256 proposerThreshold_
    ) public virtual override initializer {
        __DeploymentBlockV1_init();

        ProposerAdapterERC20Storage
            storage $ = _getProposerAdapterERC20Storage();
        $.token = IVotes(token_);
        $.proposerThreshold = proposerThreshold_;
    }

    // ======================================================================
    // IProposerAdapterERC20V1
    // ======================================================================

    // --- View Functions ---

    function token() public view virtual override returns (address) {
        ProposerAdapterERC20Storage
            storage $ = _getProposerAdapterERC20Storage();
        return address($.token);
    }

    function proposerThreshold()
        public
        view
        virtual
        override
        returns (uint256)
    {
        ProposerAdapterERC20Storage
            storage $ = _getProposerAdapterERC20Storage();
        return $.proposerThreshold;
    }

    // ======================================================================
    // IProposerAdapterBaseV1
    // ======================================================================

    // --- View Functions ---

    function isProposer(
        address proposer_,
        bytes calldata
    ) public view virtual override returns (bool) {
        ProposerAdapterERC20Storage
            storage $ = _getProposerAdapterERC20Storage();
        return $.token.getVotes(proposer_) >= $.proposerThreshold;
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
            interfaceId_ == type(IProposerAdapterERC20V1).interfaceId ||
            interfaceId_ == type(IProposerAdapterBaseV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
