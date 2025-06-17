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

    IERC721 internal _token;
    uint256 internal _proposerThreshold;

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
        _token = IERC721(token_);
        _proposerThreshold = proposerThreshold_;
    }

    // ======================================================================
    // IProposerAdapterERC721V1
    // ======================================================================

    // --- View Functions ---

    function token() public view virtual override returns (address) {
        return address(_token);
    }

    function proposerThreshold()
        public
        view
        virtual
        override
        returns (uint256)
    {
        return _proposerThreshold;
    }

    // ======================================================================
    // IProposerAdapterBaseV1
    // ======================================================================

    // --- View Functions ---

    function isProposer(
        address proposer_,
        bytes calldata
    ) public view virtual override returns (bool) {
        return _token.balanceOf(proposer_) >= _proposerThreshold;
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
