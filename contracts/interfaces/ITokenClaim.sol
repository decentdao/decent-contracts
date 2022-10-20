//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface ITokenClaim {
    error NoAllocation();
    error AllocationClaimed();
    event TokenClaimCreated(
        address parentToken,
        address childToken,
        uint256 parentAllocation,
        uint256 snapshotId
    );
    event TokenClaimed(
        address indexed pToken,
        address indexed cToken,
        address indexed claimer,
        uint256 amount
    );

    /// @notice This function allows pToken holders to claim cTokens
    /// @param claimer Address which is being claimed for
    function claimToken(address claimer) external;

    /// @notice Gets a users child token claimable amount
    /// @param claimer Address which is being claimed for
    /// @return cTokenAllocation Users cToken allocation
    function getClaimAmount(address claimer) external view returns (uint256);
}
