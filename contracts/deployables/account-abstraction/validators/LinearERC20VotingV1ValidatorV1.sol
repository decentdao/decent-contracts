// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IFunctionValidator} from "../../../interfaces/decent/deployables/IFunctionValidator.sol";
import {Version} from "../../Version.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface ILinearERC20VotingV1 {
    function vote(uint32 proposalId, uint8 voteType) external;

    function hasVoted(
        uint32 proposalId,
        address account
    ) external view returns (bool);

    function getVotingTimestamps(
        uint32 proposalId
    ) external view returns (uint48 startTime, uint48 endTime);

    function votingPeriodEnded(uint32 proposalId) external view returns (bool);

    function governanceToken() external view returns (address);
}

struct Checkpoint208 {
    uint48 key;
    uint208 value;
}

interface IERC20Votes {
    function numCheckpoints(address account) external view returns (uint32);

    function checkpoints(
        address account,
        uint32 pos
    ) external view returns (Checkpoint208 memory);
}

/**
 * @title LinearERC20VotingV1ValidatorV1
 * @dev Validates vote operations for LinearERC20VotingV1 to ensure they will succeed
 */
contract LinearERC20VotingV1ValidatorV1 is IFunctionValidator, ERC165, Version {
    uint16 public constant VERSION = 1;

    /**
     * @dev Validates if a vote operation will succeed
     * @param lightAccountOwner The account attempting to vote
     * @param votingContract The address of the voting contract
     * @param callData The encoded vote function call
     * @return isValid True if the vote operation will succeed
     */
    function validateOperation(
        address,
        address lightAccountOwner,
        address votingContract,
        bytes calldata callData
    ) external view returns (bool) {
        // confirm here that the calldata selector is correct (`vote(uint32,uint8)`)?
        if (bytes4(callData) != ILinearERC20VotingV1.vote.selector) {
            return false;
        }

        // Decode vote parameters from callData
        // vote(uint32 _proposalId, uint8 _voteType)
        (uint32 proposalId, uint8 voteType) = abi.decode(
            callData[4:], // skip selector
            (uint32, uint8)
        );

        // Check if vote type is valid (NO=0, YES=1, ABSTAIN=2)
        if (voteType > 2) {
            return false;
        }

        // get the proposal start and end timestamps to determine if the proposal exists
        (uint48 startTime, uint48 endTime) = ILinearERC20VotingV1(
            votingContract
        ).getVotingTimestamps(proposalId);

        // Check if proposal exists (will have non-zero endTime if it exists)
        if (endTime == 0) {
            return false;
        }

        // Check if voting period has ended
        if (
            ILinearERC20VotingV1(votingContract).votingPeriodEnded(proposalId)
        ) {
            return false;
        }

        // check if user has already voted
        if (
            ILinearERC20VotingV1(votingContract).hasVoted(
                proposalId,
                lightAccountOwner
            )
        ) {
            return false;
        }

        // get the governance token
        IERC20Votes governanceToken = IERC20Votes(
            ILinearERC20VotingV1(votingContract).governanceToken()
        );

        // get the number of checkpoints for the voter
        uint32 numCheckpoints = governanceToken.numCheckpoints(
            lightAccountOwner
        );

        // if there are no checkpoints, user has no voting weight
        if (numCheckpoints == 0) {
            return false;
        }

        // Iterate backwards through checkpoints to find the relevant one for startTime.
        // This is potentially more efficient than binary search if startTime is recent.
        uint256 votingWeight = 0;
        for (uint256 i = numCheckpoints; i > 0; i--) {
            // Checkpoint indices are 0-based, loop index 'i' is 1-based count.
            Checkpoint208 memory checkpoint = governanceToken.checkpoints(
                lightAccountOwner,
                uint32(i - 1)
            );

            // If this checkpoint's timestamp is after the proposal's endTime,
            // it implies the current timestamp is also after endTime.
            // Thus, the voting period has definitively ended, and any vote is invalid.
            if (checkpoint.key > endTime) {
                return false; // Vote is invalid as the proposal has ended.
            }

            // If the checkpoint timestamp is less than or equal to the proposal startTime,
            // we've found the relevant voting weight.
            if (checkpoint.key <= startTime) {
                votingWeight = checkpoint.value;
                break; // Exit loop once the correct checkpoint is found
            }
        }
        // If the loop completes without finding a checkpoint where fromTime <= startTime,
        // (and the optimization above didn't trigger and return false),
        // it means all checkpoints are after startTime, so the weight at startTime was 0.
        // votingWeight remains 0 in this case.

        // Check if the user had any voting weight at the proposal startTime
        if (votingWeight == 0) {
            return false;
        }

        // All checks passed
        return true;
    }

    function getVersion() public pure override returns (uint16) {
        return VERSION;
    }

    /**
     * @dev ERC165 interface support
     */
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC165, Version, IFunctionValidator) returns (bool) {
        return
            interfaceId == type(IFunctionValidator).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
