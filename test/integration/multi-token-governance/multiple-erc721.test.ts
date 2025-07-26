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
  MockERC721,
  MockERC721__factory,
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

// Multiple ERC721 collections governance
interface DeployedMultiERC721DAO {
  safeAddress: string;
  safe: Safe;
  artCollection: MockERC721;
  membershipCollection: MockERC721;
  azorius: ModuleAzoriusV1;
  strategy: StrategyV1;
  artProposerAdapterAddress: string;
  membershipProposerAdapterAddress: string;
}

describe('Multiple ERC721 Collections Governance Integration Tests', () => {
  let signers: BaseSigners;

  async function deployMultiERC721DAO(params: {
    infrastructure: TestInfrastructure;
    signers: BaseSigners;
    owners: string[];
    threshold: number;
    artTokenAllocations: { to: string; tokenIds: number[] }[];
    membershipTokenAllocations: { to: string; tokenIds: number[] }[];
    artProposerThreshold: bigint;
    membershipProposerThreshold: bigint;
    votingPeriod: number;
    quorumThreshold: bigint;
    basisNumerator: bigint;
    timelockPeriod: number;
    executionPeriod: number;
  }): Promise<DeployedMultiERC721DAO> {
    const { infrastructure } = params;

    // Deploy two NFT collections
    const artCollection = await new MockERC721__factory(params.signers.deployer).deploy();
    const membershipCollection = await new MockERC721__factory(params.signers.deployer).deploy();

    // Mint NFTs for art collection
    for (const allocation of params.artTokenAllocations) {
      for (const tokenId of allocation.tokenIds) {
        await artCollection.mintToken(allocation.to, tokenId);
      }
    }

    // Mint NFTs for membership collection
    for (const allocation of params.membershipTokenAllocations) {
      for (const tokenId of allocation.tokenIds) {
        await membershipCollection.mintToken(allocation.to, tokenId);
      }
    }

    // Create deployment parameters
    const salt = ethers.keccak256(ethers.randomBytes(32));

    const azoriusGovernanceParams: ISystemDeployerV1.AzoriusGovernanceParamsStruct = {
      proposerAdapterParams: {
        proposerAdapterERC20V1Params: [],
        proposerAdapterERC721V1Params: [
          {
            implementation: infrastructure.implementations.proposerAdapterERC721V1,
            token: await artCollection.getAddress(),
            proposerThreshold: params.artProposerThreshold,
          },
          {
            implementation: infrastructure.implementations.proposerAdapterERC721V1,
            token: await membershipCollection.getAddress(),
            proposerThreshold: params.membershipProposerThreshold,
          },
        ],
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
        votingConfigERC20V1Params: [],
        votingConfigERC721V1Params: [
          {
            votingWeightImplementation: infrastructure.implementations.votingWeightERC721V1,
            voteTrackerImplementation: infrastructure.implementations.voteTrackerERC721V1,
            token: await artCollection.getAddress(),
            weightPerToken: 1n, // 1 vote per art NFT
          },
          {
            votingWeightImplementation: infrastructure.implementations.votingWeightERC721V1,
            voteTrackerImplementation: infrastructure.implementations.voteTrackerERC721V1,
            token: await membershipCollection.getAddress(),
            weightPerToken: 2n, // 2 votes per membership NFT (more weight)
          },
        ],
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

    // Expected order: ArtProposerAdapter, MembershipProposerAdapter, Strategy, 4x VotingConfigs, Azorius = 8 total
    if (proxyDeployedEvents.length !== 8) {
      throw new Error(`Expected 8 ProxyDeployed events, got ${proxyDeployedEvents.length}`);
    }

    const addresses = proxyDeployedEvents.map(event => {
      const parsedLog = infrastructure.systemDeployer.interface.parseLog({
        topics: event.topics,
        data: event.data,
      });
      return parsedLog?.args[0];
    });

    const [
      artProposerAdapterAddress,
      membershipProposerAdapterAddress,
      strategyAddress,
      ,
      ,
      ,
      ,
      azoriusAddress,
    ] = addresses;

    // Connect to deployed contracts
    const safe = Safe__factory.connect(safeAddress, params.signers.deployer);
    const azorius = ModuleAzoriusV1__factory.connect(azoriusAddress, params.signers.deployer);
    const strategy = StrategyV1__factory.connect(strategyAddress, params.signers.deployer);

    return {
      safeAddress,
      safe,
      artCollection,
      membershipCollection,
      azorius,
      strategy,
      artProposerAdapterAddress,
      membershipProposerAdapterAddress,
    };
  }

  async function setupTestFixture() {
    signers = await getTestSigners();
    const infrastructure = await deployTestInfrastructure(signers.deployer);

    const dao = await deployMultiERC721DAO({
      infrastructure,
      signers,
      owners: [signers.deployer.address],
      threshold: 1,
      artTokenAllocations: [
        { to: signers.alice.address, tokenIds: [1, 2, 3] }, // 3 art NFTs
        { to: signers.bob.address, tokenIds: [4, 5] }, // 2 art NFTs
        { to: signers.charlie.address, tokenIds: [6] }, // 1 art NFT
      ],
      membershipTokenAllocations: [
        { to: signers.alice.address, tokenIds: [101] }, // 1 membership NFT
        { to: signers.bob.address, tokenIds: [102, 103] }, // 2 membership NFTs
        { to: signers.charlie.address, tokenIds: [104, 105, 106] }, // 3 membership NFTs
      ],
      artProposerThreshold: 2n, // Need 2 art NFTs to propose
      membershipProposerThreshold: 1n, // Need 1 membership NFT to propose
      votingPeriod: DEFAULT_GOVERNANCE_PARAMS.votingPeriod,
      quorumThreshold: 8n, // 8 weighted votes for quorum
      basisNumerator: DEFAULT_GOVERNANCE_PARAMS.basisNumerator,
      timelockPeriod: DEFAULT_GOVERNANCE_PARAMS.timelockPeriod,
      executionPeriod: DEFAULT_GOVERNANCE_PARAMS.executionPeriod,
    });

    return { infrastructure, dao };
  }

  describe('DAO Deployment', () => {
    it('Should deploy a multi-ERC721 governance DAO', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      expect(dao.safeAddress).to.not.equal(ethers.ZeroAddress);
      expect(await ethers.provider.getCode(dao.safeAddress)).to.not.equal('0x');
    });

    it('Should correctly distribute NFTs across collections', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Check art collection distribution
      expect(await dao.artCollection.balanceOf(signers.alice.address)).to.equal(3);
      expect(await dao.artCollection.balanceOf(signers.bob.address)).to.equal(2);
      expect(await dao.artCollection.balanceOf(signers.charlie.address)).to.equal(1);

      // Check membership collection distribution
      expect(await dao.membershipCollection.balanceOf(signers.alice.address)).to.equal(1);
      expect(await dao.membershipCollection.balanceOf(signers.bob.address)).to.equal(2);
      expect(await dao.membershipCollection.balanceOf(signers.charlie.address)).to.equal(3);

      // Verify specific token ownership
      expect(await dao.artCollection.ownerOf(1)).to.equal(signers.alice.address);
      expect(await dao.membershipCollection.ownerOf(101)).to.equal(signers.alice.address);
    });

    it('Should configure strategy with both NFT voting configs', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Verify the strategy is deployed
      expect(dao.strategy.target).to.not.equal(ethers.ZeroAddress);
      expect(await ethers.provider.getCode(dao.strategy.target)).to.not.equal('0x');
    });

    it('Should configure both proposer adapters with correct thresholds', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const artProposerAdapter = await ethers.getContractAt(
        'ProposerAdapterERC721V1',
        dao.artProposerAdapterAddress,
      );
      const membershipProposerAdapter = await ethers.getContractAt(
        'ProposerAdapterERC721V1',
        dao.membershipProposerAdapterAddress,
      );

      expect(await artProposerAdapter.token()).to.equal(await dao.artCollection.getAddress());
      expect(await artProposerAdapter.proposerThreshold()).to.equal(2n);

      expect(await membershipProposerAdapter.token()).to.equal(
        await dao.membershipCollection.getAddress(),
      );
      expect(await membershipProposerAdapter.proposerThreshold()).to.equal(1n);
    });
  });

  describe('Multi-NFT Proposer Creation', () => {
    it('Should allow art NFT holders to create proposals', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      // Alice has 3 art NFTs (> 2 threshold)
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Art NFT proposal',
          dao.artProposerAdapterAddress,
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

    it('Should allow membership NFT holders to create proposals', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      // Charlie has 3 membership NFTs (> 1 threshold)
      const tx = await dao.azorius
        .connect(signers.charlie)
        .submitProposal(
          proposalTransactions,
          'Membership NFT proposal',
          dao.membershipProposerAdapterAddress,
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

    it('Should allow users with sufficient NFTs in either collection to choose proposer adapter', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.charlie.address)];

      // Bob has 2 art NFTs (= 2 threshold) and 2 membership NFTs (> 1 threshold)
      // Can use either proposer adapter

      // Test art NFT proposer
      const artTx = await dao.azorius
        .connect(signers.bob)
        .submitProposal(
          proposalTransactions,
          'Bob via art NFTs',
          dao.artProposerAdapterAddress,
          '0x',
        );

      const artReceipt = await artTx.wait();
      const artProposalEvent = findEvent(
        artReceipt!.logs,
        dao.azorius.interface,
        'ProposalCreated',
      );
      expect(artProposalEvent).to.not.be.undefined;

      // Test membership NFT proposer
      const membershipTx = await dao.azorius
        .connect(signers.bob)
        .submitProposal(
          proposalTransactions,
          'Bob via membership NFTs',
          dao.membershipProposerAdapterAddress,
          '0x',
        );

      const membershipReceipt = await membershipTx.wait();
      const membershipProposalEvent = findEvent(
        membershipReceipt!.logs,
        dao.azorius.interface,
        'ProposalCreated',
      );
      expect(membershipProposalEvent).to.not.be.undefined;
    });

    it('Should reject proposals from users without sufficient NFTs', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      // Charlie has only 1 art NFT (< 2 threshold)
      await expect(
        dao.azorius
          .connect(signers.charlie)
          .submitProposal(
            proposalTransactions,
            'Should fail art',
            dao.artProposerAdapterAddress,
            '0x',
          ),
      ).to.be.reverted;

      // Alice has only 1 membership NFT (= 1 threshold), should succeed
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Should succeed membership',
          dao.membershipProposerAdapterAddress,
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

      // Transfer NFTs to create exact threshold scenarios
      await dao.artCollection
        .connect(signers.alice)
        .transferFrom(signers.alice.address, signers.charlie.address, 3);
      // Charlie now has 2 art NFTs (= 2 threshold)

      await dao.membershipCollection
        .connect(signers.alice)
        .transferFrom(signers.alice.address, signers.bob.address, 101);
      // Alice now has 0 membership NFTs (< 1 threshold)

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      // Charlie can now propose via art NFTs
      await expect(
        dao.azorius
          .connect(signers.charlie)
          .submitProposal(
            proposalTransactions,
            'Charlie via art',
            dao.artProposerAdapterAddress,
            '0x',
          ),
      ).to.not.be.reverted;

      // Alice cannot propose via membership NFTs anymore
      await expect(
        dao.azorius
          .connect(signers.alice)
          .submitProposal(
            proposalTransactions,
            'Should fail',
            dao.membershipProposerAdapterAddress,
            '0x',
          ),
      ).to.be.reverted;
    });
  });

  describe('Multi-NFT Voting Process', () => {
    it('Should allow users to vote with art NFTs only', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(proposalTransactions, 'Test proposal', dao.artProposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice votes with art NFTs only (config index 0)
      const artVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2, 3]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: artVoteData }],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(3n); // 3 art NFTs * 1 weight each
    });

    it('Should allow users to vote with membership NFTs only', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(proposalTransactions, 'Test proposal', dao.artProposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Charlie votes with membership NFTs only (config index 1)
      const membershipVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[104, 105, 106]],
      );
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: membershipVoteData }],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(6n); // 3 membership NFTs * 2 weight each
    });

    it('Should allow users to vote with both NFT collections in same transaction', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(proposalTransactions, 'Test proposal', dao.artProposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Bob votes with both NFT types
      const artVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[4, 5]]);
      const membershipVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[102, 103]],
      );

      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [
          { configIndex: 0, voteData: artVoteData }, // 2 art NFTs
          { configIndex: 1, voteData: membershipVoteData }, // 2 membership NFTs
        ],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(6n); // (2 * 1) + (2 * 2) = 6
    });

    it('Should handle different voting weights per NFT collection', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Weight test proposal',
          dao.artProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice: 3 art NFTs (weight 1 each) = 3
      const aliceArtVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2, 3]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: aliceArtVoteData }],
        0,
      );

      // Charlie: 3 membership NFTs (weight 2 each) = 6
      const charlieMembershipVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[104, 105, 106]],
      );
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: charlieMembershipVoteData }],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(9n); // 3 + 6 = 9
    });

    it('Should allow multiple votes with different NFTs within same collection', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(proposalTransactions, 'Test proposal', dao.artProposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice votes with some art NFTs
      const artVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: artVoteData }],
        0,
      );

      // Alice votes again with different art NFT - should succeed
      const secondArtVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[3]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: secondArtVoteData }],
        0,
      );

      // Total should be 3 YES votes
      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(3n);
    });

    it('Should allow voting with one collection after voting with another', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(proposalTransactions, 'Test proposal', dao.artProposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice votes with art NFTs first
      const artVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2, 3]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: artVoteData }],
        0,
      );

      let votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(3n); // 3 art NFTs

      // Alice votes with membership NFT separately
      const membershipVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[101]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: membershipVoteData }],
        0,
      );

      votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(5n); // 3 + (1 * 2) = 5
    });
  });

  describe('Mixed NFT Quorum and Basis Calculations', () => {
    it('Should meet quorum with combined NFT votes from different collections', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(proposalTransactions, 'Quorum test', dao.artProposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Need 8 weighted votes for quorum
      // Alice: 3 art NFTs = 3
      // Bob: 2 membership NFTs = 4
      // Charlie: 1 art NFT = 1
      // Total: 8 (meets quorum)

      const aliceVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2, 3]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: aliceVoteData }],
        0,
      );

      const bobVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[102, 103]]);
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: bobVoteData }],
        0,
      );

      const charlieVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[6]]);
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: charlieVoteData }],
        0,
      );

      // Fast forward past voting period
      await fastForwardTime(DEFAULT_GOVERNANCE_PARAMS.votingPeriod + 1);

      // Proposal should be timelocked (passed quorum and basis)
      expect(await dao.azorius.proposalState(proposalId)).to.equal(1); // TIMELOCKED
    });

    it('Should fail quorum with insufficient combined NFT votes', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Quorum fail test',
          dao.artProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Only vote with 7 weighted votes (< 8 quorum)
      // Alice: 3 art NFTs = 3
      // Bob: 2 art NFTs = 2
      // Total: 5 (fails quorum)

      const aliceVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2, 3]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: aliceVoteData }],
        0,
      );

      const bobVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[4, 5]]);
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: bobVoteData }],
        0,
      );

      // Fast forward past voting period
      await fastForwardTime(DEFAULT_GOVERNANCE_PARAMS.votingPeriod + 1);

      // Proposal should fail (insufficient quorum)
      expect(await dao.azorius.proposalState(proposalId)).to.equal(5); // FAILED
    });

    it('Should handle basis calculation with different NFT weights', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(proposalTransactions, 'Basis test', dao.artProposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // YES: Alice with 1 membership NFT (2 weight) + Bob with 2 art NFTs (2 weight) = 4
      // NO: Charlie with 3 membership NFTs (6 weight) = 6
      // Basis: 4 / (4 + 6) = 40% < 50%

      const aliceVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[101]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: aliceVoteData }],
        0,
      );

      const bobVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[4, 5]]);
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: bobVoteData }],
        0,
      );

      const charlieVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[104, 105, 106]],
      );
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        0, // NO
        [{ configIndex: 1, voteData: charlieVoteData }],
        0,
      );

      // Fast forward past voting period
      await fastForwardTime(DEFAULT_GOVERNANCE_PARAMS.votingPeriod + 1);

      // Proposal should fail (insufficient basis)
      expect(await dao.azorius.proposalState(proposalId)).to.equal(5); // FAILED
    });
  });

  describe('Edge Cases & Error Conditions', () => {
    it('Should handle users with no NFTs trying to vote', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      // Transfer all NFTs away from Alice
      await dao.artCollection
        .connect(signers.alice)
        .transferFrom(signers.alice.address, signers.bob.address, 1);
      await dao.artCollection
        .connect(signers.alice)
        .transferFrom(signers.alice.address, signers.bob.address, 2);
      await dao.artCollection
        .connect(signers.alice)
        .transferFrom(signers.alice.address, signers.bob.address, 3);
      await dao.membershipCollection
        .connect(signers.alice)
        .transferFrom(signers.alice.address, signers.bob.address, 101);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.bob)
        .submitProposal(proposalTransactions, 'Test proposal', dao.artProposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice has no NFTs, trying to vote with empty array should fail
      const emptyVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[]]);
      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 0, voteData: emptyVoteData }],
          0,
        ),
      ).to.be.reverted;
    });

    it('Should handle NFT transfers affecting voting power mid-proposal', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(proposalTransactions, 'Transfer test', dao.artProposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice transfers an art NFT to Bob after proposal creation
      await dao.artCollection
        .connect(signers.alice)
        .transferFrom(signers.alice.address, signers.bob.address, 1);

      // Alice can no longer vote with NFT 1
      const invalidVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2]]);
      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 0, voteData: invalidVoteData }],
          0,
        ),
      ).to.be.reverted;

      // Alice can still vote with NFTs 2 and 3
      const validVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[2, 3]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: validVoteData }],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(2n); // Only 2 NFTs
    });

    it('Should handle extreme quorum scenarios with mixed NFT weights', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      // Transfer all membership NFTs to Charlie (gives him 6 * 2 = 12 weight from membership alone)
      await dao.membershipCollection
        .connect(signers.alice)
        .transferFrom(signers.alice.address, signers.charlie.address, 101);
      await dao.membershipCollection
        .connect(signers.bob)
        .transferFrom(signers.bob.address, signers.charlie.address, 102);
      await dao.membershipCollection
        .connect(signers.bob)
        .transferFrom(signers.bob.address, signers.charlie.address, 103);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.charlie)
        .submitProposal(
          proposalTransactions,
          'Extreme quorum test',
          dao.membershipProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Charlie votes with all 6 membership NFTs (12 weight, > 8 quorum)
      const charlieVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[101, 102, 103, 104, 105, 106]],
      );
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: charlieVoteData }],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(12n); // 6 NFTs * 2 weight each

      // Fast forward past voting period
      await fastForwardTime(DEFAULT_GOVERNANCE_PARAMS.votingPeriod + 1);

      // Proposal should pass (exceeded quorum with single voter)
      expect(await dao.azorius.proposalState(proposalId)).to.equal(1); // TIMELOCKED
    });

    it('Should reject votes with NFTs from wrong collection', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Wrong collection test',
          dao.artProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice tries to vote with membership NFT ID on art collection config
      const wrongCollectionData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[101]]); // Membership NFT ID

      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 0, voteData: wrongCollectionData }], // Art collection config
          0,
        ),
      ).to.be.reverted;
    });
  });

  describe('Complex Multi-NFT Scenarios', () => {
    it('Should handle proposals created via one adapter and voted on with both collections', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      // Proposal created via art NFT adapter
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Cross-collection voting',
          dao.artProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // But users can vote with both collections
      // Alice: art NFTs only
      const aliceArtData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2, 3]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: aliceArtData }],
        0,
      );

      // Bob: both collections
      const bobArtData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[4, 5]]);
      const bobMembershipData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[102, 103]],
      );
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [
          { configIndex: 0, voteData: bobArtData },
          { configIndex: 1, voteData: bobMembershipData },
        ],
        0,
      );

      // Charlie: membership NFTs only
      const charlieMembershipData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[104]],
      );
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: charlieMembershipData }],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      // Alice: 3, Bob: 2 + 4, Charlie: 2 = 11
      expect(votingDetails.yesVotes).to.equal(11n);
    });

    it('Should handle large-scale mixed NFT voting with many participants', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      // Mint additional NFTs for a larger test
      await dao.artCollection.mintToken(signers.alice.address, 7);
      await dao.artCollection.mintToken(signers.alice.address, 8);
      await dao.membershipCollection.mintToken(signers.bob.address, 107);

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Large scale test',
          dao.artProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Multiple complex votes
      // Alice: 5 art NFTs + 1 membership NFT
      const aliceArtData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[1, 2, 3, 7, 8]],
      );
      const aliceMembershipData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[101]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [
          { configIndex: 0, voteData: aliceArtData },
          { configIndex: 1, voteData: aliceMembershipData },
        ],
        0,
      );

      // Bob: 2 art NFTs + 3 membership NFTs
      const bobArtData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[4, 5]]);
      const bobMembershipData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[102, 103, 107]],
      );
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        0, // NO
        [
          { configIndex: 0, voteData: bobArtData },
          { configIndex: 1, voteData: bobMembershipData },
        ],
        0,
      );

      // Charlie: 1 art NFT + 3 membership NFTs
      const charlieArtData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[6]]);
      const charlieMembershipData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[104, 105, 106]],
      );
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        2, // ABSTAIN
        [
          { configIndex: 0, voteData: charlieArtData },
          { configIndex: 1, voteData: charlieMembershipData },
        ],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      // YES: 5 + 2 = 7
      // NO: 2 + 6 = 8
      // ABSTAIN: 1 + 6 = 7
      expect(votingDetails.yesVotes).to.equal(7n);
      expect(votingDetails.noVotes).to.equal(8n);
      expect(votingDetails.abstainVotes).to.equal(7n);

      // Fast forward past voting period
      await fastForwardTime(DEFAULT_GOVERNANCE_PARAMS.votingPeriod + 1);

      // Should fail (NO > YES)
      expect(await dao.azorius.proposalState(proposalId)).to.equal(5); // FAILED
    });
  });

  describe('Proposal Execution', () => {
    it('Should execute proposal that passed via mixed NFT collection voting', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress, ethers.parseEther('10'));

      const proposalTransactions = [
        createTestTransaction(signers.alice.address, ethers.parseEther('2')),
      ];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(proposalTransactions, 'Execute test', dao.artProposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Mixed voting to pass proposal
      // Alice: 3 art NFTs + 1 membership NFT = 5 weight
      const aliceArtData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2, 3]]);
      const aliceMembershipData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[101]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [
          { configIndex: 0, voteData: aliceArtData },
          { configIndex: 1, voteData: aliceMembershipData },
        ],
        0,
      );

      // Bob: 2 membership NFTs = 4 weight
      const bobMembershipData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[102, 103]],
      );
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: bobMembershipData }],
        0,
      );

      // Total: 9 weight > 8 quorum

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
