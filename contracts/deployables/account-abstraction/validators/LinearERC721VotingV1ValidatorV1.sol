// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IFunctionValidator} from "../../../interfaces/decent/deployables/IFunctionValidator.sol";
import {Version} from "../../Version.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface ILinearERC721VotingV1 {
    function vote(
        uint32 proposalId,
        uint8 voteType,
        address[] memory tokenAddresses,
        uint256[] memory tokenIds
    ) external;

    function hasVoted(
        uint32 proposalId,
        address tokenAddress,
        uint256 tokenId
    ) external view returns (bool);

    function getVotingTimestamps(
        uint32 proposalId
    ) external view returns (uint48 startTime, uint48 endTime);

    function getTokenWeight(
        address tokenAddress
    ) external view returns (uint256);

    function votingPeriodEnded(uint32 proposalId) external view returns (bool);
}

/**
 * @title LinearERC721VotingV1ValidatorV1
 * @dev Validates vote operations for LinearERC721VotingV1 to ensure they will succeed
 */
contract LinearERC721VotingV1ValidatorV1 is
    IFunctionValidator,
    ERC165,
    Version
{
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
        // Verify function selector matches vote(uint32,uint8,address[],uint256[])
        if (bytes4(callData) != ILinearERC721VotingV1.vote.selector) {
            return false;
        }

        // Decode vote parameters from callData
        (
            uint32 proposalId,
            uint8 voteType,
            address[] memory tokenAddresses,
            uint256[] memory tokenIds
        ) = abi.decode(
                callData[4:], // skip selector
                (uint32, uint8, address[], uint256[])
            );

        // Check if arrays have matching lengths
        if (tokenAddresses.length != tokenIds.length) {
            return false;
        }

        // Check if vote type is valid (NO=0, YES=1, ABSTAIN=2)
        if (voteType > 2) {
            return false;
        }

        // Get proposal end timestamp to determine if the proposal exists
        (, uint48 endTime) = ILinearERC721VotingV1(votingContract)
            .getVotingTimestamps(proposalId);

        // Check if proposal exists (will have non-zero endTime if it exists)
        if (endTime == 0) {
            return false;
        }

        // Check if voting period has ended
        if (
            ILinearERC721VotingV1(votingContract).votingPeriodEnded(proposalId)
        ) {
            return false;
        }

        // Validate each token in the arrays
        uint256 totalWeight = 0;
        for (uint256 i = 0; i < tokenAddresses.length; i++) {
            address tokenAddress = tokenAddresses[i];
            uint256 tokenId = tokenIds[i];

            // Accumulate weight (allowing zero weights)
            totalWeight += ILinearERC721VotingV1(votingContract).getTokenWeight(
                    tokenAddress
                );

            // Check if token has already voted
            if (
                ILinearERC721VotingV1(votingContract).hasVoted(
                    proposalId,
                    tokenAddress,
                    tokenId
                )
            ) {
                return false;
            }

            // Check if voter owns the token
            if (IERC721(tokenAddress).ownerOf(tokenId) != lightAccountOwner) {
                return false;
            }
        }

        // Check total weight matches contract behavior
        if (totalWeight == 0) {
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
