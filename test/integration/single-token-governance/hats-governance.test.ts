import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ISystemDeployerV1,
  ModuleAzoriusV1,
  ModuleAzoriusV1__factory,
  Safe,
  Safe__factory,
  StrategyV1,
  StrategyV1__factory,
  VotesERC20V1,
  VotesERC20V1__factory,
  MockHats,
  MockHats__factory,
} from '../../../typechain-types';
import {
  TestInfrastructure,
  BaseSigners,
  deployTestInfrastructure,
  getTestSigners,
  createEmptyFreezeParams,
  createEmptyModuleFractalParams,
  findEvent,
  extractProposalId,
  fastForwardTime,
  createTestTransaction,
  fundSafe,
  DEFAULT_GOVERNANCE_PARAMS,
  delegateTokens,
} from '../shared/helpers';

// Hat IDs for different roles
const ADMIN_HAT = 1n;
const MANAGER_HAT = 2n;
const MEMBER_HAT = 3n;

// Hats-specific types
interface DeployedHatsDAO {
  safeAddress: string;
  safe: Safe;
  token: VotesERC20V1;
  hats: MockHats;
  azorius: ModuleAzoriusV1;
  strategy: StrategyV1;
  proposerAdapterAddress: string;
}

describe('Hats Governance Integration Tests', () => {
  let signers: BaseSigners;

  async function deployHatsDAO(params: {
    infrastructure: TestInfrastructure;
    signers: BaseSigners;
    owners: string[];
    threshold: number;
    tokenName: string;
    tokenSymbol: string;
    tokenAllocations: { to: string; amount: bigint }[];
    whitelistedHats: bigint[];
    hatAssignments: { user: string; hatId: bigint }[];
    votingPeriod: number;
    quorumThreshold: bigint;
    basisNumerator: bigint;
    timelockPeriod: number;
    executionPeriod: number;
  }): Promise<DeployedHatsDAO> {
    const { infrastructure } = params;

    // Deploy Mock Hats Protocol contract
    const hats = await new MockHats__factory(params.signers.deployer).deploy();

    // Set up hat wearers
    for (const assignment of params.hatAssignments) {
      await hats.setWearerStatus(assignment.user, assignment.hatId, true);
    }

    // Create deployment parameters
    const salt = ethers.keccak256(ethers.randomBytes(32));

    const votesERC20Params: ISystemDeployerV1.VotesERC20V1ParamsStruct[] = [
      {
        implementation: infrastructure.implementations.votesERC20V1,
        metadata: {
          name: params.tokenName,
          symbol: params.tokenSymbol,
        },
        allocations: params.tokenAllocations,
        locked: false,
        maxTotalSupply: ethers.parseEther('10000'),
        safeSupply: ethers.parseEther('100'),
      },
    ];

    const azoriusGovernanceParams: ISystemDeployerV1.AzoriusGovernanceParamsStruct = {
      proposerAdapterParams: {
        proposerAdapterERC20V1Params: [],
        proposerAdapterERC721V1Params: [],
        proposerAdapterHatsV1Params: [
          {
            implementation: infrastructure.implementations.proposerAdapterHatsV1,
            hatsContract: await hats.getAddress(),
            whitelistedHatIds: params.whitelistedHats,
          },
        ],
      },
      strategyV1Params: {
        implementation: infrastructure.implementations.strategyV1,
        votingPeriod: params.votingPeriod,
        quorumThreshold: params.quorumThreshold,
        basisNumerator: params.basisNumerator,
        lightAccountFactory: infrastructure.lightAccountFactory,
      },
      votingConfigParams: {
        votingConfigERC20V1Params: [
          {
            votingWeightImplementation: infrastructure.implementations.votingWeightERC20V1,
            voteTrackerImplementation: infrastructure.implementations.voteTrackerERC20V1,
            token: ethers.ZeroAddress, // Will use newly deployed token
            newTokenIndex: 0,
            weightPerToken: 1n,
          },
        ],
        votingConfigERC721V1Params: [],
      },
      moduleAzoriusV1Params: {
        implementation: infrastructure.implementations.moduleAzoriusV1,
        timelockPeriod: params.timelockPeriod,
        executionPeriod: params.executionPeriod,
      },
    };

    // Empty params for features we're not using
    const moduleFractalV1Params = createEmptyModuleFractalParams();
    const freezeParams = createEmptyFreezeParams();

    // Encode setupSafe function call
    const setupSafeData = infrastructure.systemDeployer.interface.encodeFunctionData('setupSafe', [
      salt,
      await infrastructure.safeProxyFactory.getAddress(),
      await infrastructure.systemDeployerEventEmitter.getAddress(),
      votesERC20Params,
      azoriusGovernanceParams,
      moduleFractalV1Params,
      freezeParams,
    ]);

    // Create Safe setup parameters
    const safeSetupData = infrastructure.safeSingleton.interface.encodeFunctionData('setup', [
      params.owners,
      params.threshold,
      await infrastructure.systemDeployer.getAddress(),
      setupSafeData,
      ethers.ZeroAddress, // fallbackHandler
      ethers.ZeroAddress, // paymentToken
      0, // payment
      ethers.ZeroAddress, // paymentReceiver
    ]);

    // Deploy the Safe with DAO setup
    const tx = await infrastructure.safeProxyFactory.createProxyWithNonce(
      await infrastructure.safeSingleton.getAddress(),
      safeSetupData,
      ethers.toBigInt(salt),
    );

    const receipt = await tx.wait();
    if (!receipt) throw new Error('Transaction receipt is null');

    // Extract Safe address from ProxyCreation event
    const proxyCreationEvent = findEvent(
      receipt.logs,
      infrastructure.safeProxyFactory.interface,
      'ProxyCreation',
    );
    if (!proxyCreationEvent) throw new Error('ProxyCreation event not found');
    const safeAddress = proxyCreationEvent.args[0];

    // Extract deployed contract addresses from events
    const proxyDeployedEvents = receipt.logs.filter(log => {
      try {
        const parsedLog = infrastructure.systemDeployer.interface.parseLog({
          topics: log.topics,
          data: log.data,
        });
        return parsedLog?.name === 'ProxyDeployed';
      } catch {
        return false;
      }
    });

    // Expected order: Token, ProposerAdapter, Strategy, VotingWeight, VoteTracker, Azorius
    if (proxyDeployedEvents.length !== 6) {
      throw new Error(`Expected 6 ProxyDeployed events, got ${proxyDeployedEvents.length}`);
    }

    const addresses = proxyDeployedEvents.map(event => {
      const parsedLog = infrastructure.systemDeployer.interface.parseLog({
        topics: event.topics,
        data: event.data,
      });
      return parsedLog?.args[0];
    });

    const [tokenAddress, proposerAdapterAddress, strategyAddress, , , azoriusAddress] = addresses;

    // Connect to deployed contracts
    const safe = Safe__factory.connect(safeAddress, signers.deployer);
    const token = VotesERC20V1__factory.connect(tokenAddress, signers.deployer);
    const azorius = ModuleAzoriusV1__factory.connect(azoriusAddress, signers.deployer);
    const strategy = StrategyV1__factory.connect(strategyAddress, signers.deployer);

    return {
      safeAddress,
      safe,
      token,
      hats,
      azorius,
      strategy,
      proposerAdapterAddress,
    };
  }

  async function setupTestFixture() {
    signers = await getTestSigners();
    const infrastructure = await deployTestInfrastructure(signers.deployer);

    const dao = await deployHatsDAO({
      infrastructure,
      signers,
      owners: [signers.deployer.address],
      threshold: 1,
      tokenName: 'Test DAO Token',
      tokenSymbol: 'TEST',
      tokenAllocations: [
        { to: signers.alice.address, amount: ethers.parseEther('100') },
        { to: signers.bob.address, amount: ethers.parseEther('100') },
        { to: signers.charlie.address, amount: ethers.parseEther('50') },
      ],
      whitelistedHats: [ADMIN_HAT, MANAGER_HAT], // Only admins and managers can propose
      hatAssignments: [
        { user: signers.alice.address, hatId: ADMIN_HAT },
        { user: signers.alice.address, hatId: MANAGER_HAT }, // Alice has both hats
        { user: signers.bob.address, hatId: MANAGER_HAT },
        { user: signers.charlie.address, hatId: MEMBER_HAT }, // Charlie can't propose
      ],
      votingPeriod: DEFAULT_GOVERNANCE_PARAMS.votingPeriod,
      quorumThreshold: ethers.parseEther('100'), // 100 tokens
      basisNumerator: DEFAULT_GOVERNANCE_PARAMS.basisNumerator,
      timelockPeriod: DEFAULT_GOVERNANCE_PARAMS.timelockPeriod,
      executionPeriod: DEFAULT_GOVERNANCE_PARAMS.executionPeriod,
    });

    // All users delegate to themselves to activate their voting power
    await delegateTokens(dao.token, signers.alice);
    await delegateTokens(dao.token, signers.bob);
    await delegateTokens(dao.token, signers.charlie);

    return { infrastructure, dao };
  }

  describe('DAO Deployment', () => {
    it('Should deploy a basic Hats governance DAO', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Verify Safe was deployed
      expect(dao.safeAddress).to.not.equal(ethers.ZeroAddress);
      expect(await dao.safe.getThreshold()).to.equal(1);

      // Verify Azorius is enabled as a module on the Safe
      expect(await dao.safe.isModuleEnabled(await dao.azorius.getAddress())).to.be.true;

      // Verify basic Azorius configuration
      expect(await dao.azorius.strategy()).to.equal(await dao.strategy.getAddress());
      expect(await dao.azorius.timelockPeriod()).to.equal(1800);
      expect(await dao.azorius.executionPeriod()).to.equal(86400);
    });

    it('Should correctly distribute tokens to allocations', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Check token balances
      expect(await dao.token.balanceOf(signers.alice.address)).to.equal(ethers.parseEther('100'));
      expect(await dao.token.balanceOf(signers.bob.address)).to.equal(ethers.parseEther('100'));
      expect(await dao.token.balanceOf(signers.charlie.address)).to.equal(ethers.parseEther('50'));
      expect(await dao.token.balanceOf(dao.safeAddress)).to.equal(ethers.parseEther('100'));
    });

    it('Should configure strategy with correct parameters', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      expect(await dao.strategy.votingPeriod()).to.equal(3600);
      expect(await dao.strategy.quorumThreshold()).to.equal(ethers.parseEther('100'));
      expect(await dao.strategy.basisNumerator()).to.equal(500000n);
    });

    it('Should set up hat assignments correctly', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Verify hat assignments
      expect(await dao.hats.isWearerOfHat(signers.alice.address, ADMIN_HAT)).to.be.true;
      expect(await dao.hats.isWearerOfHat(signers.alice.address, MANAGER_HAT)).to.be.true;
      expect(await dao.hats.isWearerOfHat(signers.bob.address, MANAGER_HAT)).to.be.true;
      expect(await dao.hats.isWearerOfHat(signers.charlie.address, MEMBER_HAT)).to.be.true;

      // Verify non-assignments
      expect(await dao.hats.isWearerOfHat(signers.bob.address, ADMIN_HAT)).to.be.false;
      expect(await dao.hats.isWearerOfHat(signers.charlie.address, ADMIN_HAT)).to.be.false;
      expect(await dao.hats.isWearerOfHat(signers.charlie.address, MANAGER_HAT)).to.be.false;
    });
  });

  describe('Proposal Creation', () => {
    it('Should allow users with whitelisted hats to create proposals', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      // Alice can propose using ADMIN_HAT
      const adminHatData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [ADMIN_HAT]);

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Admin proposal',
          dao.proposerAdapterAddress,
          adminHatData,
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = findEvent(
        receipt!.logs,
        dao.azorius.interface,
        'ProposalCreated',
      );

      expect(proposalCreatedEvent).to.not.be.undefined;
      const proposalId = proposalCreatedEvent!.args[1];

      // Verify proposal state is ACTIVE (0)
      expect(await dao.azorius.proposalState(proposalId)).to.equal(0);
    });

    it('Should allow users to propose with different whitelisted hats', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      // Alice can propose using MANAGER_HAT instead of ADMIN_HAT
      const managerHatData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [MANAGER_HAT]);

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Manager proposal',
          dao.proposerAdapterAddress,
          managerHatData,
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = findEvent(
        receipt!.logs,
        dao.azorius.interface,
        'ProposalCreated',
      );

      expect(proposalCreatedEvent).to.not.be.undefined;
      expect(await dao.azorius.proposalState(proposalCreatedEvent!.args[1])).to.equal(0);
    });

    it('Should allow different users with same hat to create proposals', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.charlie.address)];

      // Bob can propose using MANAGER_HAT
      const managerHatData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [MANAGER_HAT]);

      const tx = await dao.azorius
        .connect(signers.bob)
        .submitProposal(
          proposalTransactions,
          'Bob manager proposal',
          dao.proposerAdapterAddress,
          managerHatData,
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = findEvent(
        receipt!.logs,
        dao.azorius.interface,
        'ProposalCreated',
      );

      expect(proposalCreatedEvent).to.not.be.undefined;
      expect(await dao.azorius.proposalState(proposalCreatedEvent!.args[1])).to.equal(0);
    });

    it('Should reject proposals from users with non-whitelisted hats', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      // Charlie tries to propose using MEMBER_HAT (not whitelisted)
      const memberHatData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [MEMBER_HAT]);

      await expect(
        dao.azorius
          .connect(signers.charlie)
          .submitProposal(
            proposalTransactions,
            'Should fail',
            dao.proposerAdapterAddress,
            memberHatData,
          ),
      ).to.be.reverted;
    });

    it('Should reject proposals from users claiming hats they do not wear', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      // Bob tries to propose using ADMIN_HAT (he doesn't wear it)
      const adminHatData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [ADMIN_HAT]);

      await expect(
        dao.azorius
          .connect(signers.bob)
          .submitProposal(
            proposalTransactions,
            'Should fail',
            dao.proposerAdapterAddress,
            adminHatData,
          ),
      ).to.be.reverted;
    });

    it('Should reject proposals with invalid hat data encoding', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      // Invalid data encoding (not uint256)
      const invalidHatData = '0x1234';

      await expect(
        dao.azorius
          .connect(signers.alice)
          .submitProposal(
            proposalTransactions,
            'Should fail',
            dao.proposerAdapterAddress,
            invalidHatData,
          ),
      ).to.be.reverted;
    });
  });

  describe('Voting Process', () => {
    async function setupProposal() {
      const { dao } = await loadFixture(setupTestFixture);

      // Fund the Safe so it can send ETH
      await fundSafe(signers.deployer, dao.safeAddress);

      // Alice creates a proposal using ADMIN_HAT
      const proposalTransactions = [createTestTransaction(signers.bob.address)];
      const adminHatData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [ADMIN_HAT]);

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Send 1 ETH to Bob',
          dao.proposerAdapterAddress,
          adminHatData,
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      return { dao, proposalId, proposalTransactions };
    }

    it('Should allow token holders to cast YES votes (voting separate from proposal creation)', async () => {
      const { dao, proposalId } = await setupProposal();

      // Charlie can vote even though he cannot propose (voting uses tokens, not hats)
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('50')); // Charlie's tokens
      expect(votingDetails.noVotes).to.equal(0);
      expect(votingDetails.abstainVotes).to.equal(0);
    });

    it('Should allow token holders to cast NO votes', async () => {
      const { dao, proposalId } = await setupProposal();

      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        0, // NO
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(0);
      expect(votingDetails.noVotes).to.equal(ethers.parseEther('100'));
      expect(votingDetails.abstainVotes).to.equal(0);
    });

    it('Should allow token holders to cast ABSTAIN votes', async () => {
      const { dao, proposalId } = await setupProposal();

      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        2, // ABSTAIN
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(0);
      expect(votingDetails.noVotes).to.equal(0);
      expect(votingDetails.abstainVotes).to.equal(ethers.parseEther('100'));
    });

    it('Should prevent double voting', async () => {
      const { dao, proposalId } = await setupProposal();

      // First vote should succeed
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Second vote should fail
      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          0, // NO
          [{ configIndex: 0, voteData: '0x' }],
          0,
        ),
      ).to.be.reverted;
    });
  });

  describe('Hat Management', () => {
    it('Should handle hat transfers affecting proposal creation', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Initially, Bob can propose with MANAGER_HAT
      const proposalTransactions = [createTestTransaction(signers.alice.address)];
      const managerHatData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [MANAGER_HAT]);

      const tx1 = await dao.azorius
        .connect(signers.bob)
        .submitProposal(
          proposalTransactions,
          'Bob can propose',
          dao.proposerAdapterAddress,
          managerHatData,
        );

      const receipt1 = await tx1.wait();
      const proposalCreatedEvent1 = findEvent(
        receipt1!.logs,
        dao.azorius.interface,
        'ProposalCreated',
      );
      expect(proposalCreatedEvent1).to.not.be.undefined;

      // Remove Bob's MANAGER_HAT
      await dao.hats.setWearerStatus(signers.bob.address, MANAGER_HAT, false);

      // Now Bob cannot propose
      await expect(
        dao.azorius
          .connect(signers.bob)
          .submitProposal(
            proposalTransactions,
            'Should fail',
            dao.proposerAdapterAddress,
            managerHatData,
          ),
      ).to.be.reverted;
    });

    it('Should handle new hat assignments', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Initially, Charlie cannot propose with MANAGER_HAT
      const proposalTransactions = [createTestTransaction(signers.alice.address)];
      const managerHatData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [MANAGER_HAT]);

      await expect(
        dao.azorius
          .connect(signers.charlie)
          .submitProposal(
            proposalTransactions,
            'Should fail',
            dao.proposerAdapterAddress,
            managerHatData,
          ),
      ).to.be.reverted;

      // Give Charlie the MANAGER_HAT
      await dao.hats.setWearerStatus(signers.charlie.address, MANAGER_HAT, true);

      // Now Charlie can propose
      const tx = await dao.azorius
        .connect(signers.charlie)
        .submitProposal(
          proposalTransactions,
          'Charlie can now propose',
          dao.proposerAdapterAddress,
          managerHatData,
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = findEvent(
        receipt!.logs,
        dao.azorius.interface,
        'ProposalCreated',
      );
      expect(proposalCreatedEvent).to.not.be.undefined;
    });

    it('Should handle users with multiple hats', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      // Alice can propose using either ADMIN_HAT or MANAGER_HAT
      const adminHatData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [ADMIN_HAT]);
      const managerHatData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [MANAGER_HAT]);

      // Create proposal with ADMIN_HAT
      const tx1 = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Admin proposal',
          dao.proposerAdapterAddress,
          adminHatData,
        );

      const receipt1 = await tx1.wait();
      const proposalCreatedEvent1 = findEvent(
        receipt1!.logs,
        dao.azorius.interface,
        'ProposalCreated',
      );
      expect(proposalCreatedEvent1).to.not.be.undefined;

      // Create another proposal with MANAGER_HAT
      const tx2 = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Manager proposal',
          dao.proposerAdapterAddress,
          managerHatData,
        );

      const receipt2 = await tx2.wait();
      const proposalCreatedEvent2 = findEvent(
        receipt2!.logs,
        dao.azorius.interface,
        'ProposalCreated',
      );
      expect(proposalCreatedEvent2).to.not.be.undefined;

      // Both proposals should be active
      expect(await dao.azorius.proposalState(proposalCreatedEvent1!.args[1])).to.equal(0);
      expect(await dao.azorius.proposalState(proposalCreatedEvent2!.args[1])).to.equal(0);
    });
  });

  describe('Edge Cases & Error Conditions', () => {
    it('Should fail proposals that do not meet quorum threshold', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];
      const adminHatData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [ADMIN_HAT]);

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Should fail - no quorum',
          dao.proposerAdapterAddress,
          adminHatData,
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Charlie votes YES (only 50 tokens, quorum needs 100)
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Fast forward past voting period
      await fastForwardTime(3601);

      // Should be FAILED due to insufficient quorum
      expect(await dao.azorius.proposalState(proposalId)).to.equal(5); // FAILED
      expect(await dao.strategy.isQuorumMet(proposalId)).to.be.false;
    });

    it('Should fail proposals that do not meet basis threshold', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];
      const adminHatData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [ADMIN_HAT]);

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Should fail - insufficient basis',
          dao.proposerAdapterAddress,
          adminHatData,
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice votes YES (100 tokens), Bob votes NO (100 tokens) - creates 50/50 split
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        0, // NO
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Charlie abstains (provides quorum but doesn't affect basis)
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        2, // ABSTAIN
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Fast forward past voting period
      await fastForwardTime(3601);

      // Should be FAILED due to insufficient basis (50% YES vs 50% NO, need >50%)
      expect(await dao.azorius.proposalState(proposalId)).to.equal(5); // FAILED
      expect(await dao.strategy.isQuorumMet(proposalId)).to.be.true;
      expect(await dao.strategy.isBasisMet(proposalId)).to.be.false;
    });

    it('Should expire proposals after execution period', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];
      const adminHatData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [ADMIN_HAT]);

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Should expire',
          dao.proposerAdapterAddress,
          adminHatData,
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Cast enough votes to pass
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Fast forward past voting period + timelock period + execution period
      await fastForwardTime(3600 + 1800 + 86400 + 1);

      // Should be EXPIRED
      expect(await dao.azorius.proposalState(proposalId)).to.equal(4); // EXPIRED

      // Execution should fail
      await expect(dao.azorius.executeProposal(proposalId, proposalTransactions)).to.be.reverted;
    });

    it('Should handle proposals with insufficient Safe balance', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Don't fund the Safe - it has 0 ETH
      const proposalTransactions = [
        createTestTransaction(signers.bob.address, ethers.parseEther('10')),
      ];
      const adminHatData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [ADMIN_HAT]);

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Insufficient balance test',
          dao.proposerAdapterAddress,
          adminHatData,
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Pass the proposal
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Fast forward past voting and timelock periods
      await fastForwardTime(3600 + 1800 + 1);

      // Should be EXECUTABLE
      expect(await dao.azorius.proposalState(proposalId)).to.equal(2); // EXECUTABLE

      // Execution should fail due to insufficient balance
      await expect(dao.azorius.executeProposal(proposalId, proposalTransactions)).to.be.reverted;
    });
  });

  describe('Complex Scenarios', () => {
    it('Should handle role-based proposal creation with token-based voting', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.charlie.address)];
      const managerHatData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [MANAGER_HAT]);

      // Bob (manager) creates proposal
      const tx = await dao.azorius
        .connect(signers.bob)
        .submitProposal(
          proposalTransactions,
          'Manager creates, token holders vote',
          dao.proposerAdapterAddress,
          managerHatData,
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // All token holders vote (including Charlie who can't propose)
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Fast forward past voting and timelock periods
      await fastForwardTime(3600 + 1800 + 1);

      // Should be executable
      expect(await dao.azorius.proposalState(proposalId)).to.equal(2); // EXECUTABLE

      // Check Charlie's balance before execution
      const charlieBalanceBefore = await ethers.provider.getBalance(signers.charlie.address);

      // Execute the proposal
      await dao.azorius.executeProposal(proposalId, proposalTransactions);

      // Check Charlie received the ETH
      const charlieBalanceAfter = await ethers.provider.getBalance(signers.charlie.address);
      expect(charlieBalanceAfter).to.equal(charlieBalanceBefore + ethers.parseEther('1'));

      // Proposal should now be executed
      expect(await dao.azorius.proposalState(proposalId)).to.equal(3); // EXECUTED
    });

    it('Should handle multi-transaction proposals created by hat wearers', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress, ethers.parseEther('10'));

      const proposalTransactions = [
        createTestTransaction(signers.alice.address, ethers.parseEther('1')),
        createTestTransaction(signers.bob.address, ethers.parseEther('2')),
        createTestTransaction(signers.charlie.address, ethers.parseEther('0.5')),
      ];

      const adminHatData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [ADMIN_HAT]);

      // Alice (admin) creates multi-transaction proposal
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Multi-transaction proposal',
          dao.proposerAdapterAddress,
          adminHatData,
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Pass the proposal
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Fast forward past voting and timelock periods
      await fastForwardTime(3600 + 1800 + 1);

      // Check balances before execution
      const aliceBalanceBefore = await ethers.provider.getBalance(signers.alice.address);
      const bobBalanceBefore = await ethers.provider.getBalance(signers.bob.address);
      const charlieBalanceBefore = await ethers.provider.getBalance(signers.charlie.address);

      // Execute all transactions
      await dao.azorius.executeProposal(proposalId, proposalTransactions);

      // Verify all transactions were executed
      const aliceBalanceAfter = await ethers.provider.getBalance(signers.alice.address);
      const bobBalanceAfter = await ethers.provider.getBalance(signers.bob.address);
      const charlieBalanceAfter = await ethers.provider.getBalance(signers.charlie.address);

      expect(aliceBalanceAfter).to.equal(aliceBalanceBefore + ethers.parseEther('1'));
      expect(bobBalanceAfter).to.equal(bobBalanceBefore + ethers.parseEther('2'));
      expect(charlieBalanceAfter).to.equal(charlieBalanceBefore + ethers.parseEther('0.5'));

      expect(await dao.azorius.proposalState(proposalId)).to.equal(3); // EXECUTED
    });
  });

  describe('Proposal Execution', () => {
    async function setupPassedProposal() {
      const { dao } = await loadFixture(setupTestFixture);

      // Fund the Safe
      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];
      const adminHatData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [ADMIN_HAT]);

      // Create proposal
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Send 1 ETH to Bob',
          dao.proposerAdapterAddress,
          adminHatData,
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Cast enough votes to pass
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      return { dao, proposalId, proposalTransactions };
    }

    it('Should execute a passed proposal after timelock period', async () => {
      const { dao, proposalId, proposalTransactions } = await setupPassedProposal();

      // Fast forward past voting period (1 hour)
      await fastForwardTime(3601);

      // Proposal should be passed but not executable yet (timelock)
      expect(await dao.azorius.proposalState(proposalId)).to.equal(1); // TIMELOCKED

      // Fast forward past timelock period (30 minutes)
      await fastForwardTime(1801);

      // Now should be executable
      expect(await dao.azorius.proposalState(proposalId)).to.equal(2); // EXECUTABLE

      // Check Bob's balance before execution
      const bobBalanceBefore = await ethers.provider.getBalance(signers.bob.address);

      // Execute the proposal
      await dao.azorius.executeProposal(proposalId, proposalTransactions);

      // Check Bob received the ETH
      const bobBalanceAfter = await ethers.provider.getBalance(signers.bob.address);
      expect(bobBalanceAfter).to.equal(bobBalanceBefore + ethers.parseEther('1'));

      // Proposal should now be executed
      expect(await dao.azorius.proposalState(proposalId)).to.equal(3); // EXECUTED
    });
  });
});
