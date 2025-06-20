// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IProposerAdapterERC721V1} from "../../../../interfaces/decent/deployables/IProposerAdapterERC721V1.sol";
import {IProposerAdapterBaseV1} from "../../../../interfaces/decent/deployables/IProposerAdapterBaseV1.sol";
import {IVersion} from "../../../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlockV1} from "../../../../interfaces/decent/IDeploymentBlockV1.sol";
import {DeploymentBlockV1} from "../../../../DeploymentBlockV1.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract ProposerAdapterERC721V1 is
    IProposerAdapterERC721V1,
    DeploymentBlockV1,
    IVersion,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /// @custom:storage-location erc7201:Decent.ProposerAdapterERC721.main
    struct ProposerAdapterERC721Storage {
        IERC721 token;
        uint256 proposerThreshold;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.ProposerAdapterERC721.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant PROPOSER_ADAPTER_ERC721_STORAGE_LOCATION =
        0x0b4a4f2e6b9f1f19c9af2582923f8bb9e1448a7f32ed0b86e2f369daa5840600;

    function _getProposerAdapterERC721Storage()
        internal
        pure
        returns (ProposerAdapterERC721Storage storage $)
    {
        assembly {
            $.slot := PROPOSER_ADAPTER_ERC721_STORAGE_LOCATION
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

        ProposerAdapterERC721Storage
            storage $ = _getProposerAdapterERC721Storage();
        $.token = IERC721(token_);
        $.proposerThreshold = proposerThreshold_;
    }

    // ======================================================================
    // IProposerAdapterERC721V1
    // ======================================================================

    // --- View Functions ---

    function token() public view virtual override returns (address) {
        ProposerAdapterERC721Storage
            storage $ = _getProposerAdapterERC721Storage();
        return address($.token);
    }

    function proposerThreshold()
        public
        view
        virtual
        override
        returns (uint256)
    {
        ProposerAdapterERC721Storage
            storage $ = _getProposerAdapterERC721Storage();
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
        ProposerAdapterERC721Storage
            storage $ = _getProposerAdapterERC721Storage();
        return $.token.balanceOf(proposer_) >= $.proposerThreshold;
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
            interfaceId_ == type(IProposerAdapterERC721V1).interfaceId ||
            interfaceId_ == type(IProposerAdapterBaseV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
