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
