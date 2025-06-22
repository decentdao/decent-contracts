import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  IDeploymentBlock__factory,
  IERC165__factory,
  ILightAccountValidator__factory,
  IStrategyV1__factory,
  IVersion__factory,
  MockLightAccount__factory,
  MockLightAccountFactory,
  MockLightAccountFactory__factory,
  MockProposerAdapter,
  MockProposerAdapter__factory,
  MockVotingAdapter,
  MockVotingAdapter__factory,
  StrategyV1,
  StrategyV1__factory,
} from '../../../../typechain-types';
import { runDeploymentBlockTests } from '../../shared/deploymentBlockTests';
import { runSupportsInterfaceTests } from '../../shared/supportsInterfaceTests';

describe('StrategyV1', () => {
  // Signers
  let deployer: SignerWithAddress;
  let strategyAdmin: SignerWithAddress;
  let nonOwner: SignerWithAddress;
  let user1: SignerWithAddress;
  let voter1: SignerWithAddress, voter2: SignerWithAddress, voter3: SignerWithAddress;

  // Contract Instances
  let strategyImplementation: StrategyV1;
  let strategy: StrategyV1;
  let mockAdapter1: MockVotingAdapter;
  let mockAdapter2: MockVotingAdapter;
  let mockProposerAdapter1: MockProposerAdapter;
  let mockProposerAdapter2: MockProposerAdapter;
  let lightAccountFactoryMock: MockLightAccountFactory;
  let lightAccountFactoryMockAddress: string;

  // Default Initialization Parameters for StrategyV1
  const DEFAULT_VOTING_PERIOD = 100; // Example value
  const DEFAULT_QUORUM_THRESHOLD = 1n;
  const DEFAULT_BASIS_NUMERATOR = 500_001n;
  let defaultInitialVotingAdapters: string[];
  let defaultInitialProposerAdapters: string[];

  async function deployStrategyProxy(
    strategyAdminAddress: string,
    votingPeriod: number,
    quorumThreshold: bigint,
    basisNumerator: bigint,
    initialVotingAdaptersAddresses: string[],
    initialProposerAdaptersAddresses: string[],
    lightAccountFactoryAddress: string,
  ): Promise<StrategyV1> {
    const initializeCalldata = strategyImplementation.interface.encodeFunctionData('initialize', [
      votingPeriod,
      quorumThreshold,
      basisNumerator,
      initialProposerAdaptersAddresses,
      lightAccountFactoryAddress,
    ]);
    const proxy = await new ERC1967Proxy__factory(deployer).deploy(
      await strategyImplementation.getAddress(),
      initializeCalldata,
    );
    const strategyInstance = StrategyV1__factory.connect(await proxy.getAddress(), deployer);
    await strategyInstance.initialize2(strategyAdminAddress, initialVotingAdaptersAddresses);
    return strategyInstance;
  }

  beforeEach(async () => {
    [deployer, strategyAdmin, nonOwner, user1, voter2, voter3] = await ethers.getSigners();
    voter1 = user1; // Alias for clarity in some tests

    strategyImplementation = await new StrategyV1__factory(deployer).deploy();
    await strategyImplementation.waitForDeployment();

    lightAccountFactoryMock = await new MockLightAccountFactory__factory(deployer).deploy();
    await lightAccountFactoryMock.waitForDeployment();
    lightAccountFactoryMockAddress = lightAccountFactoryMock.target as string;

    mockAdapter1 = await new MockVotingAdapter__factory(deployer).deploy();
    await mockAdapter1.waitForDeployment();
    mockAdapter2 = await new MockVotingAdapter__factory(deployer).deploy();
    await mockAdapter2.waitForDeployment();

    mockProposerAdapter1 = await new MockProposerAdapter__factory(deployer).deploy();
    await mockProposerAdapter1.waitForDeployment();
    mockProposerAdapter2 = await new MockProposerAdapter__factory(deployer).deploy();
    await mockProposerAdapter2.waitForDeployment();

    defaultInitialVotingAdapters = [await mockAdapter1.getAddress()];
    defaultInitialProposerAdapters = [await mockProposerAdapter1.getAddress()];

    strategy = await deployStrategyProxy(
      strategyAdmin.address,
      DEFAULT_VOTING_PERIOD,
      DEFAULT_QUORUM_THRESHOLD,
      DEFAULT_BASIS_NUMERATOR,
      defaultInitialVotingAdapters,
      defaultInitialProposerAdapters,
      lightAccountFactoryMockAddress,
    );
  });

  describe('Initialization', () => {
    it('should initialize with correct parameters', async () => {
      const strategyAdminAddress = strategyAdmin.address;
      const lightAccountFactoryAddress = lightAccountFactoryMockAddress;
      const initialVotingAdapters: string[] = [
        await mockAdapter1.getAddress(),
        await mockAdapter2.getAddress(),
      ];
      const initialProposerAdapters: string[] = [
        await mockProposerAdapter1.getAddress(),
        await mockProposerAdapter2.getAddress(),
      ];
      const votingPeriod = DEFAULT_VOTING_PERIOD + 10;
      const quorumThreshold = DEFAULT_QUORUM_THRESHOLD + 1n;
      const basisNumerator = DEFAULT_BASIS_NUMERATOR + 1n;

      const testStrategy = await deployStrategyProxy(
        strategyAdminAddress,
        votingPeriod,
        quorumThreshold,
        basisNumerator,
        initialVotingAdapters,
        initialProposerAdapters,
        lightAccountFactoryAddress,
      );

      expect(await testStrategy.strategyAdmin()).to.equal(strategyAdminAddress);
      expect(await testStrategy.votingPeriod()).to.equal(votingPeriod);
      expect(await testStrategy.quorumThreshold()).to.equal(quorumThreshold);
      expect(await testStrategy.basisNumerator()).to.equal(basisNumerator);
      expect(await testStrategy.lightAccountFactory()).to.equal(lightAccountFactoryAddress);
      expect(await testStrategy.votingAdapters()).to.deep.equal(initialVotingAdapters);
      expect(await testStrategy.proposerAdapters()).to.deep.equal(initialProposerAdapters);
    });

    it('should revert if basis numerator is invalid (too high) during initialization', async () => {
      await expect(
        deployStrategyProxy(
          strategyAdmin.address,
          DEFAULT_VOTING_PERIOD,
          DEFAULT_QUORUM_THRESHOLD,
          1_000_001n,
          [await mockAdapter1.getAddress()],
          [await mockProposerAdapter1.getAddress()],
          lightAccountFactoryMockAddress,
        ),
      ).to.be.revertedWithCustomError(strategyImplementation, 'InvalidBasisNumerator');
    });

    it('should revert if basis numerator is invalid (too low, <50%) during initialization', async () => {
      await expect(
        deployStrategyProxy(
          strategyAdmin.address,
          DEFAULT_VOTING_PERIOD,
          DEFAULT_QUORUM_THRESHOLD,
          499_999n,
          [await mockAdapter1.getAddress()],
          [await mockProposerAdapter1.getAddress()],
          lightAccountFactoryMockAddress,
        ),
      ).to.be.revertedWithCustomError(strategyImplementation, 'InvalidBasisNumerator');
    });

    it('should initialize correctly with zero quorum threshold', async () => {
      const testStrategy = await deployStrategyProxy(
        strategyAdmin.address,
        DEFAULT_VOTING_PERIOD,
        0n, // Zero quorum threshold
        DEFAULT_BASIS_NUMERATOR,
        [await mockAdapter1.getAddress()],
        [await mockProposerAdapter1.getAddress()],
        lightAccountFactoryMockAddress,
      );
      expect(await testStrategy.quorumThreshold()).to.equal(0n);
    });

    it('should initialize correctly with basis numerator at 50%', async () => {
      const testStrategy = await deployStrategyProxy(
        strategyAdmin.address,
        DEFAULT_VOTING_PERIOD,
        DEFAULT_QUORUM_THRESHOLD,
        500_000n, // 50% basis numerator
        [await mockAdapter1.getAddress()],
        [await mockProposerAdapter1.getAddress()],
        lightAccountFactoryMockAddress,
      );
      expect(await testStrategy.basisNumerator()).to.equal(500_000n);
    });

    it('should revert when initializing with basis numerator at 100% (1,000,000)', async () => {
      await expect(
        deployStrategyProxy(
          strategyAdmin.address,
          DEFAULT_VOTING_PERIOD,
          DEFAULT_QUORUM_THRESHOLD,
          1_000_000n, // 100% basis numerator - now invalid
          [await mockAdapter1.getAddress()],
          [await mockProposerAdapter1.getAddress()],
          lightAccountFactoryMockAddress,
        ),
      ).to.be.revertedWithCustomError(strategyImplementation, 'InvalidBasisNumerator');
    });

    it('should initialize correctly with basis numerator at new maximum (BASIS_DENOMINATOR - 1)', async () => {
      const maxValidBasis = 1_000_000n - 1n; // BASIS_DENOMINATOR - 1
      const testStrategy = await deployStrategyProxy(
        strategyAdmin.address,
        DEFAULT_VOTING_PERIOD,
        DEFAULT_QUORUM_THRESHOLD,
        maxValidBasis,
        [await mockAdapter1.getAddress()],
        [await mockProposerAdapter1.getAddress()],
        lightAccountFactoryMockAddress,
      );
      expect(await testStrategy.basisNumerator()).to.equal(maxValidBasis);
    });

    it('should revert if initialProposerAdapters is empty', async () => {
      await expect(
        deployStrategyProxy(
          strategyAdmin.address,
          DEFAULT_VOTING_PERIOD,
          DEFAULT_QUORUM_THRESHOLD,
          DEFAULT_BASIS_NUMERATOR,
          defaultInitialVotingAdapters, // Non-empty
          [], // Empty proposer adapters
          lightAccountFactoryMockAddress,
        ),
      ).to.be.revertedWithCustomError(strategyImplementation, 'NoProposerAdapters');
    });

    it('should revert if initialVotingAdapters is empty', async () => {
      await expect(
        deployStrategyProxy(
          strategyAdmin.address,
          DEFAULT_VOTING_PERIOD,
          DEFAULT_QUORUM_THRESHOLD,
          DEFAULT_BASIS_NUMERATOR,
          [], // Empty voting adapters
          defaultInitialProposerAdapters, // Non-empty
          lightAccountFactoryMockAddress,
        ),
      ).to.be.revertedWithCustomError(strategyImplementation, 'NoVotingAdapters');
    });
  });

  describe('votingAdapters', () => {
    it('should return the correct voting adapters', async () => {
      expect(await strategy.votingAdapters()).to.deep.equal(defaultInitialVotingAdapters);
    });
  });

  describe('proposerAdapters', () => {
    it('should return the correct proposer adapters', async () => {
      expect(await strategy.proposerAdapters()).to.deep.equal(defaultInitialProposerAdapters);
    });
  });

  describe('isVotingAdapter', () => {
    it('should return true for a configured voting adapter', async () => {
      const configuredAdapter = defaultInitialVotingAdapters[0];
      expect(await strategy.isVotingAdapter(configuredAdapter)).to.be.true;
    });

    it('should return false for an unconfigured address', async () => {
      expect(await strategy.isVotingAdapter(nonOwner.address)).to.be.false;
    });

    it('should return false for a configured proposer adapter that is not a voting adapter', async () => {
      const proposerOnlyAdapter = await new MockProposerAdapter__factory(deployer).deploy();
      await proposerOnlyAdapter.waitForDeployment();
      const testStrategy = await deployStrategyProxy(
        strategyAdmin.address,
        DEFAULT_VOTING_PERIOD,
        DEFAULT_QUORUM_THRESHOLD,
        DEFAULT_BASIS_NUMERATOR,
        defaultInitialVotingAdapters, // mockAdapter1
        [await proposerOnlyAdapter.getAddress()],
        lightAccountFactoryMockAddress,
      );
      expect(await testStrategy.isVotingAdapter(await proposerOnlyAdapter.getAddress())).to.be
        .false;
    });
  });

  describe('isProposerAdapter', () => {
    it('should return true for a configured proposer adapter', async () => {
      const configuredAdapter = defaultInitialProposerAdapters[0];
      expect(await strategy.isProposerAdapter(configuredAdapter)).to.be.true;
    });

    it('should return false for an unconfigured address', async () => {
      expect(await strategy.isProposerAdapter(nonOwner.address)).to.be.false;
    });

    it('should return false for a configured voting adapter that is not a proposer adapter', async () => {
      const votingOnlyAdapter = await new MockVotingAdapter__factory(deployer).deploy();
      await votingOnlyAdapter.waitForDeployment();
      const testStrategy = await deployStrategyProxy(
        strategyAdmin.address,
        DEFAULT_VOTING_PERIOD,
        DEFAULT_QUORUM_THRESHOLD,
        DEFAULT_BASIS_NUMERATOR,
        [await votingOnlyAdapter.getAddress()],
        defaultInitialProposerAdapters, // mockProposerAdapter1
        lightAccountFactoryMockAddress,
      );
      expect(await testStrategy.isProposerAdapter(await votingOnlyAdapter.getAddress())).to.be
        .false;
    });
  });

  describe('initializeProposal', () => {
    let defaultProposalId: number;

    beforeEach(() => {
      defaultProposalId = 1;
    });

    it('should revert if called by a non-strategy admin address', async () => {
      await expect(
        strategy.connect(nonOwner).initializeProposal(defaultProposalId),
      ).to.be.revertedWithCustomError(strategy, 'InvalidStrategyAdmin');
    });

    it('should correctly initialize proposal details and emit event when called by strategy admin', async () => {
      const blockBefore = await ethers.provider.getBlock('latest');
      if (!blockBefore) throw new Error('Failed to get latest block');
      const timestampBefore = blockBefore.timestamp;
      const blockNumberBefore = blockBefore.number;

      await expect(strategy.connect(strategyAdmin).initializeProposal(defaultProposalId))
        .to.emit(strategy, 'ProposalInitialized')
        .withArgs(
          defaultProposalId,
          timestampBefore + 1,
          timestampBefore + 1 + DEFAULT_VOTING_PERIOD,
          blockNumberBefore + 1,
        );

      const proposalDetails = await strategy.proposalVotingDetails(defaultProposalId);
      expect(proposalDetails.votingStartTimestamp).to.be.closeTo(timestampBefore + 1, 2);
      expect(proposalDetails.votingEndTimestamp).to.be.closeTo(
        timestampBefore + 1 + DEFAULT_VOTING_PERIOD,
        2,
      );
      expect(proposalDetails.votingStartBlock).to.equal(blockNumberBefore + 1);
      expect(proposalDetails.yesVotes).to.equal(0);
      expect(proposalDetails.noVotes).to.equal(0);
      expect(proposalDetails.abstainVotes).to.equal(0);
    });

    it('should reset vote counts for a re-initialized proposal', async () => {
      await strategy.connect(strategyAdmin).initializeProposal(defaultProposalId);

      await strategy.connect(strategyAdmin).initializeProposal(defaultProposalId); // Re-initialize

      const proposalDetails = await strategy.proposalVotingDetails(defaultProposalId);
      expect(proposalDetails.yesVotes).to.equal(0);
      expect(proposalDetails.noVotes).to.equal(0);
      expect(proposalDetails.abstainVotes).to.equal(0);
    });
  });

  describe('isProposer', () => {
    it('should return true if any configured adapter identifies the address as a proposer', async () => {
      const mockProposerAdapter1Address = await mockProposerAdapter1.getAddress();
      const mockProposerAdapter2Address = await mockProposerAdapter2.getAddress();
      const multiProposerStrategy = await deployStrategyProxy(
        strategyAdmin.address,
        DEFAULT_VOTING_PERIOD,
        DEFAULT_QUORUM_THRESHOLD,
        DEFAULT_BASIS_NUMERATOR,
        defaultInitialVotingAdapters,
        [mockProposerAdapter1Address, mockProposerAdapter2Address],
        lightAccountFactoryMockAddress,
      );

      await mockProposerAdapter1.setProposerStatus(user1.address, false);
      await mockProposerAdapter2.setProposerStatus(user1.address, true);

      // Check against adapter 1 (should be false)
      expect(
        await multiProposerStrategy.isProposer(
          user1.address,
          mockProposerAdapter1Address,
          ethers.ZeroHash,
        ),
      ).to.be.false;

      // Check against adapter 2 (should be true)
      expect(
        await multiProposerStrategy.isProposer(
          user1.address,
          mockProposerAdapter2Address,
          ethers.ZeroHash,
        ),
      ).to.be.true;
    });

    it('should return false if no configured adapter identifies the address as a proposer', async () => {
      const mockProposerAdapter1Address = await mockProposerAdapter1.getAddress();
      await mockProposerAdapter1.setProposerStatus(user1.address, false);
      expect(await strategy.isProposer(user1.address, mockProposerAdapter1Address, ethers.ZeroHash))
        .to.be.false;

      const mockProposerAdapter2Address = await mockProposerAdapter2.getAddress();
      const multiProposerStrategy = await deployStrategyProxy(
        strategyAdmin.address,
        DEFAULT_VOTING_PERIOD,
        DEFAULT_QUORUM_THRESHOLD,
        DEFAULT_BASIS_NUMERATOR,
        defaultInitialVotingAdapters,
        [mockProposerAdapter1Address, mockProposerAdapter2Address],
        lightAccountFactoryMockAddress,
      );
      await mockProposerAdapter1.setProposerStatus(user1.address, false);
      await mockProposerAdapter2.setProposerStatus(user1.address, false);
      expect(
        await multiProposerStrategy.isProposer(
          user1.address,
          mockProposerAdapter1Address,
          ethers.ZeroHash,
        ),
      ).to.be.false;
      expect(
        await multiProposerStrategy.isProposer(
          user1.address,
          mockProposerAdapter2Address,
          ethers.ZeroHash,
        ),
      ).to.be.false;
    });

    it('should return true if the first configured adapter identifies the address as a proposer', async () => {
      const mockProposerAdapter1Address = await mockProposerAdapter1.getAddress();
      await mockProposerAdapter1.setProposerStatus(user1.address, true);
      expect(await strategy.isProposer(user1.address, mockProposerAdapter1Address, ethers.ZeroHash))
        .to.be.true;
    });

    it('should revert with InvalidProposerAdapter if the adapter is not configured', async () => {
      const unconfiguredAdapter = await new MockProposerAdapter__factory(deployer).deploy();
      await unconfiguredAdapter.waitForDeployment();
      const unconfiguredAdapterAddress = await unconfiguredAdapter.getAddress();
      await expect(
        strategy.isProposer(user1.address, unconfiguredAdapterAddress, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(strategy, 'InvalidProposerAdapter');
    });
  });

  describe('getVotingTimestamps & getVotingStartBlock', () => {
    let proposalId: number;

    beforeEach(async () => {
      proposalId = 1;
      await strategy.connect(strategyAdmin).initializeProposal(proposalId);
    });

    it('should return correct timestamps and block after proposal initialization', async () => {
      const blockBeforeInit = await strategy.proposalVotingDetails(proposalId);
      const initTimestamp = blockBeforeInit.votingStartTimestamp;

      const [startTime, endTime] = await strategy.getVotingTimestamps(proposalId);
      const startBlock = await strategy.getVotingStartBlock(proposalId);

      expect(startTime).to.equal(initTimestamp);
      expect(endTime).to.equal(initTimestamp + BigInt(DEFAULT_VOTING_PERIOD));
      expect(startBlock).to.equal(blockBeforeInit.votingStartBlock);
    });

    it('getVotingTimestamps should revert if proposal is not initialized', async () => {
      const uninitializedProposalId = 999;
      await expect(
        strategy.getVotingTimestamps(uninitializedProposalId),
      ).to.be.revertedWithCustomError(strategy, 'ProposalNotInitialized');
    });

    it('getVotingStartBlock should revert if proposal is not initialized', async () => {
      const uninitializedProposalId = 999;
      await expect(
        strategy.getVotingStartBlock(uninitializedProposalId),
      ).to.be.revertedWithCustomError(strategy, 'ProposalNotInitialized');
    });
  });

  describe('vote', () => {
    let proposalId: number;
    let adapter1Data: string;
    let adapter2Data: string;

    beforeEach(async () => {
      proposalId = 1;
      await strategy.connect(strategyAdmin).initializeProposal(proposalId);

      adapter1Data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1]]);
      adapter2Data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[2]]);
    });

    it('should revert if proposal is not initialized (votingEndTimestamp is 0)', async () => {
      const uninitializedProposalId = 999;
      await expect(
        strategy.connect(user1).castVote(
          uninitializedProposalId,
          1,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: adapter1Data,
            },
          ],
          0n,
        ),
      ).to.be.revertedWithCustomError(strategy, 'ProposalNotInitialized');
    });

    it('should revert if voting period has ended', async () => {
      const proposalDetails = await strategy.proposalVotingDetails(proposalId);
      await time.increaseTo(proposalDetails.votingEndTimestamp + 1n);

      // First call after period ends should emit event and not revert immediately
      const tx = await strategy.connect(user1).castVote(
        proposalId,
        1,
        [
          {
            votingAdapter: await mockAdapter1.getAddress(),
            adapterVoteData: adapter1Data,
          },
        ],
        0n,
      );

      await expect(tx).to.emit(strategy, 'VotingPeriodEnded').withArgs(proposalId);

      // Subsequent calls should revert
      await expect(
        strategy.connect(user1).castVote(
          proposalId,
          1,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: adapter1Data,
            },
          ],
          0n,
        ),
      ).to.be.revertedWithCustomError(strategy, 'ProposalNotActive');
    });

    it('should emit VotingPeriodEnded and allow no further action if vote called after period end', async () => {
      const proposalDetailsBefore = await strategy.proposalVotingDetails(proposalId);
      await time.increaseTo(proposalDetailsBefore.votingEndTimestamp + 1n);

      // First call after voting period ends
      const tx = await strategy.connect(user1).castVote(
        proposalId,
        1 /* YES */,
        [
          {
            votingAdapter: await mockAdapter1.getAddress(),
            adapterVoteData: adapter1Data,
          },
        ],
        0n,
      );

      await expect(tx).to.emit(strategy, 'VotingPeriodEnded').withArgs(proposalId);

      // Vote counts should not change as the vote is not processed
      const proposalDetailsAfter = await strategy.proposalVotingDetails(proposalId);
      expect(proposalDetailsAfter.yesVotes).to.equal(proposalDetailsBefore.yesVotes);
      expect(proposalDetailsAfter.noVotes).to.equal(proposalDetailsBefore.noVotes);
      expect(proposalDetailsAfter.abstainVotes).to.equal(proposalDetailsBefore.abstainVotes);

      // Further calls should revert
      await expect(
        strategy.connect(user1).castVote(
          proposalId,
          1 /* YES */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: adapter1Data,
            },
          ],
          0n,
        ),
      ).to.be.revertedWithCustomError(strategy, 'ProposalNotActive');
    });

    it('should revert if single adapter has zero vote weight', async () => {
      await mockAdapter1.setWeight(user1.address, 0);
      await expect(
        strategy.connect(user1).castVote(
          proposalId,
          1,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: adapter1Data,
            },
          ],
          0n,
        ),
      )
        .to.be.revertedWithCustomError(strategy, 'NoVotingAdapterVotingWeight')
        .withArgs(await mockAdapter1.getAddress());
    });

    it('should revert if one adapter of many has zero vote weight', async () => {
      strategy = await deployStrategyProxy(
        strategyAdmin.address,
        DEFAULT_VOTING_PERIOD,
        DEFAULT_QUORUM_THRESHOLD,
        DEFAULT_BASIS_NUMERATOR,
        [await mockAdapter1.getAddress(), await mockAdapter2.getAddress()],
        defaultInitialProposerAdapters,
        lightAccountFactoryMockAddress,
      );

      await strategy.connect(strategyAdmin).initializeProposal(proposalId);

      await mockAdapter1.setWeight(user1.address, 50);
      await mockAdapter2.setWeight(user1.address, 0);

      await expect(
        strategy.connect(user1).castVote(
          proposalId,
          1,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: adapter1Data,
            },
            {
              votingAdapter: await mockAdapter2.getAddress(),
              adapterVoteData: adapter2Data,
            },
          ],
          0n,
        ),
      )
        .to.be.revertedWithCustomError(strategy, 'NoVotingAdapterVotingWeight')
        .withArgs(await mockAdapter2.getAddress());
    });

    it('should revert on invalid voteType', async () => {
      const invalidVoteType = 3; // VoteType enum is 0, 1, 2
      await mockAdapter1.setWeight(user1.address, 10);
      await expect(
        strategy.connect(user1).castVote(
          proposalId,
          invalidVoteType,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: adapter1Data,
            },
          ],
          0n,
        ),
      ).to.be.revertedWithCustomError(strategy, 'InvalidVoteType');
    });

    it('should revert with InvalidVotingAdapter if an adapter in _adaptersToUse is not configured in the strategy', async () => {
      const unconfiguredAdapter = await new MockVotingAdapter__factory(deployer).deploy();
      await unconfiguredAdapter.waitForDeployment();
      const unconfiguredAdapterAddress = await unconfiguredAdapter.getAddress();

      await mockAdapter1.setWeight(user1.address, 10);

      const adapterData = [
        {
          votingAdapter: await mockAdapter1.getAddress(),
          adapterVoteData: adapter1Data,
        },
        {
          votingAdapter: unconfiguredAdapterAddress,
          adapterVoteData: adapter1Data,
        },
      ];

      await expect(strategy.connect(user1).castVote(proposalId, 1 /* YES */, adapterData, 0n))
        .to.be.revertedWithCustomError(strategy, 'InvalidVotingAdapter')
        .withArgs(unconfiguredAdapterAddress);
    });

    it('should correctly record a YES vote, update counts, and emit Voted event', async () => {
      const voteWeight = 100;
      await mockAdapter1.setWeight(user1.address, voteWeight);

      const tx = await strategy.connect(user1).castVote(
        proposalId,
        1 /* YES */,
        [
          {
            votingAdapter: await mockAdapter1.getAddress(),
            adapterVoteData: adapter1Data,
          },
        ],
        0n,
      );

      await expect(tx)
        .to.emit(strategy, 'Voted')
        .withArgs(user1.address, proposalId, 1 /* YES */, voteWeight);

      const proposalDetails = await strategy.proposalVotingDetails(proposalId);
      expect(proposalDetails.yesVotes).to.equal(voteWeight);
      expect(proposalDetails.noVotes).to.equal(0);
      expect(proposalDetails.abstainVotes).to.equal(0);

      expect(await mockAdapter1.lastVoterForRecordVote()).to.equal(user1.address);
      expect(await mockAdapter1.lastProposalIdForRecordVote()).to.equal(proposalId);
      expect(
        await mockAdapter1.recordedVotesWeight(
          user1.address,
          proposalId,
          ethers.keccak256(adapter1Data),
        ),
      ).to.equal(voteWeight);
    });

    it('should correctly record a NO vote', async () => {
      const voteWeight = 50;
      await mockAdapter1.setWeight(user1.address, voteWeight);

      await expect(
        strategy.connect(user1).castVote(
          proposalId,
          0 /* NO */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: adapter1Data,
            },
          ],
          0n,
        ),
      )
        .to.emit(strategy, 'Voted')
        .withArgs(user1.address, proposalId, 0 /* NO */, voteWeight);

      const proposalDetails = await strategy.proposalVotingDetails(proposalId);
      expect(proposalDetails.noVotes).to.equal(voteWeight);
      expect(proposalDetails.yesVotes).to.equal(0);
      expect(proposalDetails.abstainVotes).to.equal(0);
    });

    it('should correctly record an ABSTAIN vote', async () => {
      const voteWeight = 25;
      await mockAdapter1.setWeight(user1.address, voteWeight);

      await expect(
        strategy.connect(user1).castVote(
          proposalId,
          2 /* ABSTAIN */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: adapter1Data,
            },
          ],
          0n,
        ),
      )
        .to.emit(strategy, 'Voted')
        .withArgs(user1.address, proposalId, 2 /* ABSTAIN */, voteWeight);

      const proposalDetails = await strategy.proposalVotingDetails(proposalId);
      expect(proposalDetails.abstainVotes).to.equal(voteWeight);
      expect(proposalDetails.yesVotes).to.equal(0);
      expect(proposalDetails.noVotes).to.equal(0);
    });

    it('should sum weights if multiple adapters are used in one vote call', async () => {
      const multiAdapterStrategy = await deployStrategyProxy(
        strategyAdmin.address,
        DEFAULT_VOTING_PERIOD,
        DEFAULT_QUORUM_THRESHOLD,
        DEFAULT_BASIS_NUMERATOR,
        [await mockAdapter1.getAddress(), await mockAdapter2.getAddress()], // Both adapters
        defaultInitialProposerAdapters,
        lightAccountFactoryMockAddress,
      );
      await multiAdapterStrategy.connect(strategyAdmin).initializeProposal(proposalId);

      const weight1 = 60;
      const weight2 = 40;
      await mockAdapter1.setWeight(user1.address, weight1);
      await mockAdapter2.setWeight(user1.address, weight2);

      const adapterData = [
        {
          votingAdapter: await mockAdapter1.getAddress(),
          adapterVoteData: adapter1Data,
        },
        {
          votingAdapter: await mockAdapter2.getAddress(),
          adapterVoteData: adapter2Data,
        },
      ];

      await expect(
        multiAdapterStrategy.connect(user1).castVote(proposalId, 1 /* YES */, adapterData, 0n),
      )
        .to.emit(multiAdapterStrategy, 'Voted')
        .withArgs(user1.address, proposalId, 1 /* YES */, weight1 + weight2);

      const proposalDetails = await multiAdapterStrategy.proposalVotingDetails(proposalId);
      expect(proposalDetails.yesVotes).to.equal(weight1 + weight2);
    });

    it('should support ERC4337 by using the resolved voter address', async () => {
      const smartAccountOwner = user1;
      const relayer = nonOwner;

      const mockLightAccountDeployedFactory = new MockLightAccount__factory(deployer);
      const mockSmartAccount = await mockLightAccountDeployedFactory.deploy(
        smartAccountOwner.address,
      );
      await mockSmartAccount.waitForDeployment();
      const mockSmartAccountAddress = await mockSmartAccount.getAddress();

      await lightAccountFactoryMock.setAccountAddress(
        smartAccountOwner.address,
        0,
        mockSmartAccountAddress,
      );

      const voteWeight = 77;
      await mockAdapter1.setWeight(smartAccountOwner.address, voteWeight);

      const tx = await mockSmartAccount.connect(relayer).callStrategyVote(
        await strategy.getAddress(),
        proposalId,
        1 /* YES */,
        [
          {
            votingAdapter: await mockAdapter1.getAddress(),
            adapterVoteData: adapter1Data,
          },
        ],
        0n,
      );

      await expect(tx)
        .to.emit(strategy, 'Voted')
        .withArgs(smartAccountOwner.address, proposalId, 1 /* YES */, voteWeight);

      const proposalDetails = await strategy.proposalVotingDetails(proposalId);
      expect(proposalDetails.yesVotes).to.equal(voteWeight);

      expect(await mockAdapter1.lastVoterForRecordVote()).to.equal(smartAccountOwner.address);
    });

    it('should revert if an adapter call to recordVote reverts', async () => {
      await mockAdapter1.setWeight(user1.address, 10);
      await mockAdapter1.setShouldRevertOnRecordVote(true);

      await expect(
        strategy.connect(user1).castVote(
          proposalId,
          1 /* YES */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: adapter1Data,
            },
          ],
          0n,
        ),
      ).to.be.revertedWith('MockVotingAdapter: recordVote forced revert');
    });

    it('should revert if any adapter call reverts in a multi-adapter vote (all-or-nothing)', async () => {
      const multiAdapterStrategy = await deployStrategyProxy(
        strategyAdmin.address,
        DEFAULT_VOTING_PERIOD,
        DEFAULT_QUORUM_THRESHOLD,
        DEFAULT_BASIS_NUMERATOR,
        [await mockAdapter1.getAddress(), await mockAdapter2.getAddress()], // Both adapters
        defaultInitialProposerAdapters,
        lightAccountFactoryMockAddress,
      );
      await multiAdapterStrategy.connect(strategyAdmin).initializeProposal(proposalId);

      await mockAdapter1.setWeight(user1.address, 10);
      await mockAdapter2.setWeight(user1.address, 20);

      await mockAdapter1.setShouldRevertOnRecordVote(false);
      await mockAdapter2.setShouldRevertOnRecordVote(true); // Adapter 2 will revert

      const adapter1DataForVoter1 = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[777]],
      );

      const adapterData = [
        {
          votingAdapter: await mockAdapter1.getAddress(),
          adapterVoteData: adapter1DataForVoter1,
        },
        {
          votingAdapter: await mockAdapter2.getAddress(),
          adapterVoteData: ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[888]]),
        },
      ];

      await expect(
        multiAdapterStrategy.connect(user1).castVote(proposalId, 1 /* YES */, adapterData, 0n),
      ).to.be.revertedWith('MockVotingAdapter: recordVote forced revert');

      const proposalDetails = await multiAdapterStrategy.proposalVotingDetails(proposalId);
      expect(proposalDetails.yesVotes).to.equal(0);
      expect(proposalDetails.noVotes).to.equal(0);
      expect(proposalDetails.abstainVotes).to.equal(0);

      const dataHashAdapter1 = ethers.keccak256(adapter1DataForVoter1);
      expect(await mockAdapter1.hasRecordedVote(user1.address, proposalId, dataHashAdapter1)).to.be
        .false;
    });

    it('should revert if attempting to vote with no voting adapters', async () => {
      await expect(
        strategy.connect(user1).castVote(proposalId, 1 /* YES */, [], 0n),
      ).to.be.revertedWithCustomError(strategy, 'NoVotingAdapters');
    });
  });

  describe('isPassed', () => {
    const PROPOSAL_ID = 1;
    beforeEach(async () => {
      await strategy.connect(strategyAdmin).initializeProposal(PROPOSAL_ID);
    });

    it('should revert with ProposalNotInitialized if proposal was not initialized', async () => {
      const uninitializedProposalId = 999;
      await expect(strategy.isPassed(uninitializedProposalId)).to.be.revertedWithCustomError(
        strategy,
        'ProposalNotInitialized',
      );
    });

    it('should return false if voting period is not over', async () => {
      await mockAdapter1.setWeight(voter1.address, DEFAULT_QUORUM_THRESHOLD + 10n);
      await strategy.connect(voter1).castVote(
        PROPOSAL_ID,
        1 /* YES */,
        [
          {
            votingAdapter: await mockAdapter1.getAddress(),
            adapterVoteData: ethers.ZeroHash,
          },
        ],
        0n,
      );
      expect(await strategy.isPassed(PROPOSAL_ID)).to.be.false; // Voting not over
    });

    it('should return true if quorum and basis are met and voting is over', async () => {
      await mockAdapter1.setWeight(voter1.address, DEFAULT_QUORUM_THRESHOLD + 10n);
      await strategy.connect(voter1).castVote(
        PROPOSAL_ID,
        1 /* YES */,
        [
          {
            votingAdapter: await mockAdapter1.getAddress(),
            adapterVoteData: ethers.ZeroHash,
          },
        ],
        0n,
      );

      const proposalDetails = await strategy.proposalVotingDetails(PROPOSAL_ID);
      await time.increaseTo(proposalDetails.votingEndTimestamp + 1n);

      expect(await strategy.isPassed(PROPOSAL_ID)).to.be.true;
    });

    it('should return false if quorum is met but basis is not, after voting period', async () => {
      const specificStrategy = await deployStrategyProxy(
        strategyAdmin.address,
        DEFAULT_VOTING_PERIOD,
        50n, // quorumThreshold
        500_001n, // basisNumerator (yes > no)
        defaultInitialVotingAdapters,
        defaultInitialProposerAdapters,
        lightAccountFactoryMockAddress,
      );
      await specificStrategy.connect(strategyAdmin).initializeProposal(PROPOSAL_ID);

      await mockAdapter1.setWeight(voter1.address, 50n);
      await mockAdapter1.setWeight(voter2.address, 50n);
      await mockAdapter1.setWeight(voter3.address, 10n);

      await specificStrategy.connect(voter1).castVote(
        PROPOSAL_ID,
        1 /* YES */,
        [
          {
            votingAdapter: await mockAdapter1.getAddress(),
            adapterVoteData: ethers.ZeroHash,
          },
        ],
        0n,
      );
      await specificStrategy.connect(voter2).castVote(
        PROPOSAL_ID,
        0 /* NO */,
        [
          {
            votingAdapter: await mockAdapter1.getAddress(),
            adapterVoteData: ethers.ZeroHash,
          },
        ],
        0n,
      );
      await specificStrategy.connect(voter3).castVote(
        PROPOSAL_ID,
        2 /* ABSTAIN */,
        [
          {
            votingAdapter: await mockAdapter1.getAddress(),
            adapterVoteData: ethers.ZeroHash,
          },
        ],
        0n,
      );

      const proposalDetails = await specificStrategy.proposalVotingDetails(PROPOSAL_ID);
      await time.increaseTo(proposalDetails.votingEndTimestamp + 1n);

      expect(await specificStrategy.isPassed(PROPOSAL_ID)).to.be.false;
    });

    it('should return false if basis is met but quorum is not, after voting period', async () => {
      const specificStrategy = await deployStrategyProxy(
        strategyAdmin.address,
        DEFAULT_VOTING_PERIOD,
        100n, // quorumThreshold
        500_001n, // basisNumerator (yes > no)
        defaultInitialVotingAdapters,
        defaultInitialProposerAdapters,
        lightAccountFactoryMockAddress,
      );
      await specificStrategy.connect(strategyAdmin).initializeProposal(PROPOSAL_ID);

      await mockAdapter1.setWeight(voter1.address, 60n); // YES
      await mockAdapter1.setWeight(voter2.address, 10n); // NO

      await specificStrategy.connect(voter1).castVote(
        PROPOSAL_ID,
        1 /* YES */,
        [
          {
            votingAdapter: await mockAdapter1.getAddress(),
            adapterVoteData: ethers.ZeroHash,
          },
        ],
        0n,
      );
      await specificStrategy.connect(voter2).castVote(
        PROPOSAL_ID,
        0 /* NO */,
        [
          {
            votingAdapter: await mockAdapter1.getAddress(),
            adapterVoteData: ethers.ZeroHash,
          },
        ],
        0n,
      );

      const proposalDetails = await specificStrategy.proposalVotingDetails(PROPOSAL_ID);
      await time.increaseTo(proposalDetails.votingEndTimestamp + 1n);

      expect(await specificStrategy.isPassed(PROPOSAL_ID)).to.be.false;
    });
  });

  describe('voting period ended', () => {
    const PROPOSAL_ID = 1;
    const PROPOSAL_ID_2 = 2;

    beforeEach(async () => {
      await mockAdapter1.setWeight(voter1.address, 50n);
      await strategy.connect(strategyAdmin).initializeProposal(PROPOSAL_ID);
      await time.increase(1n);
      await strategy.connect(strategyAdmin).initializeProposal(PROPOSAL_ID_2);
    });

    it('should initially return false for any proposal', async () => {
      const result = await strategy.voteCastedAfterVotingPeriodEnded(PROPOSAL_ID);
      expect(result).to.be.false;
    });

    it('should still return false if voting period is over but no vote has been cast', async () => {
      await time.increaseTo(
        (await strategy.proposalVotingDetails(PROPOSAL_ID)).votingEndTimestamp + 1n,
      );
      const result = await strategy.voteCastedAfterVotingPeriodEnded(PROPOSAL_ID);
      expect(result).to.be.false;
    });

    it('should get set to true after casting a vote after voting period ends', async () => {
      // Initially false
      let result = await strategy.voteCastedAfterVotingPeriodEnded(PROPOSAL_ID);
      expect(result).to.be.false;

      await time.increaseTo(
        (await strategy.proposalVotingDetails(PROPOSAL_ID)).votingEndTimestamp + 1n,
      );
      await strategy.connect(voter1).castVote(
        PROPOSAL_ID,
        1 /* YES */,
        [
          {
            votingAdapter: await mockAdapter1.getAddress(),
            adapterVoteData: ethers.ZeroHash,
          },
        ],
        0n,
      );

      result = await strategy.voteCastedAfterVotingPeriodEnded(PROPOSAL_ID);
      expect(result).to.be.true;
    });

    it('should maintain separate states for different proposal IDs', async () => {
      await time.increaseTo(
        (await strategy.proposalVotingDetails(PROPOSAL_ID)).votingEndTimestamp + 1n,
      );
      await strategy.connect(voter1).castVote(
        PROPOSAL_ID,
        1 /* YES */,
        [
          {
            votingAdapter: await mockAdapter1.getAddress(),
            adapterVoteData: ethers.ZeroHash,
          },
        ],
        0n,
      );
      expect(await strategy.voteCastedAfterVotingPeriodEnded(PROPOSAL_ID)).to.be.true;

      await time.increaseTo(
        (await strategy.proposalVotingDetails(PROPOSAL_ID_2)).votingEndTimestamp + 1n,
      );
      expect(await strategy.voteCastedAfterVotingPeriodEnded(PROPOSAL_ID_2)).to.be.false;
    });

    it('should not emit VotingPeriodEnded event when casting a vote before voting period ends', async () => {
      await expect(
        strategy.connect(voter1).castVote(
          PROPOSAL_ID,
          1 /* YES */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        ),
      ).not.to.emit(strategy, 'VotingPeriodEnded');
    });

    it('should emit VotingPeriodEnded event when casting a vote after voting period ends', async () => {
      await time.increaseTo(
        (await strategy.proposalVotingDetails(PROPOSAL_ID)).votingEndTimestamp + 1n,
      );
      await expect(
        strategy.connect(voter1).castVote(
          PROPOSAL_ID,
          1 /* YES */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        ),
      )
        .to.emit(strategy, 'VotingPeriodEnded')
        .withArgs(PROPOSAL_ID);
    });
  });

  describe('ERC165 supportsInterface', () => {
    runSupportsInterfaceTests({
      getContract: () => strategy,
      supportedInterfaceFactories: [
        IStrategyV1__factory,
        ILightAccountValidator__factory,
        IERC165__factory,
        IVersion__factory,
        IDeploymentBlock__factory,
      ],
    });
  });

  describe('Version', () => {
    it('should return the correct version', async () => {
      expect(await strategy.version()).to.equal(1);
    });
  });

  describe('Quorum and Basis Checks', () => {
    const PROPOSAL_ID = 1;

    beforeEach(async () => {
      await strategy.connect(strategyAdmin).initializeProposal(PROPOSAL_ID);
    });

    describe('isQuorumMet', () => {
      it('should revert if proposal not initialized', async () => {
        await expect(strategy.isQuorumMet(999)).to.be.revertedWithCustomError(
          strategy,
          'ProposalNotInitialized',
        );
      });

      it('should return true if quorum is met exactly (yes + abstain == threshold)', async () => {
        const testQuorum = 100n;
        const qStrategy = await deployStrategyProxy(
          strategyAdmin.address,
          DEFAULT_VOTING_PERIOD,
          testQuorum,
          DEFAULT_BASIS_NUMERATOR,
          defaultInitialVotingAdapters,
          defaultInitialProposerAdapters,
          lightAccountFactoryMockAddress,
        );
        await qStrategy.connect(strategyAdmin).initializeProposal(PROPOSAL_ID);

        await mockAdapter1.setWeight(voter1.address, 60n);
        await mockAdapter1.setWeight(voter2.address, 40n);
        await qStrategy.connect(voter1).castVote(
          PROPOSAL_ID,
          1 /* YES */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        await qStrategy.connect(voter2).castVote(
          PROPOSAL_ID,
          2 /* ABSTAIN */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        expect(await qStrategy.isQuorumMet(PROPOSAL_ID)).to.be.true;
      });

      it('should return true if quorum is exceeded (yes + abstain > threshold)', async () => {
        const testQuorum = 100n;
        const qStrategy = await deployStrategyProxy(
          strategyAdmin.address,
          DEFAULT_VOTING_PERIOD,
          testQuorum,
          DEFAULT_BASIS_NUMERATOR,
          defaultInitialVotingAdapters,
          defaultInitialProposerAdapters,
          lightAccountFactoryMockAddress,
        );
        await qStrategy.connect(strategyAdmin).initializeProposal(PROPOSAL_ID);

        await mockAdapter1.setWeight(voter1.address, 60n);
        await mockAdapter1.setWeight(voter2.address, 41n); // Exceeds
        await qStrategy.connect(voter1).castVote(
          PROPOSAL_ID,
          1 /* YES */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        await qStrategy.connect(voter2).castVote(
          PROPOSAL_ID,
          2 /* ABSTAIN */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        expect(await qStrategy.isQuorumMet(PROPOSAL_ID)).to.be.true;
      });

      it('should return false if quorum is not met (yes + abstain < threshold)', async () => {
        const testQuorum = 100n;
        const qStrategy = await deployStrategyProxy(
          strategyAdmin.address,
          DEFAULT_VOTING_PERIOD,
          testQuorum,
          DEFAULT_BASIS_NUMERATOR,
          defaultInitialVotingAdapters,
          defaultInitialProposerAdapters,
          lightAccountFactoryMockAddress,
        );
        await qStrategy.connect(strategyAdmin).initializeProposal(PROPOSAL_ID);

        await mockAdapter1.setWeight(voter1.address, 50n);
        await mockAdapter1.setWeight(voter2.address, 40n); // 90 total, < 100
        await qStrategy.connect(voter1).castVote(
          PROPOSAL_ID,
          1 /* YES */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        await qStrategy.connect(voter2).castVote(
          PROPOSAL_ID,
          2 /* ABSTAIN */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );

        expect(await qStrategy.isQuorumMet(PROPOSAL_ID)).to.be.false;
      });

      it('should return true if quorum threshold is 0, even with no votes contributing to quorum count', async () => {
        const qStrategy = await deployStrategyProxy(
          strategyAdmin.address,
          DEFAULT_VOTING_PERIOD,
          0n /* quorum */,
          DEFAULT_BASIS_NUMERATOR,
          defaultInitialVotingAdapters,
          defaultInitialProposerAdapters,
          lightAccountFactoryMockAddress,
        );
        await qStrategy.connect(strategyAdmin).initializeProposal(PROPOSAL_ID);

        await mockAdapter1.setWeight(voter1.address, 10n); // Only NO votes
        await qStrategy.connect(voter1).castVote(
          PROPOSAL_ID,
          0 /* NO */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );

        expect(await qStrategy.isQuorumMet(PROPOSAL_ID)).to.be.true;
      });

      it('should return false if only NO votes are cast and quorum threshold > 0', async () => {
        await mockAdapter1.setWeight(voter1.address, 150n);
        await strategy.connect(voter1).castVote(
          PROPOSAL_ID,
          0 /* NO */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        expect(await strategy.isQuorumMet(PROPOSAL_ID)).to.be.false;
      });
    });

    describe('isBasisMet', () => {
      it('should revert if proposal not initialized', async () => {
        await expect(strategy.isBasisMet(999)).to.be.revertedWithCustomError(
          strategy,
          'ProposalNotInitialized',
        );
      });

      it('should return true if basis is met (yes > no for >50% basis)', async () => {
        await mockAdapter1.setWeight(voter1.address, 101n);
        await mockAdapter1.setWeight(voter2.address, 100n);
        await strategy.connect(voter1).castVote(
          PROPOSAL_ID,
          1 /* YES */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        await strategy.connect(voter2).castVote(
          PROPOSAL_ID,
          0 /* NO */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        expect(await strategy.isBasisMet(PROPOSAL_ID)).to.be.true;
      });

      it('should return false if basis is not met (yes == no for >50% basis)', async () => {
        await mockAdapter1.setWeight(voter1.address, 100n);
        await mockAdapter1.setWeight(voter2.address, 100n);
        await strategy.connect(voter1).castVote(
          PROPOSAL_ID,
          1 /* YES */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        await strategy.connect(voter2).castVote(
          PROPOSAL_ID,
          0 /* NO */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        expect(await strategy.isBasisMet(PROPOSAL_ID)).to.be.false;
      });

      it('should return false if basis is not met (yes < no for >50% basis)', async () => {
        await mockAdapter1.setWeight(voter1.address, 99n);
        await mockAdapter1.setWeight(voter2.address, 100n);
        await strategy.connect(voter1).castVote(
          PROPOSAL_ID,
          1 /* YES */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        await strategy.connect(voter2).castVote(
          PROPOSAL_ID,
          0 /* NO */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        expect(await strategy.isBasisMet(PROPOSAL_ID)).to.be.false;
      });

      it('should return false if totalYesAndNoVotes is 0 (only abstain)', async () => {
        await mockAdapter1.setWeight(voter1.address, 100n);
        await strategy.connect(voter1).castVote(
          PROPOSAL_ID,
          2 /* ABSTAIN */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );

        expect(await strategy.isBasisMet(PROPOSAL_ID)).to.be.false;
      });

      it('should return true if basisNumerator is 500,000 (50%) and yes > no', async () => {
        const bStrategy = await deployStrategyProxy(
          strategyAdmin.address,
          DEFAULT_VOTING_PERIOD,
          DEFAULT_QUORUM_THRESHOLD,
          500_000n /* basis */,
          defaultInitialVotingAdapters,
          defaultInitialProposerAdapters,
          lightAccountFactoryMockAddress,
        );
        await bStrategy.connect(strategyAdmin).initializeProposal(PROPOSAL_ID);

        await mockAdapter1.setWeight(voter1.address, 101n);
        await mockAdapter1.setWeight(voter2.address, 100n);
        await bStrategy.connect(voter1).castVote(
          PROPOSAL_ID,
          1 /* YES */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        await bStrategy.connect(voter2).castVote(
          PROPOSAL_ID,
          0 /* NO */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        expect(await bStrategy.isBasisMet(PROPOSAL_ID)).to.be.true;
      });

      it('should return false if basisNumerator is 500,000 (50%) and yes == no', async () => {
        const bStrategy = await deployStrategyProxy(
          strategyAdmin.address,
          DEFAULT_VOTING_PERIOD,
          DEFAULT_QUORUM_THRESHOLD,
          500_000n /* basis */,
          defaultInitialVotingAdapters,
          defaultInitialProposerAdapters,
          lightAccountFactoryMockAddress,
        );
        await bStrategy.connect(strategyAdmin).initializeProposal(PROPOSAL_ID);

        await mockAdapter1.setWeight(voter1.address, 100n);
        await mockAdapter1.setWeight(voter2.address, 100n);
        await bStrategy.connect(voter1).castVote(
          PROPOSAL_ID,
          1 /* YES */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        await bStrategy.connect(voter2).castVote(
          PROPOSAL_ID,
          0 /* NO */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        expect(await bStrategy.isBasisMet(PROPOSAL_ID)).to.be.false;
      });

      it('should return true if basisNumerator is max valid (DENOMINATOR - 1) and yes > 0, no == 0', async () => {
        const maxValidBasis = 1_000_000n - 1n;
        const bStrategy = await deployStrategyProxy(
          strategyAdmin.address,
          DEFAULT_VOTING_PERIOD,
          DEFAULT_QUORUM_THRESHOLD,
          maxValidBasis,
          defaultInitialVotingAdapters,
          defaultInitialProposerAdapters,
          lightAccountFactoryMockAddress,
        );
        await bStrategy.connect(strategyAdmin).initializeProposal(PROPOSAL_ID);

        await mockAdapter1.setWeight(voter1.address, 100n);
        await bStrategy.connect(voter1).castVote(
          PROPOSAL_ID,
          1 /* YES */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        expect(await bStrategy.isBasisMet(PROPOSAL_ID)).to.be.true;
      });

      it('should return false if basisNumerator is max valid (DENOMINATOR - 1) and yes > 0, no > 0', async () => {
        const maxValidBasis = 1_000_000n - 1n;
        const bStrategy = await deployStrategyProxy(
          strategyAdmin.address,
          DEFAULT_VOTING_PERIOD,
          DEFAULT_QUORUM_THRESHOLD,
          maxValidBasis,
          defaultInitialVotingAdapters,
          defaultInitialProposerAdapters,
          lightAccountFactoryMockAddress,
        );
        await bStrategy.connect(strategyAdmin).initializeProposal(PROPOSAL_ID);

        await mockAdapter1.setWeight(voter1.address, 100n);
        await mockAdapter1.setWeight(voter2.address, 1n);
        await bStrategy.connect(voter1).castVote(
          PROPOSAL_ID,
          1 /* YES */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );
        await bStrategy.connect(voter2).castVote(
          PROPOSAL_ID,
          0 /* NO */,
          [
            {
              votingAdapter: await mockAdapter1.getAddress(),
              adapterVoteData: ethers.ZeroHash,
            },
          ],
          0n,
        );

        expect(await bStrategy.isBasisMet(PROPOSAL_ID)).to.be.false;
      });
    });
  });

  describe('Freeze Voter Authorization Management', () => {
    let freezeVoter1: SignerWithAddress;
    let freezeVoter2: SignerWithAddress;

    beforeEach(async () => {
      // Additional signers for freeze voter contracts if needed, or use existing ones
      // user1, voter2, voter3 are available from the outer scope
      freezeVoter1 = user1; // Re-using user1 as a potential freeze voter contract address
      freezeVoter2 = voter2; // Re-using voter2 as another
      // Ensure strategy is freshly deployed for these tests if state from other tests could interfere
      // The main beforeEach already deploys a fresh `strategy` instance.
    });

    describe('addAuthorizedFreezeVoter', () => {
      it('should allow strategyAdmin to add a new freeze voter', async () => {
        await expect(strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter1.address))
          .to.emit(strategy, 'FreezeVoterAuthorizationChanged')
          .withArgs(freezeVoter1.address, true);
        expect(await strategy.isAuthorizedFreezeVoter(freezeVoter1.address)).to.be.true;
        expect(await strategy.authorizedFreezeVoters()).to.include(freezeVoter1.address);
        expect(await strategy.authorizedFreezeVoters()).to.have.lengthOf(1);
      });

      it('should not duplicate an address in the array if added again, but emit event', async () => {
        await strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter1.address); // First add
        await expect(strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter1.address)) // Second add
          .to.emit(strategy, 'FreezeVoterAuthorizationChanged')
          .withArgs(freezeVoter1.address, true);
        expect(await strategy.isAuthorizedFreezeVoter(freezeVoter1.address)).to.be.true;
        expect(await strategy.authorizedFreezeVoters()).to.have.lengthOf(1); // Length should still be 1
      });

      it('should allow adding multiple distinct freeze voters', async () => {
        await strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter1.address);
        await strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter2.address);
        expect(await strategy.isAuthorizedFreezeVoter(freezeVoter1.address)).to.be.true;
        expect(await strategy.isAuthorizedFreezeVoter(freezeVoter2.address)).to.be.true;
        const votersArray = await strategy.authorizedFreezeVoters();
        expect(votersArray).to.include(freezeVoter1.address);
        expect(votersArray).to.include(freezeVoter2.address);
        expect(votersArray).to.have.lengthOf(2);
      });

      it('should revert with InvalidAddress if adding address(0)', async () => {
        await expect(
          strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(ethers.ZeroAddress),
        ).to.be.revertedWithCustomError(strategy, 'InvalidAddress');
      });

      it('should revert if called by non-strategyAdmin', async () => {
        await expect(
          strategy.connect(nonOwner).addAuthorizedFreezeVoter(freezeVoter1.address),
        ).to.be.revertedWithCustomError(strategy, 'InvalidStrategyAdmin');
      });
    });

    describe('removeAuthorizedFreezeVoter', () => {
      it('should allow strategyAdmin to remove an authorized freeze voter', async () => {
        await strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter1.address);
        expect(await strategy.authorizedFreezeVoters()).to.have.lengthOf(1);

        await expect(
          strategy.connect(strategyAdmin).removeAuthorizedFreezeVoter(freezeVoter1.address),
        )
          .to.emit(strategy, 'FreezeVoterAuthorizationChanged')
          .withArgs(freezeVoter1.address, false);

        expect(await strategy.isAuthorizedFreezeVoter(freezeVoter1.address)).to.be.false;
        expect(await strategy.authorizedFreezeVoters()).to.have.lengthOf(0);
        expect(await strategy.authorizedFreezeVoters()).to.not.include(freezeVoter1.address);
      });

      it('should correctly remove one voter when multiple are present', async () => {
        await strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter1.address);
        await strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter2.address);
        expect(await strategy.authorizedFreezeVoters()).to.have.lengthOf(2);

        await strategy.connect(strategyAdmin).removeAuthorizedFreezeVoter(freezeVoter1.address);

        expect(await strategy.isAuthorizedFreezeVoter(freezeVoter1.address)).to.be.false;
        expect(await strategy.isAuthorizedFreezeVoter(freezeVoter2.address)).to.be.true;
        const votersArray = await strategy.authorizedFreezeVoters();
        expect(votersArray).to.have.lengthOf(1);
        expect(votersArray).to.include(freezeVoter2.address);
        expect(votersArray).to.not.include(freezeVoter1.address);
      });

      it('should emit event even if removing a non-authorized address', async () => {
        expect(await strategy.isAuthorizedFreezeVoter(freezeVoter1.address)).to.be.false; // Pre-condition
        await expect(
          strategy.connect(strategyAdmin).removeAuthorizedFreezeVoter(freezeVoter1.address),
        )
          .to.emit(strategy, 'FreezeVoterAuthorizationChanged')
          .withArgs(freezeVoter1.address, false);
        expect(await strategy.authorizedFreezeVoters()).to.have.lengthOf(0);
      });

      it('should revert with InvalidAddress if removing address(0)', async () => {
        await expect(
          strategy.connect(strategyAdmin).removeAuthorizedFreezeVoter(ethers.ZeroAddress),
        ).to.be.revertedWithCustomError(strategy, 'InvalidAddress');
      });

      it('should revert if called by non-strategyAdmin', async () => {
        await strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter1.address); // Add one first
        await expect(
          strategy.connect(nonOwner).removeAuthorizedFreezeVoter(freezeVoter1.address),
        ).to.be.revertedWithCustomError(strategy, 'InvalidStrategyAdmin');
      });
    });

    describe('isAuthorizedFreezeVoter', () => {
      it('should return true for an authorized address', async () => {
        await strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter1.address);
        expect(await strategy.isAuthorizedFreezeVoter(freezeVoter1.address)).to.be.true;
      });

      it('should return false for a non-authorized address', async () => {
        expect(await strategy.isAuthorizedFreezeVoter(freezeVoter1.address)).to.be.false;
      });

      it('should return false for an address that was removed', async () => {
        await strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter1.address);
        await strategy.connect(strategyAdmin).removeAuthorizedFreezeVoter(freezeVoter1.address);
        expect(await strategy.isAuthorizedFreezeVoter(freezeVoter1.address)).to.be.false;
      });

      it('should return false for address(0)', async () => {
        expect(await strategy.isAuthorizedFreezeVoter(ethers.ZeroAddress)).to.be.false;
      });
    });

    describe('authorizedFreezeVoters', () => {
      it('should return an empty array initially', async () => {
        expect(await strategy.authorizedFreezeVoters()).to.deep.equal([]);
      });

      it('should return an array with added addresses', async () => {
        await strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter1.address);
        expect(await strategy.authorizedFreezeVoters()).to.deep.equal([freezeVoter1.address]);

        await strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter2.address);
        // Order might not be guaranteed if add doesn't check for duplicates before push, but mapping does.
        // The current addAuthorizedFreezeVoter implementation pushes only if not already in mapping.
        expect(await strategy.authorizedFreezeVoters()).to.include.members([
          freezeVoter1.address,
          freezeVoter2.address,
        ]);
        expect(await strategy.authorizedFreezeVoters()).to.have.lengthOf(2);
      });

      it('should reflect removals in the array', async () => {
        await strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter1.address);
        await strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter2.address);
        await strategy.connect(strategyAdmin).removeAuthorizedFreezeVoter(freezeVoter1.address);

        const votersArray = await strategy.authorizedFreezeVoters();
        expect(votersArray).to.deep.equal([freezeVoter2.address]); // Assumes swap and pop logic
        expect(votersArray).to.have.lengthOf(1);
      });

      it('should return an empty array after all authorized voters are removed', async () => {
        await strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter1.address);
        await strategy.connect(strategyAdmin).removeAuthorizedFreezeVoter(freezeVoter1.address);
        expect(await strategy.authorizedFreezeVoters()).to.deep.equal([]);
      });

      it('array order should be predictable with swap and pop removal', async () => {
        const distinctAddress3 = nonOwner; // Using nonOwner as another distinct address for this test
        await strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter1.address);
        await strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(freezeVoter2.address);
        await strategy.connect(strategyAdmin).addAuthorizedFreezeVoter(distinctAddress3.address);
        // Array is now [freezeVoter1, freezeVoter2, distinctAddress3]

        // Remove freezeVoter2 (middle element)
        await strategy.connect(strategyAdmin).removeAuthorizedFreezeVoter(freezeVoter2.address);
        // Expected: distinctAddress3 (last) swapped into freezeVoter2's spot, then pop. Array: [freezeVoter1, distinctAddress3]
        expect(await strategy.authorizedFreezeVoters()).to.deep.equal([
          freezeVoter1.address,
          distinctAddress3.address,
        ]);

        // Remove freezeVoter1 (first element)
        await strategy.connect(strategyAdmin).removeAuthorizedFreezeVoter(freezeVoter1.address);
        // Expected: distinctAddress3 (last of [freezeVoter1, distinctAddress3]) swapped into freezeVoter1's spot. Array: [distinctAddress3]
        expect(await strategy.authorizedFreezeVoters()).to.deep.equal([distinctAddress3.address]);
      });
    });
  });

  describe('validStrategyVote', () => {
    const PROPOSAL_ID = 1;
    const VOTE_TYPE_YES = 1;
    const ADAPTER_VOTE_DATA = ethers.ZeroHash;

    beforeEach(async () => {
      await strategy.connect(strategyAdmin).initializeProposal(PROPOSAL_ID);
    });

    it('should return true for a valid vote configuration', async () => {
      // Setup: voter1 has voting weight in mockAdapter1
      await mockAdapter1.setWeight(voter1.address, 100n);

      const isValid = await strategy.validStrategyVote(voter1.address, PROPOSAL_ID, VOTE_TYPE_YES, [
        { votingAdapter: await mockAdapter1.getAddress(), adapterVoteData: ADAPTER_VOTE_DATA },
      ]);

      expect(isValid).to.be.true;
    });

    it('should return false if the proposal is not initialized', async () => {
      const uninitializedProposalId = 999;
      await mockAdapter1.setWeight(voter1.address, 100n);

      const isValid = await strategy.validStrategyVote(
        voter1.address,
        uninitializedProposalId,
        VOTE_TYPE_YES,
        [{ votingAdapter: await mockAdapter1.getAddress(), adapterVoteData: ADAPTER_VOTE_DATA }],
      );

      expect(isValid).to.be.false;
    });

    it('should return false if the voting period has ended', async () => {
      const proposalDetails = await strategy.proposalVotingDetails(PROPOSAL_ID);
      await time.increaseTo(proposalDetails.votingEndTimestamp + 1n);

      // Trigger the end of the voting period
      await strategy.connect(voter1).castVote(
        PROPOSAL_ID,
        1,
        [
          {
            votingAdapter: await mockAdapter1.getAddress(),
            adapterVoteData: ADAPTER_VOTE_DATA,
          },
        ],
        0n,
      );

      const isValid = await strategy.validStrategyVote(voter1.address, PROPOSAL_ID, VOTE_TYPE_YES, [
        { votingAdapter: await mockAdapter1.getAddress(), adapterVoteData: ADAPTER_VOTE_DATA },
      ]);

      expect(isValid).to.be.false;
    });

    it('should return false for an invalid vote type', async () => {
      const invalidVoteType = 3;
      await mockAdapter1.setWeight(voter1.address, 100n);

      const isValid = await strategy.validStrategyVote(
        voter1.address,
        PROPOSAL_ID,
        invalidVoteType,
        [{ votingAdapter: await mockAdapter1.getAddress(), adapterVoteData: ADAPTER_VOTE_DATA }],
      );

      expect(isValid).to.be.false;
    });

    it('should return false if the voting adapter is not attached to the strategy', async () => {
      const unconfiguredAdapter = await new MockVotingAdapter__factory(deployer).deploy();
      await unconfiguredAdapter.waitForDeployment();
      await unconfiguredAdapter.setWeight(voter1.address, 100n);

      const isValid = await strategy.validStrategyVote(voter1.address, PROPOSAL_ID, VOTE_TYPE_YES, [
        {
          votingAdapter: await unconfiguredAdapter.getAddress(),
          adapterVoteData: ADAPTER_VOTE_DATA,
        },
      ]);

      expect(isValid).to.be.false;
    });

    it('should return false if the adapter considers the vote invalid', async () => {
      // Adapter returns isValid: false, even with non-zero weight
      await mockAdapter1.setValidVote(voter1.address, false, 100n);

      const isValid = await strategy.validStrategyVote(voter1.address, PROPOSAL_ID, VOTE_TYPE_YES, [
        { votingAdapter: await mockAdapter1.getAddress(), adapterVoteData: ADAPTER_VOTE_DATA },
      ]);

      expect(isValid).to.be.false;
    });

    it('should return false if total voting weight is zero', async () => {
      // Adapter returns isValid: true, but with zero weight
      await mockAdapter1.setValidVote(voter1.address, true, 0n);

      const isValid = await strategy.validStrategyVote(voter1.address, PROPOSAL_ID, VOTE_TYPE_YES, [
        { votingAdapter: await mockAdapter1.getAddress(), adapterVoteData: ADAPTER_VOTE_DATA },
      ]);

      expect(isValid).to.be.false;
    });

    it('should return true with multiple valid adapters', async () => {
      const multiAdapterStrategy = await deployStrategyProxy(
        strategyAdmin.address,
        DEFAULT_VOTING_PERIOD,
        DEFAULT_QUORUM_THRESHOLD,
        DEFAULT_BASIS_NUMERATOR,
        [await mockAdapter1.getAddress(), await mockAdapter2.getAddress()],
        defaultInitialProposerAdapters,
        lightAccountFactoryMockAddress,
      );
      await multiAdapterStrategy.connect(strategyAdmin).initializeProposal(PROPOSAL_ID);

      await mockAdapter1.setWeight(voter1.address, 50n);
      await mockAdapter2.setWeight(voter1.address, 50n);

      const isValid = await multiAdapterStrategy.validStrategyVote(
        voter1.address,
        PROPOSAL_ID,
        VOTE_TYPE_YES,
        [
          {
            votingAdapter: await mockAdapter1.getAddress(),
            adapterVoteData: ADAPTER_VOTE_DATA,
          },
          {
            votingAdapter: await mockAdapter2.getAddress(),
            adapterVoteData: ADAPTER_VOTE_DATA,
          },
        ],
      );
      expect(isValid).to.be.true;
    });

    it('should return false if one of multiple adapters is invalid', async () => {
      const multiAdapterStrategy = await deployStrategyProxy(
        strategyAdmin.address,
        DEFAULT_VOTING_PERIOD,
        DEFAULT_QUORUM_THRESHOLD,
        DEFAULT_BASIS_NUMERATOR,
        [await mockAdapter1.getAddress(), await mockAdapter2.getAddress()],
        defaultInitialProposerAdapters,
        lightAccountFactoryMockAddress,
      );
      await multiAdapterStrategy.connect(strategyAdmin).initializeProposal(PROPOSAL_ID);

      await mockAdapter1.setWeight(voter1.address, 50n);
      await mockAdapter2.setValidVote(voter1.address, false, 50n); // This one will be invalid

      const isValid = await multiAdapterStrategy.validStrategyVote(
        voter1.address,
        PROPOSAL_ID,
        VOTE_TYPE_YES,
        [
          {
            votingAdapter: await mockAdapter1.getAddress(),
            adapterVoteData: ADAPTER_VOTE_DATA,
          },
          {
            votingAdapter: await mockAdapter2.getAddress(),
            adapterVoteData: ADAPTER_VOTE_DATA,
          },
        ],
      );
      expect(isValid).to.be.false;
    });

    it('should return false if no voting adapters are provided', async () => {
      // Setup: Ensure the voter WOULD have valid weight if an adapter was passed.
      await mockAdapter1.setWeight(voter1.address, 100n);

      const isValid = await strategy.validStrategyVote(
        voter1.address,
        PROPOSAL_ID,
        VOTE_TYPE_YES,
        [], // Empty array is the reason for returning false
      );

      expect(isValid).to.be.false;
    });
  });

  describe('Deployment Block', () => {
    runDeploymentBlockTests({
      getContract: () => strategy,
    });
  });
});
