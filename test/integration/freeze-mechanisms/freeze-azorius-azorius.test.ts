import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import hre from 'hardhat';
const { ethers } = hre;
import {
  Safe,
  Safe__factory,
  FreezeVotingAzoriusV1,
  FreezeVotingAzoriusV1__factory,
  FreezeGuardAzoriusV1,
  FreezeGuardAzoriusV1__factory,
  ModuleAzoriusV1,
  ModuleAzoriusV1__factory,
  StrategyV1,
  StrategyV1__factory,
  VotesERC20V1,
  VotesERC20V1__factory,
  ISystemDeployerV1,
} from '../../../typechain-types';
import {
  TestInfrastructure,
  deployTestInfrastructure,
  createEmptyModuleFractalParams,
  createEmptyFreezeParams,
  findEvent,
  fastForwardTime,
} from '../shared/helpers';

describe('Freeze Azorius-Azorius - Using SystemDeployer', () => {
  let deployer: SignerWithAddress;
  let parentTokenHolder1: SignerWithAddress;
  let parentTokenHolder2: SignerWithAddress;
  let parentTokenHolder3: SignerWithAddress;
  let childTokenHolder1: SignerWithAddress;
  let childTokenHolder2: SignerWithAddress;
  let childTokenHolder3: SignerWithAddress;
  let alice: SignerWithAddress;

  let infrastructure: TestInfrastructure;
  let parentSafe: Safe;
  let childSafe: Safe;
  let freezeVoting: FreezeVotingAzoriusV1;
  let freezeGuard: FreezeGuardAzoriusV1;
  let parentAzorius: ModuleAzoriusV1;
  let parentStrategy: StrategyV1;
  let parentToken: VotesERC20V1;
  let childAzorius: ModuleAzoriusV1;
  let childStrategy: StrategyV1;
  let childToken: VotesERC20V1;

  const FREEZE_VOTES_THRESHOLD = ethers.parseEther('150'); // 50% of 300 tokens
  const FREEZE_PROPOSAL_PERIOD = 3600; // 1 hour
  const FREEZE_PERIOD = 7200; // 2 hours (auto-unfreeze for Azorius)
  const PARENT_VOTING_PERIOD = 7200; // 2 hours
  const PARENT_TIMELOCK_PERIOD = 1800; // 30 minutes
  const PARENT_EXECUTION_PERIOD = 86400; // 24 hours
  const CHILD_VOTING_PERIOD = 7200; // 2 hours
  const CHILD_TIMELOCK_PERIOD = 1800; // 30 minutes
  const CHILD_EXECUTION_PERIOD = 86400; // 24 hours

  interface DeployedSafe {
    safe: Safe;
    safeAddress: string;
  }

  interface DeployedAzoriusSafe extends DeployedSafe {
    azorius: ModuleAzoriusV1;
    strategy: StrategyV1;
    token: VotesERC20V1;
  }

  interface DeployedChildSafe extends DeployedAzoriusSafe {
    freezeVoting: FreezeVotingAzoriusV1;
    freezeGuard: FreezeGuardAzoriusV1;
  }

  async function deployParentAzoriusDAO(
    infra: TestInfrastructure,
    owners: string[],
    threshold: number,
    tokenHolders: { address: string; amount: bigint }[],
  ): Promise<DeployedAzoriusSafe> {
    const saltNonce = BigInt(ethers.keccak256(ethers.randomBytes(32)));
    const salt = ethers.solidityPackedKeccak256(['uint256'], [saltNonce]);

    // Deploy governance token
    const votesERC20Params: ISystemDeployerV1.VotesERC20V1ParamsStruct[] = [
      {
        implementation: infra.implementations.votesERC20V1,
        metadata: {
          name: 'Parent Token',
          symbol: 'PARENT',
        },
        allocations: tokenHolders.map(h => ({
          to: h.address,
          amount: h.amount,
        })),
        locked: false,
        maxTotalSupply: 0,
        safeSupply: 0,
      },
    ];

    // Azorius governance parameters
    const azoriusGovernanceParams: ISystemDeployerV1.AzoriusGovernanceParamsStruct = {
      proposerAdapterParams: {
        proposerAdapterERC20V1Params: [
          {
            implementation: infra.implementations.proposerAdapterERC20V1,
            token: ethers.ZeroAddress,
            newTokenIndex: 0,
            proposerThreshold: ethers.parseEther('10'),
          },
        ],
        proposerAdapterERC721V1Params: [],
        proposerAdapterHatsV1Params: [],
      },
      strategyV1Params: {
        implementation: infra.implementations.strategyV1,
        votingPeriod: PARENT_VOTING_PERIOD,
        quorumThreshold: ethers.parseEther('150'), // 50% of 300 tokens
        basisNumerator: 500000n, // 50%
        lightAccountFactory: ethers.ZeroAddress,
      },
      votingConfigParams: {
        votingConfigERC20V1Params: [
          {
            votingWeightImplementation: infra.implementations.votingWeightERC20V1,
            voteTrackerImplementation: infra.implementations.voteTrackerERC20V1,
            token: ethers.ZeroAddress,
            newTokenIndex: 0,
            weightPerToken: 1n,
          },
        ],
        votingConfigERC721V1Params: [],
      },
      moduleAzoriusV1Params: {
        implementation: infra.implementations.moduleAzoriusV1,
        timelockPeriod: PARENT_TIMELOCK_PERIOD,
        executionPeriod: PARENT_EXECUTION_PERIOD,
      },
    };

    const moduleFractalV1Params = createEmptyModuleFractalParams();
    const freezeParams = createEmptyFreezeParams();

    const setupSafeData = infra.systemDeployer.interface.encodeFunctionData('setupSafe', [
      salt,
      await infra.safeProxyFactory.getAddress(),
      await infra.systemDeployerEventEmitter.getAddress(),
      votesERC20Params,
      azoriusGovernanceParams,
      moduleFractalV1Params,
      freezeParams,
    ]);

    const safeSetupData = infra.safeSingleton.interface.encodeFunctionData('setup', [
      owners,
      threshold,
      await infra.systemDeployer.getAddress(),
      setupSafeData,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      0,
      ethers.ZeroAddress,
    ]);

    const tx = await infra.safeProxyFactory.createProxyWithNonce(
      await infra.safeSingleton.getAddress(),
      safeSetupData,
      saltNonce,
    );

    const receipt = await tx.wait();

    const safeEvent = findEvent(receipt!.logs, infra.safeProxyFactory.interface, 'ProxyCreation');
    if (!safeEvent) throw new Error('ProxyCreation event not found');
    const safeAddress = safeEvent.args[0];
    const safe = Safe__factory.connect(safeAddress, deployer);

    const proxyDeployedEvents = receipt!.logs.filter((log: any) => {
      try {
        const parsed = infra.systemDeployer.interface.parseLog({
          topics: log.topics,
          data: log.data,
        });
        return parsed?.name === 'ProxyDeployed';
      } catch {
        return false;
      }
    });

    // Extract deployed contract addresses
    const tokenEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infra.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infra.implementations.votesERC20V1;
    });
    const tokenAddress = infra.systemDeployer.interface.parseLog({
      topics: tokenEvent.topics as string[],
      data: tokenEvent.data,
    })?.args?.[0];
    const token = VotesERC20V1__factory.connect(tokenAddress, deployer);

    const azoriusEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infra.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infra.implementations.moduleAzoriusV1;
    });
    const azoriusAddress = infra.systemDeployer.interface.parseLog({
      topics: azoriusEvent.topics as string[],
      data: azoriusEvent.data,
    })?.args?.[0];
    const azorius = ModuleAzoriusV1__factory.connect(azoriusAddress, deployer);

    const strategyEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infra.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infra.implementations.strategyV1;
    });
    const strategyAddress = infra.systemDeployer.interface.parseLog({
      topics: strategyEvent.topics as string[],
      data: strategyEvent.data,
    })?.args?.[0];
    const strategy = StrategyV1__factory.connect(strategyAddress, deployer);

    return { safe, safeAddress, azorius, strategy, token };
  }

  async function deployChildAzoriusWithFreeze(
    infra: TestInfrastructure,
    owners: string[],
    threshold: number,
    tokenHolders: { address: string; amount: bigint }[],
    parentAzoriusAddress: string,
  ): Promise<DeployedChildSafe> {
    const saltNonce = BigInt(ethers.keccak256(ethers.randomBytes(32)));
    const salt = ethers.solidityPackedKeccak256(['uint256'], [saltNonce]);

    // Deploy governance token for child
    const votesERC20Params: ISystemDeployerV1.VotesERC20V1ParamsStruct[] = [
      {
        implementation: infra.implementations.votesERC20V1,
        metadata: {
          name: 'Child Token',
          symbol: 'CHILD',
        },
        allocations: tokenHolders.map(h => ({
          to: h.address,
          amount: h.amount,
        })),
        locked: false,
        maxTotalSupply: 0,
        safeSupply: 0,
      },
    ];

    // Azorius governance parameters for child
    const azoriusGovernanceParams: ISystemDeployerV1.AzoriusGovernanceParamsStruct = {
      proposerAdapterParams: {
        proposerAdapterERC20V1Params: [
          {
            implementation: infra.implementations.proposerAdapterERC20V1,
            token: ethers.ZeroAddress,
            newTokenIndex: 0,
            proposerThreshold: ethers.parseEther('10'),
          },
        ],
        proposerAdapterERC721V1Params: [],
        proposerAdapterHatsV1Params: [],
      },
      strategyV1Params: {
        implementation: infra.implementations.strategyV1,
        votingPeriod: CHILD_VOTING_PERIOD,
        quorumThreshold: ethers.parseEther('150'), // 50% of 300 tokens
        basisNumerator: 500000n, // 50%
        lightAccountFactory: ethers.ZeroAddress,
      },
      votingConfigParams: {
        votingConfigERC20V1Params: [
          {
            votingWeightImplementation: infra.implementations.votingWeightERC20V1,
            voteTrackerImplementation: infra.implementations.voteTrackerERC20V1,
            token: ethers.ZeroAddress,
            newTokenIndex: 0,
            weightPerToken: 1n,
          },
        ],
        votingConfigERC721V1Params: [],
      },
      moduleAzoriusV1Params: {
        implementation: infra.implementations.moduleAzoriusV1,
        timelockPeriod: CHILD_TIMELOCK_PERIOD,
        executionPeriod: CHILD_EXECUTION_PERIOD,
      },
    };

    const moduleFractalV1Params = createEmptyModuleFractalParams();

    // Freeze params for child - has both freeze voting (azorius type) and freeze guard (azorius type)
    const freezeParams: ISystemDeployerV1.FreezeParamsStruct = {
      freezeGuardParams: {
        freezeGuardMultisigV1Params: {
          implementation: ethers.ZeroAddress,
          owner: ethers.ZeroAddress,
          timelockPeriod: 0,
          executionPeriod: 0,
        },
        freezeGuardAzoriusV1Params: {
          implementation: infra.implementations.freezeGuardAzoriusV1,
          owner: owners[0],
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
          implementation: infra.implementations.freezeVotingAzoriusV1,
          owner: owners[0],
          freezeVotesThreshold: FREEZE_VOTES_THRESHOLD,
          freezeProposalPeriod: FREEZE_PROPOSAL_PERIOD,
          parentAzorius: parentAzoriusAddress,
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

    const setupSafeData = infra.systemDeployer.interface.encodeFunctionData('setupSafe', [
      salt,
      await infra.safeProxyFactory.getAddress(),
      await infra.systemDeployerEventEmitter.getAddress(),
      votesERC20Params,
      azoriusGovernanceParams,
      moduleFractalV1Params,
      freezeParams,
    ]);

    const safeSetupData = infra.safeSingleton.interface.encodeFunctionData('setup', [
      owners,
      threshold,
      await infra.systemDeployer.getAddress(),
      setupSafeData,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      0,
      ethers.ZeroAddress,
    ]);

    const tx = await infra.safeProxyFactory.createProxyWithNonce(
      await infra.safeSingleton.getAddress(),
      safeSetupData,
      saltNonce,
    );

    const receipt = await tx.wait();

    // Extract Safe address
    const safeEvent = findEvent(receipt!.logs, infra.safeProxyFactory.interface, 'ProxyCreation');
    if (!safeEvent) throw new Error('ProxyCreation event not found');
    const safeAddress = safeEvent.args[0];
    const safe = Safe__factory.connect(safeAddress, deployer);

    // Parse all ProxyDeployed events
    const proxyDeployedEvents = receipt!.logs.filter((log: any) => {
      try {
        const parsed = infra.systemDeployer.interface.parseLog({
          topics: log.topics,
          data: log.data,
        });
        return parsed?.name === 'ProxyDeployed';
      } catch {
        return false;
      }
    });

    // Extract all deployed addresses
    const tokenEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infra.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infra.implementations.votesERC20V1;
    });
    const tokenAddress = infra.systemDeployer.interface.parseLog({
      topics: tokenEvent.topics as string[],
      data: tokenEvent.data,
    })?.args?.[0];
    const token = VotesERC20V1__factory.connect(tokenAddress, deployer);

    const azoriusEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infra.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infra.implementations.moduleAzoriusV1;
    });
    const azoriusAddress = infra.systemDeployer.interface.parseLog({
      topics: azoriusEvent.topics as string[],
      data: azoriusEvent.data,
    })?.args?.[0];
    const azorius = ModuleAzoriusV1__factory.connect(azoriusAddress, deployer);

    const strategyEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infra.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infra.implementations.strategyV1;
    });
    const strategyAddress = infra.systemDeployer.interface.parseLog({
      topics: strategyEvent.topics as string[],
      data: strategyEvent.data,
    })?.args?.[0];
    const strategy = StrategyV1__factory.connect(strategyAddress, deployer);

    const freezeVotingEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infra.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infra.implementations.freezeVotingAzoriusV1;
    });
    const freezeVotingAddress = infra.systemDeployer.interface.parseLog({
      topics: freezeVotingEvent.topics as string[],
      data: freezeVotingEvent.data,
    })?.args?.[0];
    const freezeVoting = FreezeVotingAzoriusV1__factory.connect(freezeVotingAddress, deployer);

    const freezeGuardEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infra.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infra.implementations.freezeGuardAzoriusV1;
    });
    const freezeGuardAddress = infra.systemDeployer.interface.parseLog({
      topics: freezeGuardEvent.topics as string[],
      data: freezeGuardEvent.data,
    })?.args?.[0];
    const freezeGuard = FreezeGuardAzoriusV1__factory.connect(freezeGuardAddress, deployer);

    return { safe, safeAddress, azorius, strategy, token, freezeVoting, freezeGuard };
  }

  async function setupTestFixture() {
    [
      deployer,
      parentTokenHolder1,
      parentTokenHolder2,
      parentTokenHolder3,
      childTokenHolder1,
      childTokenHolder2,
      childTokenHolder3,
      alice,
    ] = await ethers.getSigners();

    infrastructure = await deployTestInfrastructure(deployer);

    // Deploy parent Safe with Azorius governance
    const parentDeployment = await deployParentAzoriusDAO(
      infrastructure,
      [deployer.address], // Initial owner
      1, // Threshold
      [
        { address: parentTokenHolder1.address, amount: ethers.parseEther('100') },
        { address: parentTokenHolder2.address, amount: ethers.parseEther('100') },
        { address: parentTokenHolder3.address, amount: ethers.parseEther('100') },
      ],
    );
    parentSafe = parentDeployment.safe;
    parentAzorius = parentDeployment.azorius;
    parentStrategy = parentDeployment.strategy;
    parentToken = parentDeployment.token;

    // Deploy child Safe with Azorius and freeze mechanisms
    const childDeployment = await deployChildAzoriusWithFreeze(
      infrastructure,
      [deployer.address], // Initial owner
      1, // Threshold
      [
        { address: childTokenHolder1.address, amount: ethers.parseEther('100') },
        { address: childTokenHolder2.address, amount: ethers.parseEther('100') },
        { address: childTokenHolder3.address, amount: ethers.parseEther('100') },
      ],
      await parentAzorius.getAddress(),
    );
    childSafe = childDeployment.safe;
    childAzorius = childDeployment.azorius;
    childStrategy = childDeployment.strategy;
    childToken = childDeployment.token;
    freezeVoting = childDeployment.freezeVoting;
    freezeGuard = childDeployment.freezeGuard;

    // NOTE: FreezeVotingAzoriusV1 needs to be authorized on parent's VoteTracker
    // This is a post-deployment step that SystemDeployer can't handle atomically
    // We need to add the freeze voting contract as an authorized caller

    // Get the parent's voting configs to find the VoteTracker
    const parentVotingConfigs = await parentStrategy.votingConfigs();
    if (parentVotingConfigs.length > 0) {
      // For each voting config, we need to authorize the freeze voting contract
      // This would normally be done through a governance proposal in production
      // For testing, we'll need to find another way since VoteTracker doesn't have a direct auth method
      // TODO: This is the missing piece - VoteTracker is immutable after deployment
      // The authorized contracts are set during initialization and can't be changed
      // This is why the tests fail - we need a different approach
    }

    // Delegate voting power
    await parentToken.connect(parentTokenHolder1).delegate(parentTokenHolder1.address);
    await parentToken.connect(parentTokenHolder2).delegate(parentTokenHolder2.address);
    await parentToken.connect(parentTokenHolder3).delegate(parentTokenHolder3.address);
    await childToken.connect(childTokenHolder1).delegate(childTokenHolder1.address);
    await childToken.connect(childTokenHolder2).delegate(childTokenHolder2.address);
    await childToken.connect(childTokenHolder3).delegate(childTokenHolder3.address);

    return {
      parentSafe,
      childSafe,
      freezeVoting,
      freezeGuard,
      parentAzorius,
      parentStrategy,
      parentToken,
      childAzorius,
      childStrategy,
      childToken,
      infrastructure,
    };
  }

  describe('Deployment and Setup', () => {
    it('Should properly deploy and configure parent-child relationship', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Verify parent Safe has Azorius module
      expect(await fixture.parentSafe.isModuleEnabled(await fixture.parentAzorius.getAddress())).to
        .be.true;

      // Verify child Safe has Azorius module
      expect(await fixture.childSafe.isModuleEnabled(await fixture.childAzorius.getAddress())).to.be
        .true;

      // Verify freeze voting configuration
      expect(await fixture.freezeVoting.parentAzorius()).to.equal(
        await fixture.parentAzorius.getAddress(),
      );
      expect(await fixture.freezeVoting.freezeVotesThreshold()).to.equal(FREEZE_VOTES_THRESHOLD);
      expect(await fixture.freezeVoting.freezeProposalPeriod()).to.equal(FREEZE_PROPOSAL_PERIOD);

      // Verify freeze guard configuration
      expect(await fixture.freezeGuard.freezable()).to.equal(
        await fixture.freezeVoting.getAddress(),
      );
      expect(await fixture.childAzorius.getGuard()).to.equal(
        await fixture.freezeGuard.getAddress(),
      );
    });
  });

  describe('Freeze Voting', () => {
    it('Should allow parent token holders to vote to freeze child', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Initially not frozen
      expect(await fixture.freezeVoting.isFrozen()).to.be.false;

      // Parent token holder 1 votes to freeze (100 tokens)
      const votingConfigData = [
        {
          configIndex: 0, // First voting config (ERC20)
          voteData: '0x', // Empty for ERC20 voting
        },
      ];
      await fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(votingConfigData, 0);
      expect(await fixture.freezeVoting.isFrozen()).to.be.false; // Need 150 tokens

      // Parent token holder 2 votes to freeze (100 more tokens = 200 total) - should trigger freeze
      await fixture.freezeVoting.connect(parentTokenHolder2).castFreezeVote(votingConfigData, 0);
      expect(await fixture.freezeVoting.isFrozen()).to.be.true;
    });

    it('Should block child proposal creation when frozen', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Freeze the child
      const votingConfigData = [
        {
          configIndex: 0,
          voteData: '0x',
        },
      ];
      await fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(votingConfigData, 0);
      await fixture.freezeVoting.connect(parentTokenHolder2).castFreezeVote(votingConfigData, 0);

      // Try to create a proposal in child DAO - should fail
      const proposalData = fixture.childSafe.interface.encodeFunctionData('addOwnerWithThreshold', [
        alice.address,
        1,
      ]);

      await expect(
        fixture.childAzorius
          .connect(childTokenHolder1)
          .submitProposal(
            await fixture.childSafe.getAddress(),
            0,
            proposalData,
            '0x',
            0,
            await fixture.childStrategy.getAddress(),
          ),
      ).to.be.revertedWithCustomError(fixture.freezeGuard, 'DAOFrozen');
    });

    it('Should block child proposal execution when frozen', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Create a proposal before freezing
      const proposalData = fixture.childSafe.interface.encodeFunctionData('addOwnerWithThreshold', [
        alice.address,
        1,
      ]);

      await fixture.childAzorius.connect(childTokenHolder1).submitProposal(
        [
          {
            to: await fixture.childSafe.getAddress(),
            value: 0,
            data: proposalData,
            operation: 0,
          },
        ],
        'Test proposal',
        await fixture.childStrategy.getAddress(),
        '0x',
      );

      const proposalId = 0;

      // Vote on proposal
      await fixture.childStrategy.connect(childTokenHolder1).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );
      await fixture.childStrategy.connect(childTokenHolder2).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Wait for voting period
      await fastForwardTime(CHILD_VOTING_PERIOD + 1);

      // Finalize proposal
      await fixture.childStrategy.finalizeProposal(proposalId);

      // Freeze the child
      const votingConfigData = [
        {
          configIndex: 0,
          voteData: '0x',
        },
      ];
      await fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(votingConfigData, 0);
      await fixture.freezeVoting.connect(parentTokenHolder2).castFreezeVote(votingConfigData, 0);

      // Try to execute - should fail
      await expect(
        fixture.childAzorius.executeProposal(proposalId, [
          {
            to: await fixture.childSafe.getAddress(),
            value: 0,
            data: proposalData,
            operation: 0,
          },
        ]),
      ).to.be.revertedWithCustomError(fixture.freezeGuard, 'DAOFrozen');
    });

    it('Should auto-unfreeze after freeze period', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Freeze the child
      const votingConfigData = [
        {
          configIndex: 0,
          voteData: '0x',
        },
      ];
      await fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(votingConfigData, 0);
      await fixture.freezeVoting.connect(parentTokenHolder2).castFreezeVote(votingConfigData, 0);
      expect(await fixture.freezeVoting.isFrozen()).to.be.true;

      // Wait for freeze period to expire
      await fastForwardTime(FREEZE_PERIOD + 1);

      // Should be automatically unfrozen
      expect(await fixture.freezeVoting.isFrozen()).to.be.false;

      // Child DAO should be able to create proposals again
      const proposalData = fixture.childSafe.interface.encodeFunctionData('addOwnerWithThreshold', [
        alice.address,
        1,
      ]);

      await expect(
        fixture.childAzorius
          .connect(childTokenHolder1)
          .submitProposal(
            await fixture.childSafe.getAddress(),
            0,
            proposalData,
            '0x',
            0,
            await fixture.childStrategy.getAddress(),
          ),
      ).to.emit(fixture.childAzorius, 'ProposalCreated');
    });

    it('Should allow parent DAO to manually unfreeze via governance', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Freeze the child
      const votingConfigData = [
        {
          configIndex: 0,
          voteData: '0x',
        },
      ];
      await fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(votingConfigData, 0);
      await fixture.freezeVoting.connect(parentTokenHolder2).castFreezeVote(votingConfigData, 0);
      expect(await fixture.freezeVoting.isFrozen()).to.be.true;

      // Create unfreeze proposal in parent DAO
      const unfreezeData = fixture.freezeVoting.interface.encodeFunctionData('unfreeze');
      await fixture.parentAzorius.connect(parentTokenHolder1).submitProposal(
        [
          {
            to: await fixture.freezeVoting.getAddress(),
            value: 0,
            data: unfreezeData,
            operation: 0,
          },
        ],
        'Unfreeze child DAO',
        await fixture.parentStrategy.getAddress(),
        '0x',
      );

      const proposalId = 0;

      // Vote on proposal
      await fixture.parentStrategy.connect(parentTokenHolder1).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );
      await fixture.parentStrategy.connect(parentTokenHolder2).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Wait for voting period
      await fastForwardTime(PARENT_VOTING_PERIOD + 1);

      // Finalize proposal
      await fixture.parentStrategy.finalizeProposal(proposalId);

      // Wait for timelock
      await fastForwardTime(PARENT_TIMELOCK_PERIOD + 1);

      // Execute unfreeze
      await fixture.parentAzorius.executeProposal(proposalId, [
        {
          to: await fixture.freezeVoting.getAddress(),
          value: 0,
          data: unfreezeData,
          operation: 0,
        },
      ]);

      expect(await fixture.freezeVoting.isFrozen()).to.be.false;
    });
  });

  describe('Complex Governance Interactions', () => {
    it('Should handle simultaneous proposals in both DAOs', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Create proposal in parent DAO
      const parentProposalData = fixture.parentSafe.interface.encodeFunctionData(
        'addOwnerWithThreshold',
        [alice.address, 1],
      );
      await fixture.parentAzorius.connect(parentTokenHolder1).submitProposal(
        [
          {
            to: await fixture.parentSafe.getAddress(),
            value: 0,
            data: parentProposalData,
            operation: 0,
          },
        ],
        'Parent proposal',
        await fixture.parentStrategy.getAddress(),
        '0x',
      );

      // Create proposal in child DAO
      const childProposalData = fixture.childSafe.interface.encodeFunctionData(
        'addOwnerWithThreshold',
        [alice.address, 1],
      );
      await fixture.childAzorius
        .connect(childTokenHolder1)
        .submitProposal(
          await fixture.childSafe.getAddress(),
          0,
          childProposalData,
          '0x',
          0,
          await fixture.childStrategy.getAddress(),
        );

      // Both proposals should exist
      const parentProposal = await fixture.parentAzorius.getProposal(0);
      const childProposal = await fixture.childAzorius.getProposal(0);
      expect(parentProposal.proposer).to.equal(parentTokenHolder1.address);
      expect(childProposal.proposer).to.equal(childTokenHolder1.address);

      // Freeze the child
      const votingConfigData = [
        {
          configIndex: 0,
          voteData: '0x',
        },
      ];
      await fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(votingConfigData, 0);
      await fixture.freezeVoting.connect(parentTokenHolder2).castFreezeVote(votingConfigData, 0);

      // Parent proposal should still be executable after voting
      await fixture.parentStrategy.connect(parentTokenHolder1).vote(0, 1);
      await fixture.parentStrategy.connect(parentTokenHolder2).vote(0, 1);
      await fastForwardTime(PARENT_VOTING_PERIOD + 1);
      await fastForwardTime(PARENT_TIMELOCK_PERIOD + 1);

      await expect(
        fixture.parentAzorius.executeProposal(0, [
          {
            to: await fixture.parentSafe.getAddress(),
            value: 0,
            data: parentProposalData,
            operation: 0,
          },
        ]),
      ).to.not.be.reverted;

      // Child proposal execution should be blocked
      await fixture.childStrategy.connect(childTokenHolder1).castVote(
        0,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );
      await fixture.childStrategy.connect(childTokenHolder2).castVote(
        0,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );
      await fastForwardTime(CHILD_VOTING_PERIOD + 1);

      await expect(
        fixture.childAzorius.executeProposal(0, [
          {
            to: await fixture.childSafe.getAddress(),
            value: 0,
            data: childProposalData,
            operation: 0,
          },
        ]),
      ).to.be.revertedWithCustomError(fixture.freezeGuard, 'DAOFrozen');
    });

    it('Should track freeze cycles and timestamps', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // First freeze
      await fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(0);
      await fixture.freezeVoting.connect(parentTokenHolder2).castFreezeVote(0);
      const firstFreezeTimestamp = await fixture.freezeVoting.lastFreeze();

      // Wait for auto-unfreeze
      await fastForwardTime(FREEZE_PERIOD + 1);

      expect(await fixture.freezeVoting.isFrozen()).to.be.false;

      // Second freeze
      await fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(0);
      await fixture.freezeVoting.connect(parentTokenHolder3).castFreezeVote(0);
      const secondFreezeTimestamp = await fixture.freezeVoting.lastFreeze();

      expect(secondFreezeTimestamp).to.be.gt(firstFreezeTimestamp);
      expect(await fixture.freezeVoting.isFrozen()).to.be.true;
    });

    it('Should handle voting weight changes during freeze proposal', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Parent token holder 1 votes (100 tokens)
      await fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(0);

      // Transfer tokens from holder 3 to holder 2
      await fixture.parentToken
        .connect(parentTokenHolder3)
        .transfer(parentTokenHolder2.address, ethers.parseEther('50'));

      // Update delegation
      await fixture.parentToken.connect(parentTokenHolder2).delegate(parentTokenHolder2.address);

      // Holder 2 now has 150 tokens and can freeze alone
      await fixture.freezeVoting.connect(parentTokenHolder2).castFreezeVote(0);
      expect(await fixture.freezeVoting.isFrozen()).to.be.true;
    });

    it('Should prevent child guard removal while frozen', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Freeze the child
      const votingConfigData = [
        {
          configIndex: 0,
          voteData: '0x',
        },
      ];
      await fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(votingConfigData, 0);
      await fixture.freezeVoting.connect(parentTokenHolder2).castFreezeVote(votingConfigData, 0);

      // Try to remove guard via child governance - should fail
      await expect(
        fixture.childAzorius.connect(deployer).setGuard(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(fixture.freezeGuard, 'DAOFrozen');

      // Wait for auto-unfreeze
      await fastForwardTime(FREEZE_PERIOD + 1);

      // Now guard removal should succeed
      await fixture.childAzorius.connect(deployer).setGuard(ethers.ZeroAddress);
      expect(await fixture.childAzorius.guard()).to.equal(ethers.ZeroAddress);
    });
  });

  describe('Edge Cases', () => {
    it('Should handle freeze proposal expiry correctly', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // First vote
      await fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(0);

      // Wait for proposal to expire
      await fastForwardTime(FREEZE_PROPOSAL_PERIOD + 1);

      // Second vote should create new proposal
      await expect(fixture.freezeVoting.connect(parentTokenHolder2).castFreezeVote(0))
        .to.emit(fixture.freezeVoting, 'FreezeProposalCreated')
        .withArgs(parentTokenHolder2.address);

      // Still not frozen (new proposal needs 150 tokens)
      expect(await fixture.freezeVoting.isFrozen()).to.be.false;

      // Third vote should freeze (200 tokens total)
      await fixture.freezeVoting.connect(parentTokenHolder3).castFreezeVote(0);
      expect(await fixture.freezeVoting.isFrozen()).to.be.true;
    });

    it('Should handle zero voting weight correctly', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Non-token holder tries to vote
      await expect(
        fixture.freezeVoting.connect(alice).castFreezeVote(0),
      ).to.be.revertedWithCustomError(fixture.freezeVoting, 'NoVotingWeight');

      // Token holder with no delegation tries to vote
      await fixture.parentToken.connect(parentTokenHolder1).delegate(ethers.ZeroAddress);

      await expect(
        fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(0),
      ).to.be.revertedWithCustomError(fixture.freezeVoting, 'NoVotingWeight');
    });

    it('Should prevent double voting on same freeze proposal', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // First vote
      await fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(0);

      // Try to vote again
      await expect(
        fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(0),
      ).to.be.revertedWithCustomError(fixture.freezeVoting, 'AlreadyVoted');
    });
  });
});
