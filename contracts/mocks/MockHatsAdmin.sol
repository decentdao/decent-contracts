// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import {IHats} from "../interfaces/hats/full/IHats.sol";

contract MockHatsAutoAdmin is IHats {
    uint256 hatId = 0;
    mapping(uint256 => address) public wearer;
    mapping(uint256 => address) public eligibility;

    event HatCreated(uint256 hatId);

    function mintTopHat(
        address,
        string memory,
        string memory
    ) external pure returns (uint256 topHatId) {
        return 0;
    }

    function createHat(
        uint256,
        string calldata,
        uint32,
        address _eligibility,
        address,
        bool,
        string calldata
    ) external returns (uint256 newHatId) {
        hatId++;
        eligibility[hatId] = _eligibility;
        emit HatCreated(hatId);
        return hatId;
    }

    function mintHat(
        uint256 _hatId,
        address _wearer
    ) external returns (bool success) {
        wearer[_hatId] = _wearer;
        return true;
    }

    function isWearerOfHat(
        address _wearer,
        uint256 _hatId
    ) external view override returns (bool) {
        return _wearer == wearer[_hatId];
    }

    function getHatEligibilityModule(
        uint256 _hatId
    ) external view override returns (address) {
        return eligibility[_hatId];
    }

    function transferHat(
        uint256 _hatId,
        address,
        address to
    ) external override {
        wearer[_hatId] = to;
    }

    function changeHatEligibility(
        uint256 _hatId,
        address _newEligibility
    ) external override {
        eligibility[_hatId] = _newEligibility;
    }

    function buildHatId(
        uint256 _admin,
        uint16 _newHat
    ) external pure override returns (uint256 id) {}

    function getHatLevel(
        uint256 _hatId
    ) external view override returns (uint32 level) {}

    function getLocalHatLevel(
        uint256 _hatId
    ) external pure override returns (uint32 level) {}

    function isTopHat(
        uint256 _hatId
    ) external view override returns (bool _topHat) {}

    function isLocalTopHat(
        uint256 _hatId
    ) external pure override returns (bool _localTopHat) {}

    function isValidHatId(
        uint256 _hatId
    ) external view override returns (bool validHatId) {}

    function getAdminAtLevel(
        uint256 _hatId,
        uint32 _level
    ) external view override returns (uint256 admin) {}

    function getAdminAtLocalLevel(
        uint256 _hatId,
        uint32 _level
    ) external pure override returns (uint256 admin) {}

    function getTopHatDomain(
        uint256 _hatId
    ) external view override returns (uint32 domain) {}

    function getTippyTopHatDomain(
        uint32 _topHatDomain
    ) external view override returns (uint32 domain) {}

    function noCircularLinkage(
        uint32 _topHatDomain,
        uint256 _linkedAdmin
    ) external view override returns (bool notCircular) {}

    function sameTippyTopHatDomain(
        uint32 _topHatDomain,
        uint256 _newAdminHat
    ) external view override returns (bool sameDomain) {}

    function batchCreateHats(
        uint256[] calldata _admins,
        string[] calldata _details,
        uint32[] calldata _maxSupplies,
        address[] memory _eligibilityModules,
        address[] memory _toggleModules,
        bool[] calldata _mutables,
        string[] calldata _imageURIs
    ) external override returns (bool success) {}

    function getNextId(
        uint256 _admin
    ) external view override returns (uint256 nextId) {}

    function batchMintHats(
        uint256[] calldata _hatIds,
        address[] calldata _wearers
    ) external override returns (bool success) {}

    function setHatStatus(
        uint256 _hatId,
        bool _newStatus
    ) external override returns (bool toggled) {}

    function checkHatStatus(
        uint256 _hatId
    ) external override returns (bool toggled) {}

    function setHatWearerStatus(
        uint256 _hatId,
        address _wearer,
        bool _eligible,
        bool _standing
    ) external override returns (bool updated) {}

    function checkHatWearerStatus(
        uint256 _hatId,
        address _wearer
    ) external override returns (bool updated) {}

    function renounceHat(uint256 _hatId) external override {}

    function makeHatImmutable(uint256 _hatId) external override {}

    function changeHatDetails(
        uint256 _hatId,
        string memory _newDetails
    ) external override {}

    function changeHatToggle(
        uint256 _hatId,
        address _newToggle
    ) external override {}

    function changeHatImageURI(
        uint256 _hatId,
        string memory _newImageURI
    ) external override {}

    function changeHatMaxSupply(
        uint256 _hatId,
        uint32 _newMaxSupply
    ) external override {}

    function requestLinkTopHatToTree(
        uint32 _topHatId,
        uint256 _newAdminHat
    ) external override {}

    function approveLinkTopHatToTree(
        uint32 _topHatId,
        uint256 _newAdminHat,
        address _eligibility,
        address _toggle,
        string calldata _details,
        string calldata _imageURI
    ) external override {}

    function unlinkTopHatFromTree(
        uint32 _topHatId,
        address _wearer
    ) external override {}

    function relinkTopHatWithinTree(
        uint32 _topHatDomain,
        uint256 _newAdminHat,
        address _eligibility,
        address _toggle,
        string calldata _details,
        string calldata _imageURI
    ) external override {}

    function viewHat(
        uint256 _hatId
    )
        external
        view
        override
        returns (
            string memory _details,
            uint32 _maxSupply,
            uint32 _supply,
            address _eligibility,
            address _toggle,
            string memory _imageURI,
            uint16 _lastHatId,
            bool _mutable,
            bool _active
        )
    {}

    function isAdminOfHat(
        address _user,
        uint256 _hatId
    ) external view override returns (bool isAdmin) {}

    function isInGoodStanding(
        address _wearer,
        uint256 _hatId
    ) external view override returns (bool standing) {}

    function isEligible(
        address _wearer,
        uint256 _hatId
    ) external view override returns (bool eligible) {}

    function getHatToggleModule(
        uint256 _hatId
    ) external view override returns (address toggle) {}

    function getHatMaxSupply(
        uint256 _hatId
    ) external view override returns (uint32 maxSupply) {}

    function hatSupply(
        uint256 _hatId
    ) external view override returns (uint32 supply) {}

    function getImageURIForHat(
        uint256 _hatId
    ) external view override returns (string memory _uri) {}

    function balanceOf(
        address _wearer,
        uint256 _hatId
    ) external view override returns (uint256 balance) {}

    function balanceOfBatch(
        address[] calldata _wearers,
        uint256[] calldata _hatIds
    ) external view override returns (uint256[] memory) {}

    function uri(
        uint256 id
    ) external view override returns (string memory _uri) {}
}
