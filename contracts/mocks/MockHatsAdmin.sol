// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "../interfaces/hats/IHats.sol";

contract MockHatsAutoAdmin is IHats {
    uint256 hatId = 0;
    mapping(uint256 => address) public wearer;
    mapping(uint256 => address) public eligibility;

    event HatCreated(uint256 hatId);

    function mintTopHat(
        address _target,
        string memory _details,
        string memory _imageURI
    ) external pure returns (uint256 topHatId) {
        // Silence unused variable warnings
        _target;
        _details;
        _imageURI;
        return 0;
    }

    function createHat(
        uint256 _admin,
        string calldata _details,
        uint32 _maxSupply,
        address _eligibility,
        address _toggle,
        bool _mutable,
        string calldata _imageURI
    ) external returns (uint256 newHatId) {
        // Silence unused variable warnings
        _admin;
        _details;
        _maxSupply;
        _toggle;
        _mutable;
        _imageURI;
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
        address from,
        address to
    ) external override {
        // Silence unused variable warnings
        from;
        wearer[_hatId] = to;
    }
}
