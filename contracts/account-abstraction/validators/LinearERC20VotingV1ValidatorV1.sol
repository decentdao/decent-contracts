// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

import {IFunctionValidator} from "../../interfaces/account-abstraction/IFunctionValidator.sol";
import {Version} from "../../Version.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface ILinearERC20VotingV1 {
    function vote(uint32 proposalId, uint8 voteType) external;

    function hasVoted(
        uint32 proposalId,
        address account
    ) external view returns (bool);

    function votingEndBlock(uint32 proposalId) external view returns (uint32);
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

        // Get voting end block to determine if the proposal exists
        uint256 endBlock = ILinearERC20VotingV1(votingContract).votingEndBlock(
            proposalId
        );

        // Check if proposal exists (will have non-zero endBlock if it exists)
        if (endBlock == 0) {
            return false;
        }

        // Check if voting period has ended
        if (block.number > endBlock) {
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
