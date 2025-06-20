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

    /// @custom:storage-location erc7201:Decent.ProposerAdapterHats.main
    struct ProposerAdapterHatsStorage {
        IHats hatsContract;
        uint256[] whitelistedHatIds;
        mapping(uint256 hatId => bool isWhitelisted) hatIdIsWhitelisted;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.ProposerAdapterHats.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant PROPOSER_ADAPTER_HATS_STORAGE_LOCATION =
        0xd7b60f4d6815f9154d4a3fad28e55995818cb5267ea0443225644719e6bb1900;

    function _getProposerAdapterHatsStorage()
        internal
        pure
        returns (ProposerAdapterHatsStorage storage $)
    {
        assembly {
            $.slot := PROPOSER_ADAPTER_HATS_STORAGE_LOCATION
        }
    }

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

        ProposerAdapterHatsStorage storage $ = _getProposerAdapterHatsStorage();
        $.hatsContract = IHats(hatsContract_);
        $.whitelistedHatIds = whitelistedHatIds_;
        for (uint256 i = 0; i < whitelistedHatIds_.length; ) {
            $.hatIdIsWhitelisted[whitelistedHatIds_[i]] = true;

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
        ProposerAdapterHatsStorage storage $ = _getProposerAdapterHatsStorage();
        return address($.hatsContract);
    }

    function whitelistedHatIds()
        public
        view
        virtual
        override
        returns (uint256[] memory)
    {
        ProposerAdapterHatsStorage storage $ = _getProposerAdapterHatsStorage();
        return $.whitelistedHatIds;
    }

    function hatIdIsWhitelisted(
        uint256 hatId_
    ) public view virtual override returns (bool) {
        ProposerAdapterHatsStorage storage $ = _getProposerAdapterHatsStorage();
        return $.hatIdIsWhitelisted[hatId_];
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

        ProposerAdapterHatsStorage storage $ = _getProposerAdapterHatsStorage();

        return
            $.hatIdIsWhitelisted[hatId] &&
            $.hatsContract.isWearerOfHat(proposer_, hatId);
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
