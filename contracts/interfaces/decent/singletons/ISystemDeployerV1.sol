// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IVotesERC20V1} from "../deployables/IVotesERC20V1.sol";

interface ISystemDeployerV1 {
    // --- Errors ---

    error ImplementationMustBeAContract();
    error VotesERC20V1NotFoundAtIndex(uint256 tokenIndex);
    error CannotDeployBothFreezeVotingContracts();
    error FreezeVotingContractNotDeployed();
    error AzoriusModuleNotDeployed();

    // --- Structs ---

    struct VotesERC20V1Params {
        address implementation;
        IVotesERC20V1.Metadata metadata;
        IVotesERC20V1.Allocation[] allocations;
        bool locked;
        uint256 maxTotalSupply;
        uint256 safeSupply;
    }

    struct ProposerAdapterERC20V1Params {
        address implementation;
        address token;
        uint256 newTokenIndex;
        uint256 proposerThreshold;
    }

    struct ProposerAdapterERC721V1Params {
        address implementation;
        address token;
        uint256 proposerThreshold;
    }

    struct ProposerAdapterHatsV1Params {
        address implementation;
        address hatsContract;
        uint256[] whitelistedHatIds;
    }

    struct ProposerAdapterParams {
        ProposerAdapterERC20V1Params[] proposerAdapterERC20V1Params;
        ProposerAdapterERC721V1Params[] proposerAdapterERC721V1Params;
        ProposerAdapterHatsV1Params[] proposerAdapterHatsV1Params;
    }

    struct StrategyV1Params {
        address implementation;
        uint32 votingPeriod;
        uint256 quorumThreshold;
        uint256 basisNumerator;
        address lightAccountFactory;
    }

    struct VotingAdapterERC20V1Params {
        address implementation;
        address token;
        uint256 newTokenIndex;
        uint256 weightPerToken;
    }

    struct VotingAdapterERC721V1Params {
        address implementation;
        address token;
        uint256 weightPerToken;
    }

    struct VotingAdapterParams {
        VotingAdapterERC20V1Params[] votingAdapterERC20V1Params;
        VotingAdapterERC721V1Params[] votingAdapterERC721V1Params;
    }

    struct ModuleAzoriusV1Params {
        address implementation;
        uint32 timelockPeriod;
        uint32 executionPeriod;
    }

    struct AzoriusGovernanceParams {
        ProposerAdapterParams proposerAdapterParams;
        StrategyV1Params strategyV1Params;
        VotingAdapterParams votingAdapterParams;
        ModuleAzoriusV1Params moduleAzoriusV1Params;
    }

    struct ModuleFractalV1Params {
        address implementation;
        address owner;
    }

    struct FreezeGuardMultisigV1Params {
        address implementation;
        address owner;
        uint32 timelockPeriod;
        uint32 executionPeriod;
    }

    struct FreezeGuardAzoriusV1Params {
        address implementation;
        address owner;
    }

    struct FreezeVotingMultisigV1Params {
        address implementation;
        address owner;
        uint256 freezeVotesThreshold;
        uint32 freezeProposalPeriod;
        uint32 freezePeriod;
        address parentSafe;
        address lightAccountFactory;
    }

    struct FreezeVotingAzoriusV1Params {
        address implementation;
        address owner;
        uint256 freezeVotesThreshold;
        uint32 freezeProposalPeriod;
        uint32 freezePeriod;
        address parentAzorius;
        address lightAccountFactory;
    }

    struct FreezeGuardParams {
        FreezeGuardMultisigV1Params freezeGuardMultisigV1Params;
        FreezeGuardAzoriusV1Params freezeGuardAzoriusV1Params;
    }

    struct FreezeVotingParams {
        FreezeVotingMultisigV1Params freezeVotingMultisigV1Params;
        FreezeVotingAzoriusV1Params freezeVotingAzoriusV1Params;
    }

    struct FreezeParams {
        FreezeGuardParams freezeGuardParams;
        FreezeVotingParams freezeVotingParams;
    }

    // --- Events ---

    event ProxyDeployed(address indexed proxy, address indexed implementation);

    event SystemDeployed(
        address indexed safeProxyFactory,
        bytes32 salt,
        bytes initData
    );

    // --- View Functions ---

    function predictProxyAddress(
        address implementation_,
        bytes calldata initData_,
        bytes32 salt_,
        address deployer_
    ) external view returns (address proxy);

    // --- State-Changing Functions ---

    function setupSafe(
        bytes32 salt_,
        address safeProxyFactory_,
        address systemDeployerEventEmitter_,
        VotesERC20V1Params[] calldata votesERC20V1Params_,
        AzoriusGovernanceParams calldata azoriusGovernanceParams_,
        ModuleFractalV1Params calldata moduleFractalV1Params_,
        FreezeParams calldata freezeParams_
    ) external;

    function deployProxy(
        address implementation_,
        bytes memory initData_,
        bytes32 salt_
    ) external returns (address proxy);
}
