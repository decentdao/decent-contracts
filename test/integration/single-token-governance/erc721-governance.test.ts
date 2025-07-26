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

// ERC721-specific types
interface DeployedERC721DAO {
  safeAddress: string;
  safe: Safe;
  nft: MockERC721;
  azorius: ModuleAzoriusV1;
  strategy: StrategyV1;
  proposerAdapterAddress: string;
}

describe('ERC721 Governance Integration Tests', () => {
  let signers: BaseSigners;

  async function deployERC721DAO(params: {
    infrastructure: TestInfrastructure;
    signers: BaseSigners;
    owners: string[];
    threshold: number;
    nftName: string;
    nftSymbol: string;
    nftAllocations: { to: string; tokenIds: number[] }[];
    proposerThreshold: bigint;
    votingPeriod: number;
    quorumThreshold: bigint;
    basisNumerator: bigint;
    timelockPeriod: number;
    executionPeriod: number;
  }): Promise<DeployedERC721DAO> {
    const { infrastructure } = params;

    // Deploy NFT contract
    const nft = await new MockERC721__factory(params.signers.deployer).deploy();

    // Mint NFTs to users using mintToken for specific token IDs
    for (const allocation of params.nftAllocations) {
      for (const tokenId of allocation.tokenIds) {
        await nft.mintToken(allocation.to, tokenId);
      }
    }

    // Create deployment parameters
    const salt = ethers.keccak256(ethers.randomBytes(32));

    // No ERC20 tokens for this DAO
    const votesERC20Params: ISystemDeployerV1.VotesERC20V1ParamsStruct[] = [];

    const azoriusGovernanceParams: ISystemDeployerV1.AzoriusGovernanceParamsStruct = {
      proposerAdapterParams: {
        proposerAdapterERC20V1Params: [],
        proposerAdapterERC721V1Params: [
          {
            implementation: infrastructure.implementations.proposerAdapterERC721V1,
            token: await nft.getAddress(),
            proposerThreshold: params.proposerThreshold,
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
            token: await nft.getAddress(),
            weightPerToken: 1n,
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

    // Expected order: ProposerAdapter, Strategy, VotingWeight, VoteTracker, Azorius
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
    const safe = Safe__factory.connect(safeAddress, signers.deployer);
    const azorius = ModuleAzoriusV1__factory.connect(azoriusAddress, signers.deployer);
    const strategy = StrategyV1__factory.connect(strategyAddress, signers.deployer);

    return {
      safeAddress,
      safe,
      nft,
      azorius,
      strategy,
      proposerAdapterAddress,
    };
  }

  async function setupTestFixture() {
    signers = await getTestSigners();
    const infrastructure = await deployTestInfrastructure(signers.deployer);

    const dao = await deployERC721DAO({
      infrastructure,
      signers,
      owners: [signers.deployer.address],
      threshold: 1,
      nftName: 'Test DAO NFT',
      nftSymbol: 'TDNFT',
      nftAllocations: [
        { to: signers.alice.address, tokenIds: [1, 2, 3, 4, 5] }, // 5 NFTs
        { to: signers.bob.address, tokenIds: [6, 7, 8, 9, 10] }, // 5 NFTs
        { to: signers.charlie.address, tokenIds: [11, 12, 13] }, // 3 NFTs
      ],
      proposerThreshold: 2n, // Need at least 2 NFTs to propose
      votingPeriod: DEFAULT_GOVERNANCE_PARAMS.votingPeriod,
      quorumThreshold: 5n, // Need at least 5 NFT votes for quorum
      basisNumerator: DEFAULT_GOVERNANCE_PARAMS.basisNumerator,
      timelockPeriod: DEFAULT_GOVERNANCE_PARAMS.timelockPeriod,
      executionPeriod: DEFAULT_GOVERNANCE_PARAMS.executionPeriod,
    });

    return { infrastructure, dao, signers };
  }

  describe('DAO Deployment', () => {
    it('Should deploy a basic ERC721 governance DAO', async () => {
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

    it('Should correctly distribute NFTs to allocations', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Check NFT balances
      expect(await dao.nft.balanceOf(signers.alice.address)).to.equal(5);
      expect(await dao.nft.balanceOf(signers.bob.address)).to.equal(5);
      expect(await dao.nft.balanceOf(signers.charlie.address)).to.equal(3);

      // Verify specific token ownership
      expect(await dao.nft.ownerOf(1)).to.equal(signers.alice.address);
      expect(await dao.nft.ownerOf(6)).to.equal(signers.bob.address);
      expect(await dao.nft.ownerOf(11)).to.equal(signers.charlie.address);
    });

    it('Should configure strategy with correct parameters', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      expect(await dao.strategy.votingPeriod()).to.equal(3600);
      expect(await dao.strategy.quorumThreshold()).to.equal(5n);
      expect(await dao.strategy.basisNumerator()).to.equal(500000n);
    });
  });

  describe('Proposal Creation', () => {
    it('Should allow proposers with sufficient NFTs to create proposals', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Alice has 5 NFTs, threshold is 2, so she can propose
      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Send 1 ETH to Bob',
          dao.proposerAdapterAddress,
          '0x',
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

    it('Should reject proposals from addresses with insufficient NFTs', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Create a user with only 1 NFT (below threshold of 2)
      const [, , , , lowNFTUser] = await ethers.getSigners();
      await dao.nft.mintToken(lowNFTUser.address, 100);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      // Should fail to propose with only 1 NFT
      await expect(
        dao.azorius
          .connect(lowNFTUser)
          .submitProposal(proposalTransactions, 'Should fail', dao.proposerAdapterAddress, '0x'),
      ).to.be.reverted;
    });
  });

  describe('Voting Process', () => {
    async function setupProposal() {
      const { dao } = await loadFixture(setupTestFixture);

      // Fund the Safe so it can send ETH
      await fundSafe(signers.deployer, dao.safeAddress);

      // Alice creates a proposal
      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Send 1 ETH to Bob',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      return { dao, signers, proposalId, proposalTransactions };
    }

    it('Should allow NFT holders to cast YES votes with specific token IDs', async () => {
      const { dao, proposalId } = await setupProposal();

      // Alice votes YES with NFTs 1, 2, 3 (3 votes)
      const voteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2, 3]]);

      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [
          {
            configIndex: 0,
            voteData,
          },
        ],
        0, // lightAccountIndex
      );

      // Check voting details
      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(3n); // 3 NFTs = 3 votes
      expect(votingDetails.noVotes).to.equal(0);
      expect(votingDetails.abstainVotes).to.equal(0);
    });

    it('Should allow NFT holders to cast NO votes', async () => {
      const { dao, proposalId } = await setupProposal();

      // Bob votes NO with NFTs 6, 7 (2 votes)
      const voteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[6, 7]]);

      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        0, // NO
        [
          {
            configIndex: 0,
            voteData,
          },
        ],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(0);
      expect(votingDetails.noVotes).to.equal(2n); // 2 NFTs = 2 votes
      expect(votingDetails.abstainVotes).to.equal(0);
    });

    it('Should allow NFT holders to cast ABSTAIN votes', async () => {
      const { dao, proposalId } = await setupProposal();

      // Charlie abstains with all his NFTs (3 votes)
      const voteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[11, 12, 13]]);

      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        2, // ABSTAIN
        [
          {
            configIndex: 0,
            voteData,
          },
        ],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(0);
      expect(votingDetails.noVotes).to.equal(0);
      expect(votingDetails.abstainVotes).to.equal(3n); // 3 NFTs = 3 votes
    });

    it('Should prevent double voting with the same NFT', async () => {
      const { dao, proposalId } = await setupProposal();

      // Alice votes with NFT 1
      const voteData1 = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1]]);

      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: voteData1 }],
        0,
      );

      // Try to vote again with the same NFT
      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          0, // NO
          [{ configIndex: 0, voteData: voteData1 }],
          0,
        ),
      ).to.be.reverted;
    });

    it('Should allow multiple separate votes with different NFTs from same user', async () => {
      const { dao, proposalId } = await setupProposal();

      // Alice votes with NFT 1
      const voteData1 = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1]]);

      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: voteData1 }],
        0,
      );

      // Alice votes again with different NFTs (2, 3)
      const voteData2 = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[2, 3]]);

      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: voteData2 }],
        0,
      );

      // Total should be 3 YES votes (1 + 2)
      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(3n);
    });

    it('Should reject votes with non-owned NFTs', async () => {
      const { dao, proposalId } = await setupProposal();

      // Alice tries to vote with Bob's NFT (6)
      const voteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[6]], // This is Bob's NFT
      );

      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 0, voteData }],
          0,
        ),
      ).to.be.reverted;
    });
  });

  describe('Edge Cases & Error Conditions', () => {
    it('Should fail proposals that do not meet quorum threshold', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Should fail - no quorum',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Charlie votes with only 3 NFTs (quorum needs 5)
      const voteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[11, 12, 13]]);

      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData }],
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

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Should fail - insufficient basis',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice votes YES with 2 NFTs
      const aliceVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2]]);

      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: aliceVoteData }],
        0,
      );

      // Bob votes NO with 3 NFTs (creates 2 YES vs 3 NO = 40% YES)
      const bobVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[6, 7, 8]]);

      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        0, // NO
        [{ configIndex: 0, voteData: bobVoteData }],
        0,
      );

      // Charlie abstains to meet quorum (need 5 total for quorum: 2 YES + 3 ABSTAIN = 5)
      const charlieVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[11, 12, 13]],
      );

      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        2, // ABSTAIN
        [{ configIndex: 0, voteData: charlieVoteData }],
        0,
      );

      // Fast forward past voting period
      await fastForwardTime(3601);

      // Should be FAILED due to insufficient basis (40% < 50%)
      expect(await dao.azorius.proposalState(proposalId)).to.equal(5); // FAILED
      expect(await dao.strategy.isQuorumMet(proposalId)).to.be.true;
      expect(await dao.strategy.isBasisMet(proposalId)).to.be.false;
    });

    it('Should handle users with no NFTs', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Create a user with no NFTs
      const [, , , , noNFTUser] = await ethers.getSigners();

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(proposalTransactions, 'No NFT user test', dao.proposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // User with no NFTs cannot vote
      const voteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[1]], // Doesn't own this NFT
      );

      await expect(
        dao.strategy.connect(noNFTUser).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 0, voteData }],
          0,
        ),
      ).to.be.reverted;
    });

    it('Should expire proposals after execution period', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(proposalTransactions, 'Should expire', dao.proposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Cast enough votes to pass (need quorum of 5 and >50% approval)
      const aliceVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2, 3]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: aliceVoteData }],
        0,
      );

      const bobVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[6, 7]]);
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: bobVoteData }],
        0,
      );

      // Fast forward past voting period + timelock period + execution period
      await fastForwardTime(3600 + 1800 + 86400 + 1);

      // Should be EXPIRED
      expect(await dao.azorius.proposalState(proposalId)).to.equal(4); // EXPIRED

      // Execution should fail
      await expect(dao.azorius.executeProposal(proposalId, proposalTransactions)).to.be.reverted;
    });

    it('Should prevent voting after voting period ends', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Voting period test',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Fast forward past voting period
      await fastForwardTime(3601);

      // Check voting details before attempting to vote
      const votingDetailsBefore = await dao.strategy.proposalVotingDetails(proposalId);

      // Try to vote after period ends - should either revert or emit VotingPeriodEnded
      const voteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2]]);

      try {
        const voteResult = await dao.strategy.connect(signers.alice).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 0, voteData }],
          0,
        );

        // If it doesn't revert, check that vote counts didn't change
        const votingDetailsAfter = await dao.strategy.proposalVotingDetails(proposalId);
        expect(votingDetailsAfter.yesVotes).to.equal(votingDetailsBefore.yesVotes);
        expect(votingDetailsAfter.noVotes).to.equal(votingDetailsBefore.noVotes);
        expect(votingDetailsAfter.abstainVotes).to.equal(votingDetailsBefore.abstainVotes);

        // And check for VotingPeriodEnded event
        const voteReceipt = await voteResult.wait();
        const votingEndedEvent = voteReceipt?.logs.find(log => {
          try {
            const parsedLog = dao.strategy.interface.parseLog({
              topics: log.topics,
              data: log.data,
            });
            return parsedLog?.name === 'VotingPeriodEnded';
          } catch {
            return false;
          }
        });
        expect(votingEndedEvent).to.not.be.undefined;
      } catch (error) {
        // Should revert with ProposalNotActive or similar
        expect(error).to.have.property('message');
        expect((error as Error).message).to.include('ProposalNotActive');
      }
    });

    it('Should handle proposals with insufficient Safe balance', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Don't fund the Safe - it has 0 ETH
      const proposalTransactions = [
        createTestTransaction(signers.bob.address, ethers.parseEther('10')),
      ];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Insufficient balance test',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Pass the proposal
      const aliceVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2, 3]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: aliceVoteData }],
        0,
      );

      const bobVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[6, 7]]);
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: bobVoteData }],
        0,
      );

      // Fast forward past voting and timelock periods
      await fastForwardTime(3600 + 1800 + 1);

      // Should be EXECUTABLE
      expect(await dao.azorius.proposalState(proposalId)).to.equal(2); // EXECUTABLE

      // Execution should fail due to insufficient balance
      await expect(dao.azorius.executeProposal(proposalId, proposalTransactions)).to.be.reverted;
    });

    it('Should reject invalid vote types', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Invalid vote type test',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      const voteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2]]);

      // Try to vote with invalid vote type (3, should be 0-2)
      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          3, // INVALID
          [{ configIndex: 0, voteData }],
          0,
        ),
      ).to.be.reverted;
    });

    it('Should reject votes with invalid voting config index', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Invalid config test',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      const voteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2]]);

      // Try to vote with invalid config index (1, should be 0 for single-token DAO)
      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 1, voteData }], // Invalid index
          0,
        ),
      ).to.be.reverted;
    });

    it('Should reject votes with invalid token ID encoding', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Invalid encoding test',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Try to vote with malformed vote data (wrong encoding)
      const invalidVoteData = '0x1234'; // Not properly encoded uint256[]

      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 0, voteData: invalidVoteData }],
          0,
        ),
      ).to.be.reverted;
    });

    it('Should reject votes with non-existent token IDs', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Non-existent token test',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Try to vote with token IDs that don't exist (999, 1000)
      const voteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[999, 1000]]);

      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 0, voteData }],
          0,
        ),
      ).to.be.reverted;
    });
  });

  describe('Complex Scenarios', () => {
    it('Should handle multi-transaction proposals', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress, ethers.parseEther('10'));

      const proposalTransactions = [
        createTestTransaction(signers.bob.address, ethers.parseEther('1')),
        createTestTransaction(signers.charlie.address, ethers.parseEther('2')),
        createTestTransaction(signers.alice.address, ethers.parseEther('0.5')),
      ];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Multi-transaction proposal',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Pass the proposal
      const aliceVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2, 3]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: aliceVoteData }],
        0,
      );

      const bobVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[6, 7]]);
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: bobVoteData }],
        0,
      );

      // Fast forward past voting and timelock periods
      await fastForwardTime(3600 + 1800 + 1);

      // Check balances before execution
      const bobBalanceBefore = await ethers.provider.getBalance(signers.bob.address);
      const charlieBalanceBefore = await ethers.provider.getBalance(signers.charlie.address);
      const aliceBalanceBefore = await ethers.provider.getBalance(signers.alice.address);

      // Execute all transactions
      await dao.azorius.executeProposal(proposalId, proposalTransactions);

      // Verify all transactions were executed
      const bobBalanceAfter = await ethers.provider.getBalance(signers.bob.address);
      const charlieBalanceAfter = await ethers.provider.getBalance(signers.charlie.address);
      const aliceBalanceAfter = await ethers.provider.getBalance(signers.alice.address);

      expect(bobBalanceAfter).to.equal(bobBalanceBefore + ethers.parseEther('1'));
      expect(charlieBalanceAfter).to.equal(charlieBalanceBefore + ethers.parseEther('2'));
      expect(aliceBalanceAfter).to.equal(aliceBalanceBefore + ethers.parseEther('0.5'));

      expect(await dao.azorius.proposalState(proposalId)).to.equal(3); // EXECUTED
    });

    it('Should handle proposals with zero value transfers', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address, 0n)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Zero value proposal',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Pass and execute the proposal
      const aliceVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2, 3]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: aliceVoteData }],
        0,
      );

      const bobVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[6, 7]]);
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: bobVoteData }],
        0,
      );

      // Fast forward past voting and timelock periods
      await fastForwardTime(3600 + 1800 + 1);

      // Should execute successfully even with zero value
      await dao.azorius.executeProposal(proposalId, proposalTransactions);
      expect(await dao.azorius.proposalState(proposalId)).to.equal(3); // EXECUTED
    });

    it('Should handle exact quorum threshold votes', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Exact quorum test',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Vote with exactly 5 NFTs (the quorum threshold)
      const aliceVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[1, 2, 3, 4, 5]],
      );
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: aliceVoteData }],
        0,
      );

      // Fast forward past voting period
      await fastForwardTime(3601);

      // Should pass with exactly the quorum threshold
      expect(await dao.azorius.proposalState(proposalId)).to.equal(1); // TIMELOCKED (passed)
      expect(await dao.strategy.isQuorumMet(proposalId)).to.be.true;
      expect(await dao.strategy.isBasisMet(proposalId)).to.be.true;
    });

    it('Should handle exact basis threshold votes', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(proposalTransactions, 'Exact basis test', dao.proposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Create a scenario where YES votes are just above 50%
      // Alice votes YES with 3 NFTs, Bob votes NO with 2 NFTs
      // Charlie abstains with 2 NFTs to meet quorum (3 YES + 2 ABSTAIN = 5 for quorum)
      // Basis: 3/(3+2) = 60% > 50%
      const aliceVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2, 3]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: aliceVoteData }],
        0,
      );

      const bobVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[6, 7]]);
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        0, // NO
        [{ configIndex: 0, voteData: bobVoteData }],
        0,
      );

      // Charlie abstains to meet quorum (quorum = YES + ABSTAIN votes)
      const charlieVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[11, 12]]);
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        2, // ABSTAIN
        [{ configIndex: 0, voteData: charlieVoteData }],
        0,
      );

      // Fast forward past voting period
      await fastForwardTime(3601);

      // Should pass with basis and quorum met
      // Quorum: 3 YES + 2 ABSTAIN = 5 (meets threshold of 5)
      // Basis: 3 YES / (3 YES + 2 NO) = 60% > 50%
      expect(await dao.strategy.isQuorumMet(proposalId)).to.be.true;
      expect(await dao.strategy.isBasisMet(proposalId)).to.be.true;
      expect(await dao.azorius.proposalState(proposalId)).to.equal(1); // TIMELOCKED
    });
  });

  describe('NFT Management', () => {
    it('Should handle NFT transfers between users', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Alice transfers one of her NFTs to Bob
      await dao.nft
        .connect(signers.alice)
        .transferFrom(signers.alice.address, signers.bob.address, 5);

      // Verify the transfer
      expect(await dao.nft.ownerOf(5)).to.equal(signers.bob.address);
      expect(await dao.nft.balanceOf(signers.alice.address)).to.equal(4);
      expect(await dao.nft.balanceOf(signers.bob.address)).to.equal(6);

      const proposalTransactions = [createTestTransaction(signers.charlie.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'NFT transfer test',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice can now only vote with NFTs 1, 2, 3, 4 (not 5)
      const aliceVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2, 3, 4]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: aliceVoteData }],
        0,
      );

      // Bob can now vote with NFTs 5, 6, 7, 8, 9, 10
      const bobVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[5, 6]]);
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: bobVoteData }],
        0,
      );

      // Verify vote counts
      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(6n); // 4 + 2 = 6 votes
    });

    it('Should handle edge case with empty token ID arrays', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(proposalTransactions, 'Empty array test', dao.proposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Try to vote with empty token ID array
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

    it('Should handle users trying to vote with mixed owned/non-owned NFTs', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Mixed ownership test',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice tries to vote with both her NFTs (1, 2) and Bob's NFT (6)
      const mixedVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2, 6]]);

      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 0, voteData: mixedVoteData }],
          0,
        ),
      ).to.be.reverted;
    });
  });

  describe('Proposal Execution', () => {
    async function setupPassedProposal() {
      const { dao } = await loadFixture(setupTestFixture);

      // Fund the Safe
      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      // Create proposal
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Send 1 ETH to Bob',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Cast enough votes to pass (need quorum of 5 and >50% approval)

      // Alice votes YES with 3 NFTs
      const aliceVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2, 3]]);

      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: aliceVoteData }],
        0,
      );

      // Bob votes YES with 2 NFTs (total 5 YES votes)
      const bobVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[6, 7]]);

      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: bobVoteData }],
        0,
      );

      return { dao, signers, proposalId, proposalTransactions };
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
