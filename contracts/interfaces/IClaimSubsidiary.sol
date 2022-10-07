//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IClaimSubsidiary {
    error NoAllocation();
    error AllocationClaimed();
    event SnapAdded(address pToken, address cToken, uint256 pAllocation);
    event SnapClaimed(
        address indexed pToken,
        address indexed cToken,
        address indexed claimer,
        uint256 amount
    );

    /// @notice Initilize Claim Contract
    /// @param _metaFactory Address funding claimContract
    /// @param _pToken Address of the parent token used for snapshot reference
    /// @param _cToken Address of child Token being claimed
    /// @param _pAllocation Total tokens allocated for pToken holders
    function initialize(
        address _metaFactory,
        address _pToken,
        address _cToken,
        uint256 _pAllocation
    ) external;

    /// @notice This function allows pToken holders to claim cTokens
    /// @param claimer Address which is being claimed for
    function claimSnap(address claimer) external;

    //////////////////// View Functions //////////////////////////
    /// @notice Calculate a users cToken allocation
    /// @param claimer Address which is being claimed for
    /// @return cTokenAllocation Users cToken allocation
    function calculateClaimAmount(address claimer)
        external
        view
        returns (uint256 cTokenAllocation);
}
