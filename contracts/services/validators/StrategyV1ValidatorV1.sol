// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IFunctionValidator} from "../../interfaces/decent/services/IFunctionValidator.sol";
import {IStrategyV1} from "../../interfaces/decent/deployables/IStrategyV1.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlockV1} from "../../interfaces/decent/IDeploymentBlockV1.sol";
import {DeploymentBlockV1NonUpgradeable} from "../../DeploymentBlockV1NonUpgradeable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract StrategyV1ValidatorV1 is
    IFunctionValidator,
    IVersion,
    DeploymentBlockV1NonUpgradeable,
    ERC165
{
    // ======================================================================
    // IFunctionValidator
    // ======================================================================

    // --- View Functions ---

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

    function version() public pure virtual override returns (uint16) {
        return 1;
    }

    // ======================================================================
    // ERC165
    // ======================================================================

    // --- View Functions ---

    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IFunctionValidator).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
