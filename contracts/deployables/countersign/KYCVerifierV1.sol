// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IKYCVerifierV1} from "../../interfaces/decent/deployables/IKYCVerifierV1.sol";
import {IZKMEVerify} from "../../interfaces/zkme/IZKMEVerify.sol";
import {IDeploymentBlockV1} from "../../interfaces/decent/IDeploymentBlockV1.sol";
import {DeploymentBlockV1} from "../../DeploymentBlockV1.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract KYCVerifierV1 is IKYCVerifierV1, IVersion, DeploymentBlockV1, ERC165 {
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    address internal _zkMeVerify;
    address internal _cooperator;

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address zkMeVerify_,
        address cooperator_
    ) public virtual override initializer {
        __DeploymentBlockV1_init();
        _zkMeVerify = zkMeVerify_;
        _cooperator = cooperator_;
    }

    // ======================================================================
    // IKYCVerifier
    // ======================================================================

    // --- View Functions ---

    function verify(
        address account_
    ) public view virtual override returns (bool) {
        return IZKMEVerify(_zkMeVerify).hasApproved(_cooperator, account_);
    }

    function zkMeVerify() public view virtual override returns (address) {
        return _zkMeVerify;
    }

    function cooperator() public view virtual override returns (address) {
        return _cooperator;
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
            interfaceId_ == type(IKYCVerifierV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
