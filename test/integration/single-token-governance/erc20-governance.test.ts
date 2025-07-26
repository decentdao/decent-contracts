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
  extractProposalId,
  fastForwardTime,
  createTestTransaction,
  fundSafe,
  DEFAULT_GOVERNANCE_PARAMS,
  delegateTokens,
} from '../shared/helpers';

// ERC20-specific types

interface DeployedERC20DAO {
  safeAddress: string;
  safe: Safe;
  token: VotesERC20V1;
  azorius: ModuleAzoriusV1;
  strategy: StrategyV1;
  proposerAdapterAddress: string;
}

describe('ERC20 Governance Integration Tests', () => {
  let signers: BaseSigners;

  async function deployERC20DAO(params: {
    infrastructure: TestInfrastructure;
    signers: BaseSigners;
    owners: string[];
    threshold: number;
    tokenName: string;
    tokenSymbol: string;
    tokenAllocations: { to: string; amount: bigint }[];
    proposerThreshold: bigint;
    votingPeriod: number;
    quorumThreshold: bigint;
    basisNumerator: bigint;
    timelockPeriod: number;
    executionPeriod: number;
  }): Promise<DeployedERC20DAO> {
    const { infrastructure } = params;

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
    const proxyCreationEvent = receipt.logs.find(log => {
      try {
        const parsedLog = infrastructure.safeProxyFactory.interface.parseLog({
          topics: log.topics,
          data: log.data,
        });
        return parsedLog?.name === 'ProxyCreation';
      } catch {
        return false;
      }
    });

    if (!proxyCreationEvent) throw new Error('ProxyCreation event not found');

    const parsedEvent = infrastructure.safeProxyFactory.interface.parseLog({
      topics: proxyCreationEvent.topics,
      data: proxyCreationEvent.data,
    });
    const safeAddress = parsedEvent?.args[0];

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
    const safe = Safe__factory.connect(safeAddress, params.signers.deployer);
    const token = VotesERC20V1__factory.connect(tokenAddress, params.signers.deployer);
    const azorius = ModuleAzoriusV1__factory.connect(azoriusAddress, params.signers.deployer);
    const strategy = StrategyV1__factory.connect(strategyAddress, params.signers.deployer);

    return {
      safeAddress,
      safe,
      token,
      azorius,
      strategy,
      proposerAdapterAddress,
    };
  }

  async function setupTestFixture() {
    signers = await getTestSigners();
    const infrastructure = await deployTestInfrastructure(signers.deployer);

    const dao = await deployERC20DAO({
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
      proposerThreshold: ethers.parseEther('10'),
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
    it('Should deploy a basic ERC20 governance DAO', async () => {
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
  });

  describe('Proposal Creation', () => {
    it('Should allow proposers with sufficient tokens to create proposals', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Alice has 100 tokens, threshold is 10, so she can propose
      const proposalTransactions = [
        {
          to: signers.bob.address,
          value: ethers.parseEther('1'),
          data: '0x',
          operation: 0,
        },
      ];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Send 1 ETH to Bob',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt?.logs.find(log => {
        try {
          const parsedLog = dao.azorius.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          return parsedLog?.name === 'ProposalCreated';
        } catch {
          return false;
        }
      });

      expect(proposalCreatedEvent).to.not.be.undefined;

      // Extract proposal ID from event
      const parsedEvent = dao.azorius.interface.parseLog({
        topics: proposalCreatedEvent!.topics,
        data: proposalCreatedEvent!.data,
      });
      const proposalId = parsedEvent?.args[1];

      // Verify proposal state is PENDING (0)
      expect(await dao.azorius.proposalState(proposalId)).to.equal(0);
    });

    it('Should reject proposals from addresses with insufficient tokens', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Charlie has 50 tokens, threshold is 10, but we'll give him 0 tokens for this test
      await dao.token
        .connect(signers.charlie)
        .transfer(signers.alice.address, ethers.parseEther('50'));

      const proposalTransactions = [
        {
          to: signers.bob.address,
          value: ethers.parseEther('1'),
          data: '0x',
          operation: 0,
        },
      ];

      // Charlie now has 0 tokens, should fail to propose
      await expect(
        dao.azorius
          .connect(signers.charlie)
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

      return { dao, proposalId, proposalTransactions };
    }

    it('Should allow token holders to cast YES votes', async () => {
      const { dao, proposalId } = await setupProposal();

      // Alice casts a YES vote
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [
          {
            configIndex: 0,
            voteData: '0x',
          },
        ],
        0, // lightAccountIndex
      );

      // Check voting details
      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('100'));
      expect(votingDetails.noVotes).to.equal(0);
      expect(votingDetails.abstainVotes).to.equal(0);
    });

    it('Should allow token holders to cast NO votes', async () => {
      const { dao, proposalId } = await setupProposal();

      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        0, // NO
        [
          {
            configIndex: 0,
            voteData: '0x',
          },
        ],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(0);
      expect(votingDetails.noVotes).to.equal(ethers.parseEther('100'));
      expect(votingDetails.abstainVotes).to.equal(0);
    });

    it('Should allow token holders to cast ABSTAIN votes', async () => {
      const { dao, proposalId } = await setupProposal();

      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        2, // ABSTAIN
        [
          {
            configIndex: 0,
            voteData: '0x',
          },
        ],
        0,
      );

      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(0);
      expect(votingDetails.noVotes).to.equal(0);
      expect(votingDetails.abstainVotes).to.equal(ethers.parseEther('50'));
    });

    it('Should prevent double voting', async () => {
      const { dao, proposalId } = await setupProposal();

      // First vote should succeed
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [
          {
            configIndex: 0,
            voteData: '0x',
          },
        ],
        0,
      );

      // Second vote should fail
      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          0, // NO
          [
            {
              configIndex: 0,
              voteData: '0x',
            },
          ],
          0,
        ),
      ).to.be.reverted;
    });
  });

  describe('Edge Cases & Error Conditions', () => {
    it('Should fail proposals that do not meet quorum threshold', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Fund the Safe
      await signers.deployer.sendTransaction({
        to: dao.safeAddress,
        value: ethers.parseEther('10'),
      });

      const proposalTransactions = [
        {
          to: signers.bob.address,
          value: ethers.parseEther('1'),
          data: '0x',
          operation: 0,
        },
      ];

      // Alice creates proposal
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Should fail - no quorum',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt?.logs.find(log => {
        try {
          const parsedLog = dao.azorius.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          return parsedLog?.name === 'ProposalCreated';
        } catch {
          return false;
        }
      });

      const parsedEvent = dao.azorius.interface.parseLog({
        topics: proposalCreatedEvent!.topics,
        data: proposalCreatedEvent!.data,
      });
      const proposalId = parsedEvent?.args[1];

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

      // Fund the Safe
      await signers.deployer.sendTransaction({
        to: dao.safeAddress,
        value: ethers.parseEther('10'),
      });

      const proposalTransactions = [
        {
          to: signers.bob.address,
          value: ethers.parseEther('1'),
          data: '0x',
          operation: 0,
        },
      ];

      // Alice creates proposal
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Should fail - insufficient basis',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt?.logs.find(log => {
        try {
          const parsedLog = dao.azorius.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          return parsedLog?.name === 'ProposalCreated';
        } catch {
          return false;
        }
      });

      const parsedEvent = dao.azorius.interface.parseLog({
        topics: proposalCreatedEvent!.topics,
        data: proposalCreatedEvent!.data,
      });
      const proposalId = parsedEvent?.args[1];

      // Alice votes YES (100 tokens)
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Bob votes NO (100 tokens) - creates 50/50 split which fails 50% basis
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        0, // NO
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Charlie abstains (50 tokens) - provides quorum but doesn't affect basis
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

      // Fund the Safe
      await signers.deployer.sendTransaction({
        to: dao.safeAddress,
        value: ethers.parseEther('10'),
      });

      const proposalTransactions = [
        {
          to: signers.bob.address,
          value: ethers.parseEther('1'),
          data: '0x',
          operation: 0,
        },
      ];

      // Alice creates proposal
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(proposalTransactions, 'Should expire', dao.proposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt?.logs.find(log => {
        try {
          const parsedLog = dao.azorius.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          return parsedLog?.name === 'ProposalCreated';
        } catch {
          return false;
        }
      });

      const parsedEvent = dao.azorius.interface.parseLog({
        topics: proposalCreatedEvent!.topics,
        data: proposalCreatedEvent!.data,
      });
      const proposalId = parsedEvent?.args[1];

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

    it('Should prevent voting after voting period ends', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [
        {
          to: signers.bob.address,
          value: ethers.parseEther('1'),
          data: '0x',
          operation: 0,
        },
      ];

      // Alice creates proposal
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Voting period test',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt?.logs.find(log => {
        try {
          const parsedLog = dao.azorius.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          return parsedLog?.name === 'ProposalCreated';
        } catch {
          return false;
        }
      });

      const parsedEvent = dao.azorius.interface.parseLog({
        topics: proposalCreatedEvent!.topics,
        data: proposalCreatedEvent!.data,
      });
      const proposalId = parsedEvent?.args[1];

      // Fast forward past voting period
      await fastForwardTime(3601);

      // Check voting details before attempting to vote
      const votingDetailsBefore = await dao.strategy.proposalVotingDetails(proposalId);

      // Try to vote after period ends - should either revert or emit VotingPeriodEnded
      try {
        const voteResult = await dao.strategy.connect(signers.alice).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 0, voteData: '0x' }],
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
        // Should revert with ProposalNotActive
        expect(error).to.have.property('message');
        expect((error as Error).message).to.include('ProposalNotActive');
      }
    });

    it('Should handle proposals with insufficient Safe balance', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Don't fund the Safe - it has 0 ETH

      const proposalTransactions = [
        {
          to: signers.bob.address,
          value: ethers.parseEther('10'), // More than Safe has
          data: '0x',
          operation: 0,
        },
      ];

      // Alice creates proposal
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Insufficient balance test',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt?.logs.find(log => {
        try {
          const parsedLog = dao.azorius.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          return parsedLog?.name === 'ProposalCreated';
        } catch {
          return false;
        }
      });

      const parsedEvent = dao.azorius.interface.parseLog({
        topics: proposalCreatedEvent!.topics,
        data: proposalCreatedEvent!.data,
      });
      const proposalId = parsedEvent?.args[1];

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

    it('Should reject invalid vote types', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [
        {
          to: signers.bob.address,
          value: ethers.parseEther('1'),
          data: '0x',
          operation: 0,
        },
      ];

      // Alice creates proposal
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Invalid vote type test',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt?.logs.find(log => {
        try {
          const parsedLog = dao.azorius.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          return parsedLog?.name === 'ProposalCreated';
        } catch {
          return false;
        }
      });

      const parsedEvent = dao.azorius.interface.parseLog({
        topics: proposalCreatedEvent!.topics,
        data: proposalCreatedEvent!.data,
      });
      const proposalId = parsedEvent?.args[1];

      // Try to vote with invalid vote type (3, should be 0-2)
      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          3, // INVALID
          [{ configIndex: 0, voteData: '0x' }],
          0,
        ),
      ).to.be.revertedWithCustomError(dao.strategy, 'InvalidVoteType');
    });

    it('Should reject votes with invalid voting config index', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [
        {
          to: signers.bob.address,
          value: ethers.parseEther('1'),
          data: '0x',
          operation: 0,
        },
      ];

      // Alice creates proposal
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Invalid config index test',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt?.logs.find(log => {
        try {
          const parsedLog = dao.azorius.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          return parsedLog?.name === 'ProposalCreated';
        } catch {
          return false;
        }
      });

      const parsedEvent = dao.azorius.interface.parseLog({
        topics: proposalCreatedEvent!.topics,
        data: proposalCreatedEvent!.data,
      });
      const proposalId = parsedEvent?.args[1];

      // Try to vote with invalid config index (1, should be 0 for single-token DAO)
      await expect(
        dao.strategy.connect(signers.alice).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 1, voteData: '0x' }], // Invalid index
          0,
        ),
      ).to.be.revertedWithCustomError(dao.strategy, 'InvalidVotingConfig');
    });
  });

  describe('Complex Scenarios', () => {
    it('Should handle multi-transaction proposals', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Fund the Safe
      await signers.deployer.sendTransaction({
        to: dao.safeAddress,
        value: ethers.parseEther('10'),
      });

      const proposalTransactions = [
        {
          to: signers.bob.address,
          value: ethers.parseEther('1'),
          data: '0x',
          operation: 0,
        },
        {
          to: signers.charlie.address,
          value: ethers.parseEther('2'),
          data: '0x',
          operation: 0,
        },
        {
          to: signers.alice.address,
          value: ethers.parseEther('0.5'),
          data: '0x',
          operation: 0,
        },
      ];

      // Alice creates multi-transaction proposal
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Multi-transaction proposal',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt?.logs.find(log => {
        try {
          const parsedLog = dao.azorius.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          return parsedLog?.name === 'ProposalCreated';
        } catch {
          return false;
        }
      });

      const parsedEvent = dao.azorius.interface.parseLog({
        topics: proposalCreatedEvent!.topics,
        data: proposalCreatedEvent!.data,
      });
      const proposalId = parsedEvent?.args[1];

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

      // Proposal should be executed
      expect(await dao.azorius.proposalState(proposalId)).to.equal(3); // EXECUTED
    });

    it('Should handle proposals with zero value transfers', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [
        {
          to: signers.bob.address,
          value: 0, // Zero value
          data: '0x',
          operation: 0,
        },
      ];

      // Alice creates proposal
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Zero value proposal',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt?.logs.find(log => {
        try {
          const parsedLog = dao.azorius.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          return parsedLog?.name === 'ProposalCreated';
        } catch {
          return false;
        }
      });

      const parsedEvent = dao.azorius.interface.parseLog({
        topics: proposalCreatedEvent!.topics,
        data: proposalCreatedEvent!.data,
      });
      const proposalId = parsedEvent?.args[1];

      // Pass and execute the proposal
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

      // Should execute successfully even with zero value
      await dao.azorius.executeProposal(proposalId, proposalTransactions);
      expect(await dao.azorius.proposalState(proposalId)).to.equal(3); // EXECUTED
    });

    it('Should handle exact quorum threshold votes', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const proposalTransactions = [
        {
          to: signers.bob.address,
          value: ethers.parseEther('1'),
          data: '0x',
          operation: 0,
        },
      ];

      // Alice creates proposal
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Exact quorum test',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt?.logs.find(log => {
        try {
          const parsedLog = dao.azorius.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          return parsedLog?.name === 'ProposalCreated';
        } catch {
          return false;
        }
      });

      const parsedEvent = dao.azorius.interface.parseLog({
        topics: proposalCreatedEvent!.topics,
        data: proposalCreatedEvent!.data,
      });
      const proposalId = parsedEvent?.args[1];

      // Alice votes YES (100 tokens = exactly the quorum threshold)
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
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
      await loadFixture(setupTestFixture);

      // Create a new DAO with exact basis scenario setup
      const infrastructure = await deployTestInfrastructure(signers.deployer);
      const testDao = await deployERC20DAO({
        infrastructure,
        signers,
        owners: [signers.deployer.address],
        threshold: 1,
        tokenName: 'Test Token',
        tokenSymbol: 'TEST',
        tokenAllocations: [
          { to: signers.alice.address, amount: ethers.parseEther('501') }, // 50.1%
          { to: signers.bob.address, amount: ethers.parseEther('499') }, // 49.9%
          { to: signers.charlie.address, amount: ethers.parseEther('100') }, // Extra for quorum
        ],
        proposerThreshold: ethers.parseEther('10'),
        votingPeriod: 3600,
        quorumThreshold: ethers.parseEther('600'), // Need at least 600 tokens
        basisNumerator: 500001n, // 50.0001% (just above 50%)
        timelockPeriod: 1800,
        executionPeriod: 86400,
      });

      // Delegate for all users
      await delegateTokens(testDao.token, signers.alice);
      await delegateTokens(testDao.token, signers.bob);
      await delegateTokens(testDao.token, signers.charlie);

      const proposalTransactions = [createTestTransaction(signers.bob.address)];

      // Alice creates proposal
      const tx = await testDao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Exact basis test',
          testDao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt?.logs.find(log => {
        try {
          const parsedLog = testDao.azorius.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          return parsedLog?.name === 'ProposalCreated';
        } catch {
          return false;
        }
      });

      const parsedEvent = testDao.azorius.interface.parseLog({
        topics: proposalCreatedEvent!.topics,
        data: proposalCreatedEvent!.data,
      });
      const proposalId = parsedEvent?.args[1];

      // Alice votes YES (501 tokens)
      await testDao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Bob votes NO (499 tokens) - creates 501 YES vs 499 NO = 50.1% YES
      await testDao.strategy.connect(signers.bob).castVote(
        proposalId,
        0, // NO
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Charlie abstains (100 tokens) - meets quorum requirement
      await testDao.strategy.connect(signers.charlie).castVote(
        proposalId,
        2, // ABSTAIN
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Fast forward past voting period
      await fastForwardTime(3601);

      // Should pass with just above 50% (50.1% > 50.0001% requirement)
      expect(await testDao.strategy.isQuorumMet(proposalId)).to.be.true;
      expect(await testDao.strategy.isBasisMet(proposalId)).to.be.true;
      expect(await testDao.azorius.proposalState(proposalId)).to.equal(1); // TIMELOCKED
    });
  });

  describe('Token Management', () => {
    it('Should handle users with no voting power', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Create a user with no tokens
      const [, , , , noTokenUser] = await ethers.getSigners();

      const proposalTransactions = [
        {
          to: signers.bob.address,
          value: ethers.parseEther('1'),
          data: '0x',
          operation: 0,
        },
      ];

      // Alice creates proposal
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'No token user test',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt?.logs.find(log => {
        try {
          const parsedLog = dao.azorius.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          return parsedLog?.name === 'ProposalCreated';
        } catch {
          return false;
        }
      });

      const parsedEvent = dao.azorius.interface.parseLog({
        topics: proposalCreatedEvent!.topics,
        data: proposalCreatedEvent!.data,
      });
      const proposalId = parsedEvent?.args[1];

      // User with no tokens cannot vote
      await expect(
        dao.strategy.connect(noTokenUser).castVote(
          proposalId,
          1, // YES
          [{ configIndex: 0, voteData: '0x' }],
          0,
        ),
      ).to.be.revertedWithCustomError(dao.strategy, 'NoVotingWeight');
    });

    it('Should handle token transfers after delegation', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Alice transfers some tokens to Bob after delegation
      await dao.token.connect(signers.alice).transfer(signers.bob.address, ethers.parseEther('50'));

      const proposalTransactions = [
        {
          to: signers.charlie.address,
          value: ethers.parseEther('1'),
          data: '0x',
          operation: 0,
        },
      ];

      // Alice creates proposal
      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalTransactions,
          'Token transfer test',
          dao.proposerAdapterAddress,
          '0x',
        );

      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt?.logs.find(log => {
        try {
          const parsedLog = dao.azorius.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          return parsedLog?.name === 'ProposalCreated';
        } catch {
          return false;
        }
      });

      const parsedEvent = dao.azorius.interface.parseLog({
        topics: proposalCreatedEvent!.topics,
        data: proposalCreatedEvent!.data,
      });
      const proposalId = parsedEvent?.args[1];

      // Alice votes with her remaining voting power (50 tokens at proposal start)
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Bob votes with his voting power (100 + 50 = 150 tokens at proposal start)
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Verify vote counts reflect balances at proposal creation time
      const votingDetails = await dao.strategy.proposalVotingDetails(proposalId);
      expect(votingDetails.yesVotes).to.equal(ethers.parseEther('200')); // 50 + 150
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

      // Cast enough votes to pass (need quorum of 100 tokens and 50% approval)
      // Users already delegated in fixture

      // Alice votes YES (100 tokens)
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Bob votes YES (100 tokens) - total 200 YES votes
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

    it('Should prevent execution during timelock period', async () => {
      const { dao, proposalId, proposalTransactions } = await setupPassedProposal();

      // Fast forward past voting period but not timelock
      await fastForwardTime(3601);

      // Should be TIMELOCKED but not EXECUTABLE
      expect(await dao.azorius.proposalState(proposalId)).to.equal(1); // TIMELOCKED

      // Execution should fail
      await expect(dao.azorius.executeProposal(proposalId, proposalTransactions)).to.be.reverted;
    });

    it('Should prevent execution of failed proposals', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Create a proposal but don't vote on it (will fail due to no votes)
      const proposalTransactions = [
        {
          to: signers.bob.address,
          value: ethers.parseEther('1'),
          data: '0x',
          operation: 0,
        },
      ];

      const tx = await dao.azorius
        .connect(signers.alice)
        .submitProposal(proposalTransactions, 'Should fail', dao.proposerAdapterAddress, '0x');

      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt?.logs.find(log => {
        try {
          const parsedLog = dao.azorius.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          return parsedLog?.name === 'ProposalCreated';
        } catch {
          return false;
        }
      });

      const parsedEvent = dao.azorius.interface.parseLog({
        topics: proposalCreatedEvent!.topics,
        data: proposalCreatedEvent!.data,
      });
      const proposalId = parsedEvent?.args[1];

      // Fast forward past voting and timelock periods
      await fastForwardTime(3601 + 1801);

      // Should be FAILED (no votes cast)
      expect(await dao.azorius.proposalState(proposalId)).to.equal(5); // FAILED

      // Execution should fail
      await expect(dao.azorius.executeProposal(proposalId, proposalTransactions)).to.be.reverted;
    });
  });
});
