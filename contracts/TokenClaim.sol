//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/ITokenClaim.sol";
import "./VotesToken.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TokenClaim is FactoryFriendly, ITokenClaim {
    using SafeERC20 for IERC20;

    address public funder;
    uint256 public deadlineBlock;
    address public childToken;
    address public parentToken;
    uint256 public snapShotId;
    uint256 public parentAllocation;
    mapping(address => bool) public claimed;

    error NotTheFunder();
    error NoDeadline();
    error DeadlinePending();

    /// @notice Initialize function, will be triggered when a new proxy is deployed
    /// @param initializeParams Parameters of initialization encoded
    function setUp(bytes memory initializeParams) public override initializer {
        __Ownable_init();
        (
            address _childTokenFunder,
            uint256 _deadlineBlock,
            address _parentToken,
            address _childToken,
            uint256 _parentAllocation
        ) = abi.decode(initializeParams, (address, uint256, address, address, uint256));

        funder = _childTokenFunder;
        deadlineBlock = _deadlineBlock;
        childToken = _childToken;
        parentToken = _parentToken;
        parentAllocation = _parentAllocation;

        snapShotId = VotesToken(_parentToken).captureSnapShot();

        IERC20(_childToken).transferFrom(_childTokenFunder, address(this), _parentAllocation);

        emit TokenClaimCreated(_parentToken, _childToken, _parentAllocation, snapShotId);
    }

    /// @notice This function allows pToken holders to claim cTokens
    /// @param claimer Address which is being claimed for
    function claimToken(address claimer) external {
        uint256 amount = getClaimAmount(claimer); // Get user balance

        if (amount == 0) revert NoAllocation();

        claimed[claimer] = true;

        IERC20(childToken).safeTransfer(claimer, amount); // transfer user balance

        emit TokenClaimed(parentToken, childToken, claimer, amount);
    }

    /// @notice Gets a users child token claimable amount
    /// @param claimer Address which is being claimed for
    /// @return cTokenAllocation Users cToken allocation
    function getClaimAmount(address claimer)
        public
        view
        returns (uint256)
    {
        return claimed[claimer] ? 0 :
            (VotesToken(parentToken).balanceOfAt(claimer, snapShotId) * parentAllocation) /
            VotesToken(parentToken).totalSupplyAt(snapShotId);
    }

    /// @notice Returns unclaimed tokens after the deadline to the funder.
    function reclaim() external {
        if (msg.sender != funder) revert NotTheFunder();
        if (deadlineBlock == 0) revert NoDeadline();
        if (block.number < deadlineBlock) revert DeadlinePending();
        IERC20 token = IERC20(childToken);
        token.safeTransfer(funder, token.balanceOf(address(this)));
    }
}
