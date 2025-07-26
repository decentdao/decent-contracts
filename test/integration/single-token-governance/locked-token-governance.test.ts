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
  VotesERC20StakedV1,
  VotesERC20StakedV1__factory,
  MockERC20,
  MockERC20__factory,
  ERC1967Proxy__factory,
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
} from '../shared/helpers';

// Locked (staked) token governance
interface DeployedLockedTokenDAO {
  safeAddress: string;
  safe: Safe;
  underlyingToken: MockERC20;
  stakingToken: VotesERC20StakedV1;
  azorius: ModuleAzoriusV1;
  strategy: StrategyV1;
  proposerAdapterAddress: string;
}

describe('Locked Token Governance Integration Tests', () => {
  let signers: BaseSigners;
  const MINIMUM_STAKING_PERIOD = 7 * 24 * 60 * 60; // 7 days

  async function deployLockedTokenDAO(params: {
    infrastructure: TestInfrastructure;
    signers: BaseSigners;
    owners: string[];
    threshold: number;
    underlyingTokenAllocations: { to: string; amount: bigint }[];
    proposerThreshold: bigint;
    votingPeriod: number;
    quorumThreshold: bigint;
    basisNumerator: bigint;
    timelockPeriod: number;
    executionPeriod: number;
  }): Promise<DeployedLockedTokenDAO> {
    const { infrastructure } = params;

    // Deploy underlying ERC20 token
    const underlyingToken = await new MockERC20__factory(params.signers.deployer).deploy('Mock ERC20', 'MOCK', 18);

    // Mint underlying tokens to users
    for (const allocation of params.underlyingTokenAllocations) {
      await underlyingToken.mint(allocation.to, allocation.amount);
    }

    // Deploy staking token implementation
    const stakingTokenImpl = await new VotesERC20StakedV1__factory(params.signers.deployer).deploy();
    
    // Create initialization data
    const initData = VotesERC20StakedV1__factory.createInterface().encodeFunctionData(
      'initialize',
      [params.signers.deployer.address, await underlyingToken.getAddress()],
    );
    
    // Deploy proxy
    const proxy = await new ERC1967Proxy__factory(params.signers.deployer).deploy(
      await stakingTokenImpl.getAddress(),
      initData,
    );
    
    // Connect to proxy as VotesERC20StakedV1
    const stakingToken = VotesERC20StakedV1__factory.connect(
      await proxy.getAddress(),
      params.signers.deployer,
    );

    // Initialize staking token with minimum staking period
    await stakingToken.initialize2(MINIMUM_STAKING_PERIOD, []);

    // Create deployment parameters
    const salt = ethers.keccak256(ethers.randomBytes(32));

    const azoriusGovernanceParams: ISystemDeployerV1.AzoriusGovernanceParamsStruct = {
      proposerAdapterParams: {
        proposerAdapterERC20V1Params: [
          {
            implementation: infrastructure.implementations.proposerAdapterERC20V1,
            token: await stakingToken.getAddress(),
            newTokenIndex: 0, // Not creating new token
            proposerThreshold: params.proposerThreshold,
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
            token: await stakingToken.getAddress(),
            newTokenIndex: 0, // Not creating new token
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
    const votesERC20Params: ISystemDeployerV1.VotesERC20V1ParamsStruct[] = [];
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

    // Expected order: ProposerAdapter, Strategy, VotingWeight, VoteTracker, Azorius = 5 total
    if (proxyDeployedEvents.length !== 5) {
      throw new Error(`Expected 5 ProxyDeployed events, got ${proxyDeployedEvents.length}`);
    }

    const addresses = proxyDeployedEvents.map(event => {
      const parsedLog = infrastructure.systemDeployer.interface.parseLog({
        topics: event.topics,
        data: event.data,
      });
      return parsedLog?.args[0];
    });

    const [proposerAdapterAddress, strategyAddress, , , azoriusAddress] = addresses;

    // Connect to deployed contracts
    const safe = Safe__factory.connect(safeAddress, params.signers.deployer);
    const azorius = ModuleAzoriusV1__factory.connect(azoriusAddress, params.signers.deployer);
    const strategy = StrategyV1__factory.connect(strategyAddress, params.signers.deployer);

    return {
      safeAddress,
      safe,
      underlyingToken,
      stakingToken,
      azorius,
      strategy,
      proposerAdapterAddress,
    };
  }

  async function setupTestFixture() {
    signers = await getTestSigners();
    const infrastructure = await deployTestInfrastructure(signers.deployer);

    const dao = await deployLockedTokenDAO({
      infrastructure,
      signers,
      owners: [signers.deployer.address],
      threshold: 1,
      underlyingTokenAllocations: [
        { to: signers.alice.address, amount: ethers.parseEther('100') },
        { to: signers.bob.address, amount: ethers.parseEther('75') },
        { to: signers.charlie.address, amount: ethers.parseEther('50') },
      ],
      proposerThreshold: ethers.parseEther('50'), // Need 50 staked tokens to propose
      votingPeriod: DEFAULT_GOVERNANCE_PARAMS.votingPeriod,
      quorumThreshold: ethers.parseEther('80'), // 80 staked tokens for quorum
      basisNumerator: DEFAULT_GOVERNANCE_PARAMS.basisNumerator,
      timelockPeriod: DEFAULT_GOVERNANCE_PARAMS.timelockPeriod,
      executionPeriod: DEFAULT_GOVERNANCE_PARAMS.executionPeriod,
    });

    return { infrastructure, dao };
  }

  describe('DAO Deployment', () => {
    it('Should deploy a locked token governance DAO', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      expect(dao.safeAddress).to.not.equal(ethers.ZeroAddress);
      expect(await ethers.provider.getCode(dao.safeAddress)).to.not.equal('0x');
    });

    it('Should correctly configure staking token', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      expect(await dao.stakingToken.stakedToken()).to.equal(await dao.underlyingToken.getAddress());
      expect(await dao.stakingToken.minimumStakingPeriod()).to.equal(MINIMUM_STAKING_PERIOD);
      expect(await dao.stakingToken.name()).to.equal('Staked Mock ERC20');
      expect(await dao.stakingToken.symbol()).to.equal('stMOCK');
    });

    it('Should distribute underlying tokens correctly', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      expect(await dao.underlyingToken.balanceOf(signers.alice.address)).to.equal(ethers.parseEther('100'));
      expect(await dao.underlyingToken.balanceOf(signers.bob.address)).to.equal(ethers.parseEther('75'));
      expect(await dao.underlyingToken.balanceOf(signers.charlie.address)).to.equal(ethers.parseEther('50'));
    });
  });

  describe('Staking Process', () => {
    it('Should allow users to stake underlying tokens', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Approve staking contract
      await dao.underlyingToken.connect(signers.alice).approve(
        await dao.stakingToken.getAddress(),
        ethers.parseEther('100'),
      );

      // Stake tokens
      await expect(dao.stakingToken.connect(signers.alice).stake(ethers.parseEther('100')))
        .to.emit(dao.stakingToken, 'Staked')
        .withArgs(signers.alice.address, ethers.parseEther('100'));

      // Check balances
      expect(await dao.stakingToken.balanceOf(signers.alice.address)).to.equal(ethers.parseEther('100'));
      expect(await dao.underlyingToken.balanceOf(signers.alice.address)).to.equal(0);
      expect(await dao.stakingToken.totalStaked()).to.equal(ethers.parseEther('100'));
    });

    it('Should require manual delegation after staking for voting power', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Approve and stake
      await dao.underlyingToken.connect(signers.alice).approve(
        await dao.stakingToken.getAddress(),
        ethers.parseEther('100'),
      );
      await dao.stakingToken.connect(signers.alice).stake(ethers.parseEther('100'));

      // Check voting power before delegation
      expect(await dao.stakingToken.getVotes(signers.alice.address)).to.equal(0);

      // Delegate to self
      await dao.stakingToken.connect(signers.alice).delegate(signers.alice.address);

      // Check voting power after delegation
      expect(await dao.stakingToken.getVotes(signers.alice.address)).to.equal(ethers.parseEther('100'));
    });

    it('Should prevent unstaking before minimum period', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Stake tokens
      await dao.underlyingToken.connect(signers.alice).approve(
        await dao.stakingToken.getAddress(),
        ethers.parseEther('100'),
      );
      await dao.stakingToken.connect(signers.alice).stake(ethers.parseEther('100'));

      // Try to unstake immediately - should fail
      await expect(dao.stakingToken.connect(signers.alice).unstake(ethers.parseEther('50')))
        .to.be.revertedWithCustomError(dao.stakingToken, 'MinimumStakingPeriod');
    });

    it('Should allow unstaking after minimum period', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Stake tokens
      await dao.underlyingToken.connect(signers.alice).approve(
        await dao.stakingToken.getAddress(),
        ethers.parseEther('100'),
      );
      await dao.stakingToken.connect(signers.alice).stake(ethers.parseEther('100'));

      // Fast forward past minimum staking period
      await fastForwardTime(MINIMUM_STAKING_PERIOD + 1);

      // Unstake should succeed
      await expect(dao.stakingToken.connect(signers.alice).unstake(ethers.parseEther('50')))
        .to.emit(dao.stakingToken, 'Unstaked')
        .withArgs(signers.alice.address, ethers.parseEther('50'));

      // Check balances
      expect(await dao.stakingToken.balanceOf(signers.alice.address)).to.equal(ethers.parseEther('50'));
      expect(await dao.underlyingToken.balanceOf(signers.alice.address)).to.equal(ethers.parseEther('50'));
    });

    it('Should prevent transfers of staking tokens', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Stake tokens
      await dao.underlyingToken.connect(signers.alice).approve(
        await dao.stakingToken.getAddress(),
        ethers.parseEther('100'),
      );
      await dao.stakingToken.connect(signers.alice).stake(ethers.parseEther('100'));

      // Try to transfer - should fail
      await expect(
        dao.stakingToken.connect(signers.alice).transfer(signers.bob.address, ethers.parseEther('50')),
      ).to.be.revertedWithCustomError(dao.stakingToken, 'NonTransferable');

      // Try to approve - should fail
      await expect(
        dao.stakingToken.connect(signers.alice).approve(signers.bob.address, ethers.parseEther('50')),
      ).to.be.revertedWithCustomError(dao.stakingToken, 'NonTransferable');
    });
  });

  async function setupStakedUsers() {
    const { dao } = await loadFixture(setupTestFixture);

    // Alice stakes 100 tokens
    await dao.underlyingToken.connect(signers.alice).approve(
      await dao.stakingToken.getAddress(),
      ethers.parseEther('100'),
    );
    await dao.stakingToken.connect(signers.alice).stake(ethers.parseEther('100'));
    await dao.stakingToken.connect(signers.alice).delegate(signers.alice.address);

    // Bob stakes 75 tokens
    await dao.underlyingToken.connect(signers.bob).approve(
      await dao.stakingToken.getAddress(),
      ethers.parseEther('75'),
    );
    await dao.stakingToken.connect(signers.bob).stake(ethers.parseEther('75'));
    await dao.stakingToken.connect(signers.bob).delegate(signers.bob.address);

    // Charlie stakes 25 tokens (below proposer threshold)
    await dao.underlyingToken.connect(signers.charlie).approve(
      await dao.stakingToken.getAddress(),
      ethers.parseEther('25'),
    );
    await dao.stakingToken.connect(signers.charlie).stake(ethers.parseEther('25'));
    await dao.stakingToken.connect(signers.charlie).delegate(signers.charlie.address);

    return dao;
  }

  async function setupProposalWithStakers() {
    const dao = await setupStakedUsers();
    await fundSafe(signers.deployer, dao.safeAddress);

    const proposalTransactions = [createTestTransaction(signers.alice.address)];

    const tx = await dao.azorius
      .connect(signers.alice)
      .submitProposal(proposalTransactions, 'Test proposal', dao.proposerAdapterAddress, '0x');

    const receipt = await tx.wait();
    const proposalId = extractProposalId(receipt!, dao.azorius.interface);

    return { dao, proposalId };
  }

  describe('Proposal Creation with Staked Tokens', () => {

    it('Should allow stakers with sufficient tokens to create proposals', async () => {
      const dao = await setupStakedUsers();

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      // Alice has 100 staked tokens (> 50 threshold)
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(proposalTransactions, 'Test proposal', dao.proposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalCreatedEvent = findEvent(receipt!.logs, dao.azorius.interface, 'ProposalCreated');
      expect(proposalCreatedEvent).to.not.be.undefined;
    });

    it('Should reject proposals from stakers with insufficient tokens', async () => {
      const dao = await setupStakedUsers();

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      // Charlie has only 25 staked tokens (< 50 threshold)
      await expect(
        dao.azorius
          .connect(signers.charlie)
          .submitProposal(proposalTransactions, 'Should fail', dao.proposerAdapterAddress, '0x'),
      ).to.be.reverted;
    });

    it('Should reject proposals from users with underlying tokens but no stake', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      // Alice has underlying tokens but hasn't staked
      await expect(
        dao.azorius
          .connect(signers.alice)
          .submitProposal(proposalTransactions, 'Should fail', dao.proposerAdapterAddress, '0x'),
      ).to.be.reverted;
    });
  });

  describe('Voting Process with Staked Tokens', () => {

    it('Should allow stakers to vote with their staked tokens', async () => {
      const { dao, proposalId } = await setupProposalWithStakers();

      // Alice votes YES with 100 staked tokens
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('100'));
    });

    it('Should prevent voting with unstaked tokens', async () => {
      const { dao } = await loadFixture(setupTestFixture);
      await fundSafe(signers.deployer, dao.safeAddress);

      // Setup proposal
      await dao.underlyingToken.connect(signers.alice).approve(
        await dao.stakingToken.getAddress(),
        ethers.parseEther('100'),
      );
      await dao.stakingToken.connect(signers.alice).stake(ethers.parseEther('100'));
      await dao.stakingToken.connect(signers.alice).delegate(signers.alice.address);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(proposalTransactions, 'Test proposal', dao.proposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Bob has underlying tokens but no stake - voting should fail
      await expect(
        dao.strategy.connect(signers.bob).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 0, voteData: '0x' }],
          0,
        ),
      ).to.be.revertedWithCustomError(dao.strategy, 'NoVotingWeight');
    });

    it('Should use snapshot-based voting power at proposal creation time', async () => {
      const { dao, proposalId } = await setupProposalWithStakers();

      // Charlie stakes more tokens (25 more to reach 50 total)
      await dao.underlyingToken.connect(signers.charlie).approve(
        await dao.stakingToken.getAddress(),
        ethers.parseEther('25'),
      );
      await dao.stakingToken.connect(signers.charlie).stake(ethers.parseEther('25'));
      // Note: Charlie already delegated in setupStakedUsers, so their current voting power will update

      // Charlie votes but can only use the 25 tokens they had at proposal creation (snapshot-based)
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('25')); // Charlie's original 25 at snapshot
    });
  });

  describe('Unstaking Effects on Governance', () => {
    it('Should allow unstaking after voting on active proposal', async () => {
      const { dao, proposalId } = await setupProposalWithStakers();

      // Alice votes
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Fast forward past minimum staking period
      await fastForwardTime(MINIMUM_STAKING_PERIOD + 1);

      // Alice unstakes half her tokens
      await dao.stakingToken.connect(signers.alice).unstake(ethers.parseEther('50'));

      // Voting power for the proposal remains unchanged (snapshot-based)
      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('100'));

      // But Alice's current voting power is reduced
      expect(await dao.stakingToken.getVotes(signers.alice.address)).to.equal(ethers.parseEther('50'));
    });

    it('Should affect proposer eligibility after unstaking', async () => {
      const dao = await setupStakedUsers();

      // Fast forward past minimum staking period
      await fastForwardTime(MINIMUM_STAKING_PERIOD + 1);

      // Bob unstakes to go below proposer threshold
      await dao.stakingToken.connect(signers.bob).unstake(ethers.parseEther('30'));
      // Bob now has 45 staked tokens (< 50 threshold)

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      // Bob should no longer be able to propose
      await expect(
        dao.azorius
          .connect(signers.bob)
          .submitProposal(proposalTransactions, 'Should fail', dao.proposerAdapterAddress, '0x'),
      ).to.be.reverted;
    });
  });

  describe('Edge Cases & Complex Scenarios', () => {
    it('Should handle partial unstaking correctly', async () => {
      const dao = await setupStakedUsers();

      // Fast forward past minimum staking period
      await fastForwardTime(MINIMUM_STAKING_PERIOD + 1);

      // Alice unstakes 30 tokens
      await dao.stakingToken.connect(signers.alice).unstake(ethers.parseEther('30'));

      expect(await dao.stakingToken.balanceOf(signers.alice.address)).to.equal(ethers.parseEther('70'));
      expect(await dao.underlyingToken.balanceOf(signers.alice.address)).to.equal(ethers.parseEther('30'));
      expect(await dao.stakingToken.getVotes(signers.alice.address)).to.equal(ethers.parseEther('70'));
    });

    it('Should handle restaking after unstaking', async () => {
      const dao = await setupStakedUsers();

      // Fast forward and unstake
      await fastForwardTime(MINIMUM_STAKING_PERIOD + 1);
      await dao.stakingToken.connect(signers.alice).unstake(ethers.parseEther('50'));

      // Restake the unstaked tokens
      await dao.underlyingToken.connect(signers.alice).approve(
        await dao.stakingToken.getAddress(),
        ethers.parseEther('50'),
      );
      await dao.stakingToken.connect(signers.alice).stake(ethers.parseEther('50'));
      // Note: Alice already delegated previously, so delegation persists

      // Voting power should be back to 100
      expect(await dao.stakingToken.getVotes(signers.alice.address)).to.equal(ethers.parseEther('100'));

      // But now can't unstake again immediately (new minimum period)
      await expect(dao.stakingToken.connect(signers.alice).unstake(ethers.parseEther('50')))
        .to.be.revertedWithCustomError(dao.stakingToken, 'MinimumStakingPeriod');
    });

    it('Should handle proposal execution with staked token voting', async () => {
      const { dao, proposalId } = await setupProposalWithStakers();

      await fundSafe(signers.deployer, dao.safeAddress, ethers.parseEther('10'));

      // Vote to pass proposal
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

      // Total: 175 YES votes > 80 quorum

      // Fast forward past voting and timelock
      await fastForwardTime(DEFAULT_GOVERNANCE_PARAMS.votingPeriod + 1);
      await fastForwardTime(DEFAULT_GOVERNANCE_PARAMS.timelockPeriod + 1);

      expect(await dao.azorius.proposalState(proposalId)).to.equal(2); // EXECUTABLE

      // Use the exact same transaction that was submitted
      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const aliceBalanceBefore = await ethers.provider.getBalance(signers.alice.address);

      // Execute the proposal
      await dao.azorius.executeProposal(proposalId, proposalTransactions);

      const aliceBalanceAfter = await ethers.provider.getBalance(signers.alice.address);
      expect(aliceBalanceAfter).to.equal(aliceBalanceBefore + ethers.parseEther('1'));

      expect(await dao.azorius.proposalState(proposalId)).to.equal(3); // EXECUTED
    });

    it('Should handle zero stake attempts', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await dao.underlyingToken.connect(signers.alice).approve(
        await dao.stakingToken.getAddress(),
        ethers.parseEther('100'),
      );

      await expect(dao.stakingToken.connect(signers.alice).stake(0))
        .to.be.revertedWithCustomError(dao.stakingToken, 'ZeroStake');
    });

    it('Should prevent voting after unstaking all tokens', async () => {
      const { dao } = await loadFixture(setupTestFixture);
      await fundSafe(signers.deployer, dao.safeAddress);

      // Alice stakes and delegates
      await dao.underlyingToken.connect(signers.alice).approve(
        await dao.stakingToken.getAddress(),
        ethers.parseEther('100'),
      );
      await dao.stakingToken.connect(signers.alice).stake(ethers.parseEther('100'));
      await dao.stakingToken.connect(signers.alice).delegate(signers.alice.address);

      // Fast forward past minimum staking period
      await fastForwardTime(MINIMUM_STAKING_PERIOD + 1);

      // Alice unstakes all tokens
      await dao.stakingToken.connect(signers.alice).unstake(ethers.parseEther('100'));

      // Create a proposal after unstaking
      const proposalTransactions = [createTestTransaction(signers.bob.address)];
      
      // Alice cannot create proposal anymore
      await expect(
        dao.azorius
          .connect(signers.alice)
          .submitProposal(proposalTransactions, 'Test proposal', dao.proposerAdapterAddress, '0x'),
      ).to.be.revertedWithCustomError(dao.azorius, 'InvalidProposer');

      // Bob stakes to create proposal
      await dao.underlyingToken.connect(signers.bob).approve(
        await dao.stakingToken.getAddress(),
        ethers.parseEther('75'),
      );
      await dao.stakingToken.connect(signers.bob).stake(ethers.parseEther('75'));
      await dao.stakingToken.connect(signers.bob).delegate(signers.bob.address);

      const tx = await dao.azorius
        .connect(signers.bob)
        .submitProposal(proposalTransactions, 'Test proposal', dao.proposerAdapterAddress, '0x');
      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice tries to vote but has no voting power (all unstaked)
      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 0, voteData: '0x' }],
          0,
        ),
      ).to.be.revertedWithCustomError(dao.strategy, 'NoVotingWeight');
    });
  });

  describe('Reward Distribution (if implemented)', () => {
    it('Should allow adding reward tokens to staking contract', async () => {
      const dao = await setupStakedUsers();

      // Deploy a reward token
      const rewardToken = await new MockERC20__factory(signers.deployer).deploy('Reward Token', 'REWARD', 18);

      // Add as reward token
      await dao.stakingToken.addRewardsTokens([await rewardToken.getAddress()]);

      const rewardTokens = await dao.stakingToken.rewardsTokens();
      expect(rewardTokens).to.include(await rewardToken.getAddress());
    });

    it('Should handle native ETH rewards', async () => {
      const dao = await setupStakedUsers();

      const NATIVE_ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

      // Add native ETH as reward token
      await dao.stakingToken.addRewardsTokens([NATIVE_ETH]);

      // Send ETH to staking contract
      await signers.deployer.sendTransaction({
        to: await dao.stakingToken.getAddress(),
        value: ethers.parseEther('10'),
      });

      // Distribute rewards - use the specific function signature
      await dao.stakingToken['distributeRewards(address[])']([NATIVE_ETH]);

      // Check claimable rewards - use specific function signature
      const aliceRewards = await dao.stakingToken['claimableRewards(address,address[])'](signers.alice.address, [NATIVE_ETH]);
      expect(aliceRewards[0]).to.be.gt(0);
    });
  });
});