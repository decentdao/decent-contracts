//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

interface IERC20Claim {
    /// @notice This function allows pToken holders to claim cTokens
    /// @param claimer Address which is being claimed for
    function claimToken(address claimer) external;

    /// @notice Gets a users child token claimable amount
    /// @param claimer Address which is being claimed for
    /// @return cTokenAllocation Users cToken allocation
    function getClaimAmount(address claimer) external view returns (uint256);
}
