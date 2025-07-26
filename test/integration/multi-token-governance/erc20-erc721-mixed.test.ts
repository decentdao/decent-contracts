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
  delegateTokens,
} from '../shared/helpers';

// Mixed governance types
interface DeployedMixedDAO {
  safeAddress: string;
  safe: Safe;
  token: VotesERC20V1;
  nft: MockERC721;
  azorius: ModuleAzoriusV1;
  strategy: StrategyV1;
  erc20ProposerAdapterAddress: string;
  erc721ProposerAdapterAddress: string;
}

describe('ERC20 + ERC721 Mixed Governance Integration Tests', () => {
  let signers: BaseSigners;

  async function deployMixedDAO(params: {
    infrastructure: TestInfrastructure;
    signers: BaseSigners;
    owners: string[];
    threshold: number;
    tokenName: string;
    tokenSymbol: string;
    tokenAllocations: { to: string; amount: bigint }[];
    nftAllocations: { to: string; tokenIds: number[] }[];
    erc20ProposerThreshold: bigint;
    erc721ProposerThreshold: bigint;
    votingPeriod: number;
    quorumThreshold: bigint;
    basisNumerator: bigint;
    timelockPeriod: number;
    executionPeriod: number;
  }): Promise<DeployedMixedDAO> {
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
        proposerAdapterERC20V1Params: [
          {
            implementation: infrastructure.implementations.proposerAdapterERC20V1,
            token: ethers.ZeroAddress, // Will use newly deployed token
            newTokenIndex: 0,
            proposerThreshold: params.erc20ProposerThreshold,
          },
        ],
        proposerAdapterERC721V1Params: [
          {
            implementation: infrastructure.implementations.proposerAdapterERC721V1,
            token: await nft.getAddress(),
            proposerThreshold: params.erc721ProposerThreshold,
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
        votingConfigERC20V1Params: [
          {
            votingWeightImplementation: infrastructure.implementations.votingWeightERC20V1,
            voteTrackerImplementation: infrastructure.implementations.voteTrackerERC20V1,
            token: ethers.ZeroAddress, // Will use newly deployed token
            newTokenIndex: 0,
            weightPerToken: 1n,
          },
        ],
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

    // Expected order: Token, ERC20ProposerAdapter, ERC721ProposerAdapter, Strategy, ERC20VotingWeight, ERC20VoteTracker, ERC721VotingWeight, ERC721VoteTracker, Azorius
    if (proxyDeployedEvents.length !== 9) {
      throw new Error(`Expected 9 ProxyDeployed events, got ${proxyDeployedEvents.length}`);
    }

    const addresses = proxyDeployedEvents.map(event => {
      const parsedLog = infrastructure.systemDeployer.interface.parseLog({
        topics: event.topics,
        data: event.data,
      });
      return parsedLog?.args[0];
    });

    const [
      tokenAddress,
      erc20ProposerAdapterAddress,
      erc721ProposerAdapterAddress,
      strategyAddress,
      ,
      ,
      ,
      ,
      azoriusAddress,
    ] = addresses;

    // Connect to deployed contracts
    const safe = Safe__factory.connect(safeAddress, signers.deployer);
    const token = VotesERC20V1__factory.connect(tokenAddress, signers.deployer);
    const azorius = ModuleAzoriusV1__factory.connect(azoriusAddress, signers.deployer);
    const strategy = StrategyV1__factory.connect(strategyAddress, signers.deployer);

    return {
      safeAddress,
      safe,
      token,
      nft,
      azorius,
      strategy,
      erc20ProposerAdapterAddress,
      erc721ProposerAdapterAddress,
    };
  }

  async function setupTestFixture() {
    signers = await getTestSigners();
    const infrastructure = await deployTestInfrastructure(signers.deployer);

    const dao = await deployMixedDAO({
      infrastructure,
      signers,
      owners: [signers.deployer.address],
      threshold: 1,
      tokenName: 'Test DAO Token',
      tokenSymbol: 'TEST',
      tokenAllocations: [
        { to: signers.alice.address, amount: ethers.parseEther('100') },
        { to: signers.bob.address, amount: ethers.parseEther('75') },
        { to: signers.charlie.address, amount: ethers.parseEther('50') },
      ],
      nftAllocations: [
        { to: signers.alice.address, tokenIds: [1, 2] }, // 2 NFTs
        { to: signers.bob.address, tokenIds: [3, 4, 5, 6] }, // 4 NFTs
        { to: signers.charlie.address, tokenIds: [7, 8, 9] }, // 3 NFTs
      ],
      erc20ProposerThreshold: ethers.parseEther('50'), // Need 50 tokens to propose
      erc721ProposerThreshold: 3n, // Need 3 NFTs to propose
      votingPeriod: DEFAULT_GOVERNANCE_PARAMS.votingPeriod,
      quorumThreshold: ethers.parseEther('80'), // 80 token-equivalent votes for quorum
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
    it('Should deploy a mixed ERC20+ERC721 governance DAO', async () => {
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

    it('Should correctly distribute tokens and NFTs', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Check token balances
      expect(await dao.token.balanceOf(signers.alice.address)).to.equal(ethers.parseEther('100'));
      expect(await dao.token.balanceOf(signers.bob.address)).to.equal(ethers.parseEther('75'));
      expect(await dao.token.balanceOf(signers.charlie.address)).to.equal(ethers.parseEther('50'));

      // Check NFT balances
      expect(await dao.nft.balanceOf(signers.alice.address)).to.equal(2);
      expect(await dao.nft.balanceOf(signers.bob.address)).to.equal(4);
      expect(await dao.nft.balanceOf(signers.charlie.address)).to.equal(3);

      // Verify specific NFT ownership
      expect(await dao.nft.ownerOf(1)).to.equal(signers.alice.address);
      expect(await dao.nft.ownerOf(3)).to.equal(signers.bob.address);
      expect(await dao.nft.ownerOf(7)).to.equal(signers.charlie.address);
    });

    it('Should configure strategy with both voting configs', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      expect(await dao.strategy.votingPeriod()).to.equal(3600);
      expect(await dao.strategy.quorumThreshold()).to.equal(ethers.parseEther('80'));
      expect(await dao.strategy.basisNumerator()).to.equal(500000n);

      // Should have 2 voting configs (ERC20 + ERC721)
      const votingConfigs = await dao.strategy.votingConfigs();
      expect(votingConfigs.length).to.equal(2);
    });

    it('Should configure both proposer adapters', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Both proposer adapters should be valid
      expect(dao.erc20ProposerAdapterAddress).to.not.equal(ethers.ZeroAddress);
      expect(dao.erc721ProposerAdapterAddress).to.not.equal(ethers.ZeroAddress);
      expect(dao.erc20ProposerAdapterAddress).to.not.equal(dao.erc721ProposerAdapterAddress);

      const proposerAdapters = await dao.strategy.proposerAdapters();
      expect(proposerAdapters.length).to.equal(2);
      expect(proposerAdapters).to.include(dao.erc20ProposerAdapterAddress);
      expect(proposerAdapters).to.include(dao.erc721ProposerAdapterAddress);
    });
  });

  describe('Multi-Proposer Creation', () => {
    it('Should allow ERC20 token holders to create proposals', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Alice has 100 tokens (>= 50 threshold)
      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'ERC20 proposal',
          dao.erc20ProposerAdapterAddress,
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

    it('Should allow ERC721 NFT holders to create proposals', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Bob has 4 NFTs (>= 3 threshold)
      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      const tx = await dao.azorius
        .connect(signers.bob)
        .submitProposal(
          proposalTransactions,
          'ERC721 proposal',
          dao.erc721ProposerAdapterAddress,
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

      expect(await dao.azorius.proposalState(proposalId)).to.equal(0);
    });

    it('Should allow users with both sufficient tokens AND NFTs to choose proposer type', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Alice has 100 tokens and 2 NFTs, but NFTs < 3 threshold
      // She can propose via ERC20 but not ERC721
      const proposalTransactions = [createTestTransaction(signers.charlie.address)];

      // Should succeed with ERC20 proposer
      const tx1 = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Alice ERC20 proposal',
          dao.erc20ProposerAdapterAddress,
          '0x',
        );

      const receipt1 = await tx1.wait();
      const proposalCreatedEvent1 = findEvent(
        receipt1!.logs,
        dao.azorius.interface,
        'ProposalCreated',
      );
      expect(proposalCreatedEvent1).to.not.be.undefined;

      // Should fail with ERC721 proposer (only 2 NFTs, need 3)
      await expect(
        dao.azorius
          .connect(signers.alice)
          .submitProposal(
            proposalTransactions,
            'Alice ERC721 proposal',
            dao.erc721ProposerAdapterAddress,
            '0x',
          ),
      ).to.be.reverted;
    });

    it('Should reject proposals from users without sufficient tokens or NFTs', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      // Charlie has 50 tokens (= 50 threshold) so can propose via ERC20
      // Test with someone who has insufficient tokens - transfer some away first
      await dao.token
        .connect(signers.charlie)
        .transfer(signers.bob.address, ethers.parseEther('25'));

      // Charlie now has 25 tokens (< 50 threshold), should fail via ERC20 proposer
      await expect(
        dao.azorius
          .connect(signers.charlie)
          .submitProposal(
            proposalTransactions,
            'Should fail ERC20',
            dao.erc20ProposerAdapterAddress,
            '0x',
          ),
      ).to.be.reverted;

      // Should succeed via ERC721 proposer
      const tx = await dao.azorius
        .connect(signers.charlie)
        .submitProposal(
          proposalTransactions,
          'Should succeed ERC721',
          dao.erc721ProposerAdapterAddress,
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

    it('Should handle edge case users at exact thresholds', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Give Charlie exactly 50 tokens (exact ERC20 threshold)
      await dao.token
        .connect(signers.alice)
        .transfer(signers.charlie.address, ethers.parseEther('50'));

      const proposalTransactions = [createTestTransaction(signers.alice.address)];

      // Charlie now has exactly 50 tokens + 50 = 100 tokens, should be able to propose via ERC20
      const tx = await dao.azorius
        .connect(signers.charlie)
        .submitProposal(
          proposalTransactions,
          'Exact threshold proposal',
          dao.erc20ProposerAdapterAddress,
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
  });

  describe('Mixed Voting Process', () => {
    async function setupMixedProposal() {
      const { dao } = await loadFixture(setupTestFixture);

      // Fund the Safe so it can send ETH
      await fundSafe(signers.deployer, dao.safeAddress);

      // Alice creates a proposal using ERC20 proposer
      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Mixed voting test',
          dao.erc20ProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      return { dao, proposalId, proposalTransactions };
    }

    it('Should allow users to vote with ERC20 tokens only', async () => {
      const { dao, proposalId } = await setupMixedProposal();

      // Alice votes with tokens only (config index 0)
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }], // ERC20 config
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('100')); // Alice's token voting weight
      expect(votingDetails.noVotes).to.equal(0);
      expect(votingDetails.abstainVotes).to.equal(0);
    });

    it('Should allow users to vote with ERC721 NFTs only', async () => {
      const { dao, proposalId } = await setupMixedProposal();

      // Bob votes with NFTs only (config index 1)
      const nftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[3, 4, 5]]);

      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: nftVoteData }], // ERC721 config
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(3n); // 3 NFTs = 3 votes
      expect(votingDetails.noVotes).to.equal(0);
      expect(votingDetails.abstainVotes).to.equal(0);
    });

    it('Should allow users to vote with both tokens AND NFTs in same transaction', async () => {
      const { dao, proposalId } = await setupMixedProposal();

      // Alice votes with both tokens and NFTs
      const nftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2]]);

      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [
          { configIndex: 0, voteData: '0x' }, // ERC20 config
          { configIndex: 1, voteData: nftVoteData }, // ERC721 config
        ],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      // Combined voting weight: 100 tokens + 2 NFTs = 102 total voting weight
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('100') + 2n);
      expect(votingDetails.noVotes).to.equal(0);
      expect(votingDetails.abstainVotes).to.equal(0);
    });

    it('Should allow different users to vote with different asset types', async () => {
      const { dao, proposalId } = await setupMixedProposal();

      // Alice votes with tokens
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Bob votes with NFTs
      const bobNftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[3, 4]]);
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: bobNftVoteData }],
        0,
      );

      // Charlie votes with both
      const charlieNftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[7]]);
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [
          { configIndex: 0, voteData: '0x' }, // 50 tokens
          { configIndex: 1, voteData: charlieNftVoteData }, // 1 NFT
        ],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      // Total: 100 (Alice tokens) + 2 (Bob NFTs) + 50 (Charlie tokens) + 1 (Charlie NFT) = 153
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('150') + 3n);
    });

    it('Should handle mixed YES/NO/ABSTAIN votes across asset types', async () => {
      const { dao, proposalId } = await setupMixedProposal();

      // Alice votes YES with tokens, NO with NFTs (split vote)
      const aliceNftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }], // Tokens
        0,
      );

      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        0, // NO
        [{ configIndex: 1, voteData: aliceNftVoteData }], // NFTs
        0,
      );

      // Bob votes ABSTAIN with NFTs
      const bobNftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[3, 4]]);
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        2, // ABSTAIN
        [{ configIndex: 1, voteData: bobNftVoteData }],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('100')); // Alice's tokens
      expect(votingDetails.noVotes).to.equal(1n); // Alice's 1 NFT
      expect(votingDetails.abstainVotes).to.equal(2n); // Bob's 2 NFTs
    });

    it('Should prevent double voting within same asset type', async () => {
      const { dao, proposalId } = await setupMixedProposal();

      // Alice votes with tokens
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Try to vote again with tokens (should fail)
      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          0, // NO
          [{ configIndex: 0, voteData: '0x' }],
          0,
        ),
      ).to.be.reverted;
    });

    it('Should allow voting with one asset type after voting with another', async () => {
      const { dao, proposalId } = await setupMixedProposal();

      // Alice votes with tokens first
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Then votes with NFTs (should succeed)
      const nftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: nftVoteData }],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('100') + 2n);
    });
  });

  describe('Mixed Quorum and Basis Calculations', () => {
    it('Should meet quorum with combined token and NFT votes', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Mixed quorum test',
          dao.erc20ProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Need 80 voting weight for quorum
      // Alice: 50 tokens + 2 NFTs = 52 weight
      // Bob: 4 NFTs = 4 weight
      // Charlie: 25 tokens = 25 weight
      // Total: 52 + 4 + 25 = 81 weight (> 80 quorum)

      // Transfer some tokens to reduce individual power
      await dao.token.connect(signers.alice).transfer(signers.bob.address, ethers.parseEther('50'));
      await dao.token
        .connect(signers.bob)
        .transfer(signers.charlie.address, ethers.parseEther('25'));

      // Alice votes with both (50 tokens + 2 NFTs = 52 weight)
      const aliceNftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [
          { configIndex: 0, voteData: '0x' },
          { configIndex: 1, voteData: aliceNftVoteData },
        ],
        0,
      );

      // Bob votes with NFTs only (4 weight)
      const bobNftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[3, 4, 5, 6]],
      );
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: bobNftVoteData }],
        0,
      );

      // Charlie votes with tokens only (25 weight)
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Fast forward past voting period
      await fastForwardTime(3601);

      // Should meet quorum and pass
      expect(await dao.strategy.isQuorumMet(proposalId)).to.be.true;
      expect(await dao.strategy.isBasisMet(proposalId)).to.be.true;
      expect(await dao.azorius.proposalState(proposalId)).to.equal(1); // TIMELOCKED
    });

    it('Should fail quorum with insufficient combined votes', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Insufficient quorum test',
          dao.erc20ProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Only Charlie votes with tokens + NFTs (50 tokens + 3 NFTs = 53 weight < 80 quorum)
      const charlieNftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[7, 8, 9]],
      );
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [
          { configIndex: 0, voteData: '0x' },
          { configIndex: 1, voteData: charlieNftVoteData },
        ],
        0,
      );

      // Fast forward past voting period
      await fastForwardTime(3601);

      // Should fail quorum
      expect(await dao.strategy.isQuorumMet(proposalId)).to.be.false;
      expect(await dao.azorius.proposalState(proposalId)).to.equal(5); // FAILED
    });

    it('Should handle basis calculation with mixed asset types', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Mixed basis test',
          dao.erc20ProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Create scenario: YES > 50% of (YES + NO)
      // Alice: 100 tokens YES = 100 weight
      // Bob: 3 NFTs NO = 3 weight
      // Charlie: 50 tokens + 3 NFTs ABSTAIN = 53 weight (doesn't count for basis)
      // Basis: 100 / (100 + 3) = 97% > 50% ✓
      // Quorum: 100 + 53 = 153 > 80 ✓

      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      const bobNftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[3, 4, 5]]);
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        0, // NO
        [{ configIndex: 1, voteData: bobNftVoteData }],
        0,
      );

      const charlieNftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[7, 8, 9]],
      );
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        2, // ABSTAIN
        [
          { configIndex: 0, voteData: '0x' },
          { configIndex: 1, voteData: charlieNftVoteData },
        ],
        0,
      );

      // Fast forward past voting period
      await fastForwardTime(3601);

      // Should pass both quorum and basis
      expect(await dao.strategy.isQuorumMet(proposalId)).to.be.true;
      expect(await dao.strategy.isBasisMet(proposalId)).to.be.true;
      expect(await dao.azorius.proposalState(proposalId)).to.equal(1); // TIMELOCKED
    });
  });

  describe('Edge Cases & Error Conditions', () => {
    it('Should reject votes with invalid config index', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Invalid config test',
          dao.erc20ProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Try to vote with invalid config index (2, should be 0-1)
      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 2, voteData: '0x' }], // Invalid index
          0,
        ),
      ).to.be.reverted;
    });

    it('Should handle users with no assets trying to vote', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Create a user with no tokens or NFTs
      const [, , , , noAssetsUser] = await ethers.getSigners();

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'No assets test',
          dao.erc20ProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // User with no assets cannot vote with ERC20 config
      await expect(
        dao.strategy.connect(noAssetsUser).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 0, voteData: '0x' }],
          0,
        ),
      ).to.be.reverted;

      // User with no assets cannot vote with ERC721 config
      const nftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1]]);
      await expect(
        dao.strategy.connect(noAssetsUser).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 1, voteData: nftVoteData }],
          0,
        ),
      ).to.be.reverted;
    });

    it('Should handle asset transfers affecting voting power mid-proposal', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Transfer test',
          dao.erc20ProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice transfers tokens to Bob AFTER proposal creation
      await dao.token.connect(signers.alice).transfer(signers.bob.address, ethers.parseEther('50'));

      // Alice should still be able to vote with her original balance (snapshot-based)
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Her vote should count as 100 tokens (original balance), not 50
      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('100'));
    });

    it('Should handle NFT transfers affecting voting power mid-proposal', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'NFT transfer test',
          dao.erc20ProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Alice transfers an NFT to Bob AFTER proposal creation
      await dao.nft
        .connect(signers.alice)
        .transferFrom(signers.alice.address, signers.bob.address, 1);

      // Alice can no longer vote with NFT 1 since real-time ownership is checked
      const nftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2]]);
      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 1, voteData: nftVoteData }],
          0,
        ),
      ).to.be.reverted;

      // Alice can still vote with NFT 2 which she still owns
      const validNftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[2]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: validNftVoteData }],
        0,
      );

      // Her vote should count as 1 NFT (only NFT 2)
      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(1n);
    });

    it('Should handle extreme quorum scenarios with mixed assets', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Extreme quorum test',
          dao.erc20ProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Vote with exactly the quorum threshold (80 weight)
      // Alice: 75 tokens + 2 NFTs = 77 weight
      // Bob: 3 NFTs = 3 weight
      // Total: 77 + 3 = 80 weight (exactly meets quorum)

      await dao.token.connect(signers.alice).transfer(signers.bob.address, ethers.parseEther('25'));

      const aliceNftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1, 2]]);
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [
          { configIndex: 0, voteData: '0x' }, // 75 tokens
          { configIndex: 1, voteData: aliceNftVoteData }, // 2 NFTs
        ],
        0,
      );

      const bobNftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[3, 4, 5]]);
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: bobNftVoteData }], // 3 NFTs
        0,
      );

      // Fast forward past voting period
      await fastForwardTime(3601);

      // Should exactly meet quorum and pass
      expect(await dao.strategy.isQuorumMet(proposalId)).to.be.true;
      expect(await dao.strategy.isBasisMet(proposalId)).to.be.true;
      expect(await dao.azorius.proposalState(proposalId)).to.equal(1); // TIMELOCKED
    });
  });

  describe('Complex Multi-Asset Scenarios', () => {
    it('Should handle proposals created via one adapter and voted on with both asset types', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.charlie.address)];

      // Bob creates proposal via ERC721 adapter (using his 4 NFTs)
      const tx = await dao.azorius
        .connect(signers.bob)
        .submitProposal(
          proposalTransactions,
          'NFT-created, multi-asset voting',
          dao.erc721ProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // All users vote with their preferred asset types
      // Alice: tokens only
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Bob: NFTs only
      const bobNftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[3, 4]]);
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: bobNftVoteData }],
        0,
      );

      // Charlie: both assets
      const charlieNftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[7]]);
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [
          { configIndex: 0, voteData: '0x' }, // 50 tokens
          { configIndex: 1, voteData: charlieNftVoteData }, // 1 NFT
        ],
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

      expect(await dao.azorius.proposalState(proposalId)).to.equal(3); // EXECUTED
    });

    it('Should handle large-scale mixed voting with many participants', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Deploy additional signers for stress test
      const additionalSigners = await ethers.getSigners();
      const moreUsers = additionalSigners.slice(4, 8); // Get 4 more users

      // Distribute assets to additional users
      for (let i = 0; i < moreUsers.length; i++) {
        // Give each user some tokens
        await dao.token
          .connect(signers.alice)
          .transfer(moreUsers[i].address, ethers.parseEther('10'));
        await delegateTokens(dao.token, moreUsers[i]);

        // Mint some NFTs for them
        await dao.nft.mintToken(moreUsers[i].address, 20 + i);
      }

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Large scale mixed voting',
          dao.erc20ProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Original users vote with mixed strategies
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }], // remaining tokens after transfers
        0,
      );

      const bobNftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[3, 4, 5, 6]],
      );
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: bobNftVoteData }],
        0,
      );

      // Additional users vote with their assets
      for (let i = 0; i < moreUsers.length; i++) {
        await dao.strategy.connect(moreUsers[i]).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 0, voteData: '0x' }], // Use their tokens
          0,
        );

        const userNftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[20 + i]]);
        await dao.strategy.connect(moreUsers[i]).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 1, voteData: userNftVoteData }], // Use their NFTs
          0,
        );
      }

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);

      // Should have accumulated significant voting weight from multiple asset types
      expect(votingDetails.yesVotes).to.be.greaterThan(ethers.parseEther('80'));

      // Fast forward past voting period
      await fastForwardTime(3601);

      // Should pass with high participation
      expect(await dao.strategy.isQuorumMet(proposalId)).to.be.true;
      expect(await dao.strategy.isBasisMet(proposalId)).to.be.true;
      expect(await dao.azorius.proposalState(proposalId)).to.equal(1); // TIMELOCKED
    });
  });

  describe('Proposal Execution', () => {
    async function setupPassedMixedProposal() {
      const { dao } = await loadFixture(setupTestFixture);

      // Fund the Safe
      await fundSafe(signers.deployer, dao.safeAddress);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      // Create proposal via ERC20 proposer
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Mixed execution test',
          dao.erc20ProposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalId = extractProposalId(receipt!, dao.azorius.interface);

      // Pass with mixed voting: tokens + NFTs reaching quorum and basis
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }], // 100 tokens
        0,
      );

      const bobNftVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[3, 4]]);
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 1, voteData: bobNftVoteData }], // 2 NFTs
        0,
      );

      return { dao, proposalId, proposalTransactions };
    }

    it('Should execute proposal that passed via mixed asset voting', async () => {
      const { dao, proposalId, proposalTransactions } = await setupPassedMixedProposal();

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
