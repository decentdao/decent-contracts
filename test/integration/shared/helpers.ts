import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { Signature } from 'ethers';
import { ethers } from 'hardhat';
import {
  ISystemDeployerV1,
  Safe,
  Safe__factory,
  SafeProxyFactory,
  SafeProxyFactory__factory,
  SystemDeployerEventEmitterV1,
  SystemDeployerEventEmitterV1__factory,
  SystemDeployerV1,
  SystemDeployerV1__factory,
  VotesERC20V1,
  VotesERC20V1__factory,
  MockLightAccountFactory__factory,
  ProposerAdapterERC20V1__factory,
  ProposerAdapterERC721V1__factory,
  ProposerAdapterHatsV1__factory,
  VotingWeightERC20V1__factory,
  VoteTrackerERC20V1__factory,
  VotingWeightERC721V1__factory,
  VoteTrackerERC721V1__factory,
  StrategyV1__factory,
  ModuleAzoriusV1__factory,
  FreezeGuardMultisigV1__factory,
  FreezeGuardAzoriusV1__factory,
  FreezeVotingMultisigV1__factory,
  FreezeVotingAzoriusV1__factory,
  FreezeVotingStandaloneV1__factory,
} from '../../../typechain-types';

// Common test infrastructure types
export interface TestInfrastructure {
  systemDeployer: SystemDeployerV1;
  systemDeployerEventEmitter: SystemDeployerEventEmitterV1;
  safeProxyFactory: SafeProxyFactory;
  safeSingleton: Safe;
  implementations: {
    votesERC20V1: string;
    proposerAdapterERC20V1: string;
    proposerAdapterERC721V1: string;
    proposerAdapterHatsV1: string;
    votingWeightERC20V1: string;
    voteTrackerERC20V1: string;
    votingWeightERC721V1: string;
    voteTrackerERC721V1: string;
    strategyV1: string;
    moduleAzoriusV1: string;
    freezeGuardMultisigV1: string;
    freezeGuardAzoriusV1: string;
    freezeVotingMultisigV1: string;
    freezeVotingAzoriusV1: string;
    freezeVotingStandaloneV1: string;
  };
  lightAccountFactory: string;
}

export interface BaseSigners {
  deployer: SignerWithAddress;
  alice: SignerWithAddress;
  bob: SignerWithAddress;
  charlie: SignerWithAddress;
  eve: SignerWithAddress;
  frank: SignerWithAddress;
}

/**
 * Deploys the common test infrastructure used by all governance types
 */
export async function deployTestInfrastructure(
  deployer: SignerWithAddress,
): Promise<TestInfrastructure> {
  // Deploy Safe infrastructure
  const safeSingleton = await new Safe__factory(deployer).deploy();
  const safeProxyFactory = await new SafeProxyFactory__factory(deployer).deploy();

  // Deploy SystemDeployer infrastructure
  const systemDeployer = await new SystemDeployerV1__factory(deployer).deploy();
  const systemDeployerEventEmitter = await new SystemDeployerEventEmitterV1__factory(
    deployer,
  ).deploy();

  // Deploy mock light account factory
  const lightAccountFactory = await new MockLightAccountFactory__factory(deployer).deploy();

  // Deploy all implementation contracts
  const votesERC20V1 = await new VotesERC20V1__factory(deployer).deploy();
  const proposerAdapterERC20V1 = await new ProposerAdapterERC20V1__factory(deployer).deploy();
  const proposerAdapterERC721V1 = await new ProposerAdapterERC721V1__factory(deployer).deploy();
  const proposerAdapterHatsV1 = await new ProposerAdapterHatsV1__factory(deployer).deploy();
  const votingWeightERC20V1 = await new VotingWeightERC20V1__factory(deployer).deploy();
  const voteTrackerERC20V1 = await new VoteTrackerERC20V1__factory(deployer).deploy();
  const votingWeightERC721V1 = await new VotingWeightERC721V1__factory(deployer).deploy();
  const voteTrackerERC721V1 = await new VoteTrackerERC721V1__factory(deployer).deploy();
  const strategyV1 = await new StrategyV1__factory(deployer).deploy();
  const moduleAzoriusV1 = await new ModuleAzoriusV1__factory(deployer).deploy();
  // Deploy freeze implementations
  const freezeGuardMultisigV1 = await new FreezeGuardMultisigV1__factory(deployer).deploy();
  const freezeGuardAzoriusV1 = await new FreezeGuardAzoriusV1__factory(deployer).deploy();
  const freezeVotingMultisigV1 = await new FreezeVotingMultisigV1__factory(deployer).deploy();
  const freezeVotingAzoriusV1 = await new FreezeVotingAzoriusV1__factory(deployer).deploy();
  const freezeVotingStandaloneV1 = await new FreezeVotingStandaloneV1__factory(deployer).deploy();

  return {
    systemDeployer,
    systemDeployerEventEmitter,
    safeProxyFactory,
    safeSingleton,
    implementations: {
      votesERC20V1: await votesERC20V1.getAddress(),
      proposerAdapterERC20V1: await proposerAdapterERC20V1.getAddress(),
      proposerAdapterERC721V1: await proposerAdapterERC721V1.getAddress(),
      proposerAdapterHatsV1: await proposerAdapterHatsV1.getAddress(),
      votingWeightERC20V1: await votingWeightERC20V1.getAddress(),
      voteTrackerERC20V1: await voteTrackerERC20V1.getAddress(),
      votingWeightERC721V1: await votingWeightERC721V1.getAddress(),
      voteTrackerERC721V1: await voteTrackerERC721V1.getAddress(),
      strategyV1: await strategyV1.getAddress(),
      moduleAzoriusV1: await moduleAzoriusV1.getAddress(),
      freezeGuardMultisigV1: await freezeGuardMultisigV1.getAddress(),
      freezeGuardAzoriusV1: await freezeGuardAzoriusV1.getAddress(),
      freezeVotingMultisigV1: await freezeVotingMultisigV1.getAddress(),
      freezeVotingAzoriusV1: await freezeVotingAzoriusV1.getAddress(),
      freezeVotingStandaloneV1: await freezeVotingStandaloneV1.getAddress(),
    },
    lightAccountFactory: lightAccountFactory.target as string,
  };
}

