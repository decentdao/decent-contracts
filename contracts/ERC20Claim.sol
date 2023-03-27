//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import { IERC20Claim } from "./interfaces/IERC20Claim.sol";
import { VotesERC20, FactoryFriendly } from "./VotesERC20.sol";
import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * A simple contract that allows for parent DAOs that have created a new ERC-20 
 * token voting subDAO to allocate a certain amount of those tokens as claimable 
 * by the parent DAO's token holders.
 */
contract ERC20Claim is FactoryFriendly, IERC20Claim {

    using SafeERC20 for IERC20;

    uint32 public deadlineBlock;   // the deadline block to claim tokens by, or 0 for indefinite
    address public funder;          // the address of the initial holder of the claimable _childERC20 tokens
    address public childERC20;      // the parent ERC20 token address, for calculating a snapshot of holdings
    address public parentERC20;     // the parent ERC20 token address, for calculating a snapshot of holdings
    uint256 public snapShotId;      // the child ERC20 token address, to calculate the percentage claimbable
    uint256 public parentAllocation;// the total amount of _childERC20 tokens allocated for claiming by parent holders
    mapping(address => bool) public claimed;

    event ERC20Claimed(
        address indexed pToken,
        address indexed cToken,
        address indexed claimer,
        uint256 amount
    );

    error NoAllocation();
    error AllocationClaimed();
    error NotTheFunder();
    error NoDeadline();
    error DeadlinePending();
    
    event ERC20ClaimCreated(
        address parentToken,
        address childToken,
        uint256 parentAllocation,
        uint256 snapshotId,
        uint256 deadline
    );

    /**
     * Initialize function, will be triggered when a new instance is deployed.
     *
     * @param initializeParams encoded initialization parameters
     */
    function setUp(bytes memory initializeParams) public override initializer {
        __Ownable_init();
        (
            uint32 _deadlineBlock,
            address _childTokenFunder,
            address _parentERC20,
            address _childERC20,
            uint256 _parentAllocation
        ) = abi.decode(initializeParams, (uint32, address, address, address, uint256));

        funder = _childTokenFunder;
        deadlineBlock = _deadlineBlock;
        childERC20 = _childERC20;
        parentERC20 = _parentERC20;
        parentAllocation = _parentAllocation;

        snapShotId = VotesERC20(_parentERC20).captureSnapShot();

        IERC20(_childERC20).safeTransferFrom(
            _childTokenFunder,
            address(this),
            _parentAllocation
        );

        emit ERC20ClaimCreated(
            _parentERC20,
            _childERC20,
            _parentAllocation,
            snapShotId,
            _deadlineBlock
        );
    }

    /** @inheritdoc IERC20Claim*/
    function claimTokens(address claimer) external {
        uint256 amount = getClaimAmount(claimer); // get claimer balance

        if (amount == 0) revert NoAllocation(); // the claimer has not been allocated tokens to claim

        claimed[claimer] = true;

        IERC20(childERC20).safeTransfer(claimer, amount); // transfer claimer balance

        emit ERC20Claimed(parentERC20, childERC20, claimer, amount);
    }

    /** @inheritdoc IERC20Claim*/
    function reclaim() external {
        if (msg.sender != funder) revert NotTheFunder();
        if (deadlineBlock == 0) revert NoDeadline();
        if (block.number < deadlineBlock) revert DeadlinePending();
        IERC20 token = IERC20(childERC20);
        token.safeTransfer(funder, token.balanceOf(address(this)));
    }

    /** @inheritdoc IERC20Claim*/
    function getClaimAmount(address claimer) public view returns (uint256) {
        return
            claimed[claimer]
                ? 0
                : (VotesERC20(parentERC20).balanceOfAt(claimer, snapShotId) *
                    parentAllocation) /
                    VotesERC20(parentERC20).totalSupplyAt(snapShotId);
    }
}
