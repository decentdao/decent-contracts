// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IProposerAdapterHatsV1} from "../../../../interfaces/decent/deployables/IProposerAdapterHatsV1.sol";
import {IProposerAdapterBaseV1} from "../../../../interfaces/decent/deployables/IProposerAdapterBaseV1.sol";
import {IHats} from "../../../../interfaces/hats/IHats.sol";
import {IVersion} from "../../../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlockV1} from "../../../../interfaces/decent/IDeploymentBlockV1.sol";
import {DeploymentBlockV1} from "../../../../DeploymentBlockV1.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract ProposerAdapterHatsV1 is
    IProposerAdapterHatsV1,
    IVersion,
    DeploymentBlockV1,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    IHats internal _hatsContract;
    uint256[] internal _whitelistedHatIds;
    mapping(uint256 hatId => bool isWhitelisted) internal _hatIdIsWhitelisted;

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address hatsContract_,
        uint256[] calldata whitelistedHatIds_
    ) public virtual override initializer {
        __DeploymentBlockV1_init();
        _hatsContract = IHats(hatsContract_);
        _whitelistedHatIds = whitelistedHatIds_;
        for (uint256 i = 0; i < whitelistedHatIds_.length; ) {
            _hatIdIsWhitelisted[whitelistedHatIds_[i]] = true;

            unchecked {
                ++i;
            }
        }
    }

    // ======================================================================
    // IProposerAdapterHatsV1
    // ======================================================================

    // --- View Functions ---

    function hatsContract() public view virtual override returns (address) {
        return address(_hatsContract);
    }

    function whitelistedHatIds()
        public
        view
        virtual
        override
        returns (uint256[] memory)
    {
        return _whitelistedHatIds;
    }

    function hatIdIsWhitelisted(
        uint256 hatId_
    ) public view virtual override returns (bool) {
        return _hatIdIsWhitelisted[hatId_];
    }

    // ======================================================================
    // IProposerAdapterBaseV1
    // ======================================================================

    // --- View Functions ---

    function isProposer(
        address proposer_,
        bytes calldata data_
    ) public view virtual override returns (bool) {
        uint256 hatId = abi.decode(data_, (uint256));
        return
            _hatIdIsWhitelisted[hatId] &&
            _hatsContract.isWearerOfHat(proposer_, hatId);
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
            interfaceId_ == type(IProposerAdapterHatsV1).interfaceId ||
            interfaceId_ == type(IProposerAdapterBaseV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