/**
 * Sets up common test signers
 */
export async function getTestSigners(): Promise<BaseSigners> {
  const [deployer, alice, bob, charlie, eve, frank] = await ethers.getSigners();
  return { deployer, alice, bob, charlie, eve, frank };
}

/**
 * Mines a specified number of blocks
 */
export async function mineBlocks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await ethers.provider.send('evm_mine', []);
  }
}

/**
 * Creates empty freeze parameters for DAOs that don't use freeze functionality
 */
export function createEmptyFreezeParams(): ISystemDeployerV1.FreezeParamsStruct {
  return {
    freezeGuardParams: {
      freezeGuardMultisigV1Params: {
        implementation: ethers.ZeroAddress,
        owner: ethers.ZeroAddress,
        timelockPeriod: 0,
        executionPeriod: 0,
      },
      freezeGuardAzoriusV1Params: {
        implementation: ethers.ZeroAddress,
        owner: ethers.ZeroAddress,
      },
    },
    freezeVotingParams: {
      freezeVotingMultisigV1Params: {
        implementation: ethers.ZeroAddress,
        owner: ethers.ZeroAddress,
        freezeVotesThreshold: 0,
        freezeProposalPeriod: 0,
        parentSafe: ethers.ZeroAddress,
        lightAccountFactory: ethers.ZeroAddress,
      },
      freezeVotingAzoriusV1Params: {
        implementation: ethers.ZeroAddress,
        owner: ethers.ZeroAddress,
        freezeVotesThreshold: 0,
        freezeProposalPeriod: 0,
        parentAzorius: ethers.ZeroAddress,
        lightAccountFactory: ethers.ZeroAddress,
      },
      freezeVotingStandaloneParams: {
        freezeVotingStandaloneV1Params: {
          implementation: ethers.ZeroAddress,
          freezeVotesThreshold: 0,
          unfreezeVotesThreshold: 0,
          freezeProposalPeriod: 0,
          unfreezeProposalPeriod: 0,
          lightAccountFactory: ethers.ZeroAddress,
        },
        votingConfigParams: {
          votingConfigERC20V1Params: [],
          votingConfigERC721V1Params: [],
        },
      },
    },
  };
}

/**
 * Creates empty ModuleFractal parameters for DAOs that don't use parent-child relationships
 */
export function createEmptyModuleFractalParams(): ISystemDeployerV1.ModuleFractalV1ParamsStruct {
  return {
    implementation: ethers.ZeroAddress,
    owner: ethers.ZeroAddress,
  };
}

/**
 * Helper to find and parse events from transaction receipts
 */
export function findEvent(logs: any[], contractInterface: any, eventName: string): any | undefined {
  const event = logs.find(log => {
    try {
      const parsedLog = contractInterface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsedLog?.name === eventName;
    } catch {
      return false;
    }
  });

  if (!event) return undefined;

  return contractInterface.parseLog({
    topics: event.topics,
    data: event.data,
  });
}

/**
 * Helper to extract proposal ID from ProposalCreated event
 */
export function extractProposalId(receipt: any, azoriusInterface: any): number {
  const event = findEvent(receipt.logs, azoriusInterface, 'ProposalCreated');
  if (!event) throw new Error('ProposalCreated event not found');
  return event.args[1];
}

/**
 * Helper to fast forward time in tests
 */
