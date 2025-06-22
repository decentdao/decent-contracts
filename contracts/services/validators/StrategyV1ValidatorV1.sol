// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IFunctionValidator} from "../../interfaces/decent/services/IFunctionValidator.sol";
import {IStrategyV1} from "../../interfaces/decent/deployables/IStrategyV1.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlock} from "../../interfaces/decent/IDeploymentBlock.sol";
import {DeploymentBlockNonUpgradeable} from "../../DeploymentBlockNonUpgradeable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/**
 * @title StrategyV1ValidatorV1
 * @author Decent Labs
 * @notice Implementation of function validator for StrategyV1 voting operations
 * @dev This contract implements IFunctionValidator, providing validation logic
 * for determining whether a paymaster should sponsor gasless voting operations.
 *
 * Implementation details:
 * - Validates castVote operations for StrategyV1 contracts
 * - Checks voting power and proposal validity
 * - Stateless service contract deployed as singleton per chain
 * - Non-upgradeable deployment pattern
 * - Integrates with DecentPaymasterV1 for gas sponsorship
 *
 * Validation process:
 * 1. Verify the function selector is castVote
 * 2. Decode vote parameters from calldata
 * 3. Delegate validation to StrategyV1's validStrategyVote
 * 4. Return sponsorship decision based on voting eligibility
 *
 * @custom:security-contact security@decentlabs.io
 */
contract StrategyV1ValidatorV1 is
    IFunctionValidator,
    IVersion,
    DeploymentBlockNonUpgradeable,
    ERC165
{
    // ======================================================================
    // IFunctionValidator
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IFunctionValidator
     * @dev Validates castVote operations by checking if the Light Account owner
     * has sufficient voting power to participate in the proposal.
     * Only validates castVote function calls - all other selectors return false.
     */
    function validateOperation(
        address,
        address lightAccountOwner_,
        address strategy_,
        bytes calldata callData_
    ) public view virtual override returns (bool) {
        // confirm here that the calldata selector is correct: `castVote(uint32,uint8,(address,bytes)[],uint256)`
        if (bytes4(callData_) != IStrategyV1.castVote.selector) {
            return false;
        }

        // Decode vote parameters from callData
        // castVote(uint32 proposalId_, uint8 voteType_, (tuple(address,bytes))[] votingAdaptersData_, uint256 lightAccountIndex_)
        (
            uint32 proposalId,
            uint8 voteType,
            IStrategyV1.VotingAdapterVoteData[] memory votingAdaptersData,

        ) = abi.decode(
                callData_[4:], // skip selector
                (uint32, uint8, IStrategyV1.VotingAdapterVoteData[], uint256)
            );

        return
            IStrategyV1(strategy_).validStrategyVote(
                lightAccountOwner_,
                proposalId,
                voteType,
                votingAdaptersData
            );
    }

    // ======================================================================
    // IVersion
    // ======================================================================

    // --- Pure Functions ---

    /**
     * @inheritdoc IVersion
     */
    function version() public pure virtual override returns (uint16) {
        return 1;
    }

    // ======================================================================
    // ERC165
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc ERC165
     * @dev Supports IFunctionValidator, IVersion, IDeploymentBlock, and IERC165
     */
    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IFunctionValidator).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlock).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
