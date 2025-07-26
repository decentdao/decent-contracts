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

// Multiple ERC20 tokens governance
interface DeployedMultiERC20DAO {
  safeAddress: string;
  safe: Safe;
  governanceToken: VotesERC20V1;
  utilityToken: VotesERC20V1;
  azorius: ModuleAzoriusV1;
  strategy: StrategyV1;
  governanceProposerAdapterAddress: string;
  utilityProposerAdapterAddress: string;
}

describe('Multiple ERC20 Tokens Governance Integration Tests', () => {
  let signers: BaseSigners;

  async function deployMultiERC20DAO(params: {
    infrastructure: TestInfrastructure;
    signers: BaseSigners;
    owners: string[];
    threshold: number;
    govTokenAllocations: { to: string; amount: bigint }[];
    utilityTokenAllocations: { to: string; amount: bigint }[];
    govTokenProposerThreshold: bigint;
    utilityTokenProposerThreshold: bigint;
    votingPeriod: number;
    quorumThreshold: bigint;
    basisNumerator: bigint;
    timelockPeriod: number;
    executionPeriod: number;
  }): Promise<DeployedMultiERC20DAO> {
    const { infrastructure } = params;

    // Create deployment parameters
    const salt = ethers.keccak256(ethers.randomBytes(32));

    // Deploy two separate ERC20 tokens
    const votesERC20Params: ISystemDeployerV1.VotesERC20V1ParamsStruct[] = [
      {
        implementation: infrastructure.implementations.votesERC20V1,
        metadata: {
          name: 'Governance Token',
          symbol: 'GOV',
        },
        allocations: params.govTokenAllocations,
        locked: false,
        maxTotalSupply: ethers.parseEther('10000'),
        safeSupply: ethers.parseEther('100'),
      },
      {
        implementation: infrastructure.implementations.votesERC20V1,
        metadata: {
          name: 'Utility Token',
          symbol: 'UTIL',
        },
        allocations: params.utilityTokenAllocations,
        locked: false,
        maxTotalSupply: ethers.parseEther('10000'),
        safeSupply: ethers.parseEther('100'),
      },
    ];

    const azoriusGovernanceParams: ISystemDeployerV1.AzoriusGovernanceParamsStruct = {
      proposerAdapterParams: {
        proposerAdapterERC20V1Params: [
          {
            implementation: infrastructure.implementations.proposerAdapterERC20V1,
            token: ethers.ZeroAddress, // Will use first token
            newTokenIndex: 0,
            proposerThreshold: params.govTokenProposerThreshold,
          },
          {
            implementation: infrastructure.implementations.proposerAdapterERC20V1,
            token: ethers.ZeroAddress, // Will use second token
            newTokenIndex: 1,
            proposerThreshold: params.utilityTokenProposerThreshold,
          },
        ],
        proposerAdapterERC721V1Params: [],
        proposerAdapterHatsV1Params: [],
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
            token: ethers.ZeroAddress, // Will use first token
            newTokenIndex: 0,
            weightPerToken: 1n,
          },
          {
            votingWeightImplementation: infrastructure.implementations.votingWeightERC20V1,
            voteTrackerImplementation: infrastructure.implementations.voteTrackerERC20V1,
            token: ethers.ZeroAddress, // Will use second token
            newTokenIndex: 1,
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

    // Expected order: GovToken, UtilityToken, GovProposerAdapter, UtilityProposerAdapter, Strategy, 4x VotingConfigs, Azorius = 10 total
    if (proxyDeployedEvents.length !== 10) {
      throw new Error(`Expected 10 ProxyDeployed events, got ${proxyDeployedEvents.length}`);
    }

    const addresses = proxyDeployedEvents.map(event => {
      const parsedLog = infrastructure.systemDeployer.interface.parseLog({
        topics: event.topics,
        data: event.data,
      });
      return parsedLog?.args[0];
    });

    const [
      governanceTokenAddress,
      utilityTokenAddress,
      governanceProposerAdapterAddress,
      utilityProposerAdapterAddress,
      strategyAddress,
      ,
      ,
      ,
      ,
      azoriusAddress,
    ] = addresses;

    // Connect to deployed contracts
    const safe = Safe__factory.connect(safeAddress, params.signers.deployer);
    const governanceToken = VotesERC20V1__factory.connect(
      governanceTokenAddress,
      params.signers.deployer,
    );
    const utilityToken = VotesERC20V1__factory.connect(
      utilityTokenAddress,
      params.signers.deployer,
    );
    const azorius = ModuleAzoriusV1__factory.connect(azoriusAddress, params.signers.deployer);
    const strategy = StrategyV1__factory.connect(strategyAddress, params.signers.deployer);

    return {
      safeAddress,
      safe,
      governanceToken,
      utilityToken,
      azorius,
      strategy,
      governanceProposerAdapterAddress,
      utilityProposerAdapterAddress,
    };
  }

  async function setupTestFixture() {
    signers = await getTestSigners();
    const infrastructure = await deployTestInfrastructure(signers.deployer);

    const dao = await deployMultiERC20DAO({
      infrastructure,
      signers,
      owners: [signers.deployer.address],
      threshold: 1,
      govTokenAllocations: [
        { to: signers.alice.address, amount: ethers.parseEther('200') },
        { to: signers.bob.address, amount: ethers.parseEther('150') },
        { to: signers.charlie.address, amount: ethers.parseEther('100') },
      ],
      utilityTokenAllocations: [
        { to: signers.alice.address, amount: ethers.parseEther('50') },
        { to: signers.bob.address, amount: ethers.parseEther('75') },
        { to: signers.charlie.address, amount: ethers.parseEther('125') },
      ],
      govTokenProposerThreshold: ethers.parseEther('100'), // Need 100 GOV tokens to propose
      utilityTokenProposerThreshold: ethers.parseEther('50'), // Need 50 UTIL tokens to propose
      votingPeriod: DEFAULT_GOVERNANCE_PARAMS.votingPeriod,
      quorumThreshold: ethers.parseEther('200'), // 200 token-equivalent votes for quorum
      basisNumerator: DEFAULT_GOVERNANCE_PARAMS.basisNumerator,
      timelockPeriod: DEFAULT_GOVERNANCE_PARAMS.timelockPeriod,
      executionPeriod: DEFAULT_GOVERNANCE_PARAMS.executionPeriod,
    });

    // All users delegate to themselves to activate their voting power
    await delegateTokens(dao.governanceToken, signers.alice);
    await delegateTokens(dao.governanceToken, signers.bob);
    await delegateTokens(dao.governanceToken, signers.charlie);
    await delegateTokens(dao.utilityToken, signers.alice);
    await delegateTokens(dao.utilityToken, signers.bob);
    await delegateTokens(dao.utilityToken, signers.charlie);

    return { infrastructure, dao };
  }

  describe('DAO Deployment', () => {
    it('Should deploy a multi-ERC20 governance DAO', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      expect(dao.safeAddress).to.not.equal(ethers.ZeroAddress);
      expect(await ethers.provider.getCode(dao.safeAddress)).to.not.equal('0x');
    });

    it('Should correctly distribute different tokens', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Check governance token balances
      expect(await dao.governanceToken.balanceOf(signers.alice.address)).to.equal(
        ethers.parseEther('200'),
      );
      expect(await dao.governanceToken.balanceOf(signers.bob.address)).to.equal(
        ethers.parseEther('150'),
      );
      expect(await dao.governanceToken.balanceOf(signers.charlie.address)).to.equal(
        ethers.parseEther('100'),
      );

      // Check utility token balances
      expect(await dao.utilityToken.balanceOf(signers.alice.address)).to.equal(
        ethers.parseEther('50'),
      );
      expect(await dao.utilityToken.balanceOf(signers.bob.address)).to.equal(
        ethers.parseEther('75'),
      );
      expect(await dao.utilityToken.balanceOf(signers.charlie.address)).to.equal(
        ethers.parseEther('125'),
      );
    });

    it('Should configure strategy with both token voting configs', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Check that the strategy is deployed and has configuration
      expect(dao.strategy.target).to.not.equal(ethers.ZeroAddress);
      expect(await ethers.provider.getCode(dao.strategy.target)).to.not.equal('0x');
    });

    it('Should configure both proposer adapters', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const govProposerAdapter = await ethers.getContractAt(
        'ProposerAdapterERC20V1',
        dao.governanceProposerAdapterAddress,
      );
      const utilProposerAdapter = await ethers.getContractAt(
        'ProposerAdapterERC20V1',
        dao.utilityProposerAdapterAddress,
      );

      expect(await govProposerAdapter.token()).to.equal(await dao.governanceToken.getAddress());
      expect(await utilProposerAdapter.token()).to.equal(await dao.utilityToken.getAddress());
    });
  });

  describe('Multi-Proposer Creation', () => {
    it('Should allow governance token holders to create proposals', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      // Alice has 200 GOV tokens (> 100 threshold)
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Governance token proposal',
          dao.governanceProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = findEvent(
        receipt!.logs,
        dao.azorius.interface,
        'ProposalCreated',
      );
      expect(proposalCreatedEvent).to.not.be.undefined;
      expect(proposalCreatedEvent.args.proposer).to.equal(signers.alice.address);
    });

    it('Should allow utility token holders to create proposals', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.charlie.address)];

      // Charlie has 125 UTIL tokens (> 50 threshold)
      const tx = await dao.azorius
        .connect(signers.charlie)
        .submitProposal(
          proposalTransactions,
          'Utility token proposal',
          dao.utilityProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = findEvent(
        receipt!.logs,
        dao.azorius.interface,
        'ProposalCreated',
      );
      expect(proposalCreatedEvent).to.not.be.undefined;
      expect(proposalCreatedEvent.args.proposer).to.equal(signers.charlie.address);
    });

    it('Should allow users with sufficient tokens in either type to choose proposer adapter', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      // Bob has 150 GOV tokens (> 100 threshold) and 75 UTIL tokens (> 50 threshold)
      // Can use either proposer adapter

      // Test governance token proposer
      const govTx = await dao.azorius
        .connect(signers.bob)
        .submitProposal(
          proposalTransactions,
          'Bob via governance tokens',
          dao.governanceProposerAdapterAddress,
          '0x',
        );

      const govReceipt = await govTx.wait();
      const govProposalEvent = findEvent(
        govReceipt!.logs,
        dao.azorius.interface,
        'ProposalCreated',
      );
      expect(govProposalEvent).to.not.be.undefined;

      // Test utility token proposer
      const utilTx = await dao.azorius
        .connect(signers.bob)
        .submitProposal(
          proposalTransactions,
          'Bob via utility tokens',
          dao.utilityProposerAdapterAddress,
          '0x',
        );

      const utilReceipt = await utilTx.wait();
      const utilProposalEvent = findEvent(
        utilReceipt!.logs,
        dao.azorius.interface,
        'ProposalCreated',
      );
      expect(utilProposalEvent).to.not.be.undefined;
    });

    it('Should reject proposals from users without sufficient tokens in chosen adapter', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      // Alice has only 50 UTIL tokens (= 50 threshold), should succeed via utility proposer
      await expect(
        dao.azorius
          .connect(signers.alice)
          .submitProposal(
            proposalTransactions,
            'Should succeed utility',
            dao.utilityProposerAdapterAddress,
            '0x',
          ),
      ).to.not.be.reverted;

      // Transfer away Alice's utility tokens so she falls below threshold
      await dao.utilityToken
        .connect(signers.alice)
        .transfer(signers.bob.address, ethers.parseEther('25'));

      // Now Alice has only 25 UTIL tokens (< 50 threshold), should fail via utility proposer
      await expect(
        dao.azorius
          .connect(signers.alice)
          .submitProposal(
            proposalTransactions,
            'Should fail utility',
            dao.utilityProposerAdapterAddress,
            '0x',
          ),
      ).to.be.reverted;

      // Charlie has only 100 GOV tokens (= 100 threshold), should succeed via governance proposer
      const tx = await dao.azorius
        .connect(signers.charlie)
        .submitProposal(
          proposalTransactions,
          'Should succeed governance',
          dao.governanceProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = findEvent(
        receipt!.logs,
        dao.azorius.interface,
        'ProposalCreated',
      );
      expect(proposalCreatedEvent).to.not.be.undefined;
    });

    it('Should handle edge cases for exact thresholds', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Transfer tokens to create exact threshold scenarios
      await dao.utilityToken
        .connect(signers.alice)
        .transfer(signers.charlie.address, ethers.parseEther('25'));
      // Alice now has exactly 25 UTIL (< 50), Charlie has 150 UTIL (> 50)

      await dao.governanceToken
        .connect(signers.charlie)
        .transfer(signers.alice.address, ethers.parseEther('50'));
      // Charlie now has exactly 50 GOV (< 100), Alice has 250 GOV (> 100)

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      // Alice can still propose via governance tokens
      await expect(
        dao.azorius
          .connect(signers.alice)
          .submitProposal(
            proposalTransactions,
            'Alice via governance',
            dao.governanceProposerAdapterAddress,
            '0x',
          ),
      ).to.not.be.reverted;

      // Charlie can still propose via utility tokens
      await expect(
        dao.azorius
          .connect(signers.charlie)
          .submitProposal(
            proposalTransactions,
            'Charlie via utility',
            dao.utilityProposerAdapterAddress,
            '0x',
          ),
      ).to.not.be.reverted;

      // But Alice cannot propose via utility tokens anymore
      await expect(
        dao.azorius
          .connect(signers.alice)
          .submitProposal(
            proposalTransactions,
            'Should fail',
            dao.utilityProposerAdapterAddress,
            '0x',
          ),
      ).to.be.reverted;
    });
  });

  describe('Multi-Token Voting Process', () => {
    it('Should allow users to vote with governance tokens only', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Test proposal',
          dao.governanceProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice votes with governance tokens only (config index 0)
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('200')); // Alice's GOV tokens
    });

    it('Should allow users to vote with utility tokens only', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Test proposal',
          dao.governanceProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Charlie votes with utility tokens only (config index 1)
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: '0x' }],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('125')); // Charlie's UTIL tokens
    });

    it('Should allow users to vote with both token types in same transaction', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Test proposal',
          dao.governanceProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Bob votes with both token types
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [
          { configIndex: 0, voteData: '0x' }, // Governance tokens
          { configIndex: 1, voteData: '0x' }, // Utility tokens
        ],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('225')); // 150 GOV + 75 UTIL
    });

    it('Should prevent double voting within same token type', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Test proposal',
          dao.governanceProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice votes with governance tokens
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Alice tries to vote again with governance tokens - should fail
      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          0, // NO
          [{ configIndex: 0, voteData: '0x' }],
          0,
        ),
      ).to.be.reverted;
    });

    it('Should allow voting with one token type after voting with another', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Test proposal',
          dao.governanceProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Bob votes with governance tokens first
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      let votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('150')); // Bob's GOV tokens

      // Bob votes with utility tokens separately
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: '0x' }],
        0,
      );

      votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('225')); // 150 GOV + 75 UTIL
    });
  });

  describe('Mixed Quorum and Basis Calculations', () => {
    it('Should meet quorum with combined token votes', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Test proposal',
          dao.governanceProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Vote to meet quorum (need 200 tokens total)
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }], // 200 GOV tokens
        0,
      );

      // Fast forward past voting period
      await fastForwardTime(DEFAULT_GOVERNANCE_PARAMS.votingPeriod + 1);

      // Proposal should be timelocked (passed quorum and basis)
      expect(await dao.azorius.proposalState(proposalId)).to.equal(1); // TIMELOCKED
    });

    it('Should fail quorum with insufficient combined votes', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Test proposal',
          dao.governanceProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Vote with insufficient tokens for quorum (need 200, only getting 125)
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: '0x' }], // 125 UTIL tokens
        0,
      );

      // Fast forward past voting period
      await fastForwardTime(DEFAULT_GOVERNANCE_PARAMS.votingPeriod + 1);

      // Proposal should fail (insufficient quorum)
      expect(await dao.azorius.proposalState(proposalId)).to.equal(5); // FAILED
    });

    it('Should handle basis calculation with mixed token types', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Test proposal',
          dao.governanceProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice votes YES with governance tokens (200)
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Charlie votes NO with utility tokens (125)
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        0, // NO
        [{ configIndex: 1, voteData: '0x' }],
        0,
      );

      // Total: 200 YES, 125 NO = 325 total votes, 200/325 ≈ 61.5% > 50%
      // Quorum met: 325 > 200

      // Fast forward past voting period
      await fastForwardTime(DEFAULT_GOVERNANCE_PARAMS.votingPeriod + 1);

      // Proposal should pass (met quorum and basis)
      expect(await dao.azorius.proposalState(proposalId)).to.equal(1); // TIMELOCKED
    });
  });

  describe('Edge Cases & Error Conditions', () => {
    it('Should handle users with no tokens trying to vote', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      // Transfer all of Alice's tokens away
      await dao.governanceToken
        .connect(signers.alice)
        .transfer(signers.bob.address, ethers.parseEther('200'));
      await dao.utilityToken
        .connect(signers.alice)
        .transfer(signers.bob.address, ethers.parseEther('50'));

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.bob)
        .submitProposal(
          proposalTransactions,
          'Test proposal',
          dao.governanceProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice has no tokens, voting should fail with NoVotingWeight error
      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 0, voteData: '0x' }],
          0,
        ),
      ).to.be.revertedWithCustomError(dao.strategy, 'NoVotingWeight');
    });

    it('Should handle token transfers affecting voting power mid-proposal', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Test proposal',
          dao.governanceProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice transfers half her governance tokens to Bob after proposal creation
      await dao.governanceToken
        .connect(signers.alice)
        .transfer(signers.bob.address, ethers.parseEther('100'));

      // Alice votes with her remaining governance power (100 tokens now)
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Her vote should count as 200 tokens (snapshot-based, original balance)
      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('200'));
    });

    it('Should handle extreme scenarios with mixed token distributions', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      // Redistribute tokens for edge case: all governance tokens to one user, all utility to another
      await dao.governanceToken
        .connect(signers.alice)
        .transfer(signers.charlie.address, ethers.parseEther('200'));
      await dao.governanceToken
        .connect(signers.bob)
        .transfer(signers.charlie.address, ethers.parseEther('150'));
      // Charlie now has all 450 governance tokens

      await dao.utilityToken
        .connect(signers.charlie)
        .transfer(signers.alice.address, ethers.parseEther('125'));
      await dao.utilityToken
        .connect(signers.bob)
        .transfer(signers.alice.address, ethers.parseEther('75'));
      // Alice now has all 250 utility tokens

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.charlie)
        .submitProposal(
          proposalTransactions,
          'Extreme distribution test',
          dao.governanceProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Charlie votes YES with all governance tokens
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Alice votes NO with all utility tokens
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        0, // NO
        [{ configIndex: 1, voteData: '0x' }],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('450'));
      expect(votingDetails.noVotes).to.equal(ethers.parseEther('250'));

      // Fast forward past voting period
      await fastForwardTime(DEFAULT_GOVERNANCE_PARAMS.votingPeriod + 1);

      // Should pass: 450 YES vs 250 NO = 64% approval, quorum easily met
      expect(await dao.azorius.proposalState(proposalId)).to.equal(1); // TIMELOCKED
    });
  });

  describe('Proposal Execution', () => {
    it('Should execute proposal that passed via mixed token voting', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress, ethers.parseEther('10'));

      const proposalTransactions = [
        createTestTransaction(signers.alice.address, ethers.parseEther('2')),
      ];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Execute test',
          dao.governanceProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Mixed voting to pass proposal
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }], // 200 GOV tokens
        0,
      );

      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: '0x' }], // 75 UTIL tokens
        0,
      );

      // Fast forward past voting and timelock periods
      await fastForwardTime(DEFAULT_GOVERNANCE_PARAMS.votingPeriod + 1);
      await fastForwardTime(DEFAULT_GOVERNANCE_PARAMS.timelockPeriod + 1);

      expect(await dao.azorius.proposalState(proposalId)).to.equal(2); // EXECUTABLE

      const aliceBalanceBefore = await ethers.provider.getBalance(signers.alice.address);

      // Execute the proposal
      await dao.azorius.executeProposal(proposalId, proposalTransactions);

      const aliceBalanceAfter = await ethers.provider.getBalance(signers.alice.address);
      expect(aliceBalanceAfter).to.equal(aliceBalanceBefore + ethers.parseEther('2'));

      expect(await dao.azorius.proposalState(proposalId)).to.equal(3); // EXECUTED
    });
  });
});