export async function fastForwardTime(seconds: number): Promise<void> {
  await ethers.provider.send('evm_increaseTime', [seconds]);
  await ethers.provider.send('evm_mine', []);
}

/**
 * Common proposal transaction structure for testing
 */
export interface TestProposalTransaction {
  to: string;
  value: bigint;
  data: string;
  operation: number;
}

/**
 * Creates a simple ETH transfer transaction for testing
 */
export function createTestTransaction(
  to: string,
  value: bigint = ethers.parseEther('1'),
): TestProposalTransaction {
  return {
    to,
    value,
    data: '0x',
    operation: 0,
  };
}

/**
 * Helper to fund a Safe with ETH for testing
 */
export async function fundSafe(
  signer: SignerWithAddress,
  safeAddress: string,
  amount: bigint = ethers.parseEther('10'),
): Promise<void> {
  await signer.sendTransaction({
    to: safeAddress,
    value: amount,
  });
}

/**
 * Common deployment parameters that can be reused across tests
 */
export const DEFAULT_GOVERNANCE_PARAMS = {
  votingPeriod: 3600, // 1 hour
  timelockPeriod: 1800, // 30 minutes
  executionPeriod: 86400, // 1 day
  basisNumerator: 500000n, // 50%
};

/**
 * Delegate tokens for a user to activate their voting power
 */
export async function delegateTokens(token: VotesERC20V1, user: SignerWithAddress): Promise<void> {
  await token.connect(user).delegate(user.address);
}

/**
 * Helper to create sorted signatures for Safe transactions
 * @param signerAddresses Array of signer addresses
 * @param signatures Array of Signature objects (use Signature.from() to convert string signatures)
 * @returns Combined signature bytes for Safe transaction
 */
export function createSafeSignatures(signerAddresses: string[], signatures: Signature[]): string {
  // Pair addresses with signatures and sort by address
  const signerData = signerAddresses
    .map((address, index) => ({ address, signature: signatures[index] }))
    .sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1));

  // Concatenate signatures in sorted order
  let combinedSignatures = '0x';
  for (const data of signerData) {
    combinedSignatures +=
      data.signature.r.slice(2) +
      data.signature.s.slice(2) +
      ethers.toBeHex(data.signature.v + 4, 1).slice(2); // Add 4 for eth_sign
  }
  return combinedSignatures;
}

/**
 * Helper to create standalone freeze voting parameters
 */
export function createStandaloneFreezeParams(
  infrastructure: TestInfrastructure,
  params: {
    freezeVotesThreshold: bigint;
    unfreezeVotesThreshold: bigint;
    freezeProposalPeriod: number;
    unfreezeProposalPeriod: number;
    votingConfigERC20Params?: ISystemDeployerV1.VotingConfigERC20V1ParamsStruct[];
  },
): ISystemDeployerV1.FreezeParamsStruct {
  return {
    freezeGuardParams: {
      freezeGuardMultisigV1Params: {
        implementation: infrastructure.implementations.freezeGuardMultisigV1,
        owner: ethers.ZeroAddress, // Will be set to freeze voting address
        timelockPeriod: DEFAULT_GOVERNANCE_PARAMS.timelockPeriod,
        executionPeriod: DEFAULT_GOVERNANCE_PARAMS.executionPeriod,
      },
      freezeGuardAzoriusV1Params: {
        implementation: ethers.ZeroAddress,
        owner: ethers.ZeroAddress,
      },
    },
    freezeVotingParams: {
      freezeVotingMultisigV1Params: {
        implementation: ethers.ZeroAddress,
        owner: ethers.ZeroAddress,
        freezeVotesThreshold: 0,
        freezeProposalPeriod: 0,
        parentSafe: ethers.ZeroAddress,
        lightAccountFactory: ethers.ZeroAddress,
      },
      freezeVotingAzoriusV1Params: {
        implementation: ethers.ZeroAddress,
        owner: ethers.ZeroAddress,
        freezeVotesThreshold: 0,
        freezeProposalPeriod: 0,
        parentAzorius: ethers.ZeroAddress,
        lightAccountFactory: ethers.ZeroAddress,
      },
      freezeVotingStandaloneParams: {
        freezeVotingStandaloneV1Params: {
          implementation: infrastructure.implementations.freezeVotingStandaloneV1,
          freezeVotesThreshold: params.freezeVotesThreshold,
          unfreezeVotesThreshold: params.unfreezeVotesThreshold,
          freezeProposalPeriod: params.freezeProposalPeriod,
          unfreezeProposalPeriod: params.unfreezeProposalPeriod,
          lightAccountFactory: infrastructure.lightAccountFactory,
        },
        votingConfigParams: {
          votingConfigERC20V1Params: params.votingConfigERC20Params || [],
          votingConfigERC721V1Params: [],
        },
      },
    },
  };
}
