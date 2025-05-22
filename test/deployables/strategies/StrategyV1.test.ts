import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  IERC165__factory,
  IStrategyV1__factory,
  MockLightAccount__factory,
  MockLightAccountFactory,
  MockLightAccountFactory__factory,
  MockTokenAdapter,
  MockTokenAdapter__factory,
  StrategyV1,
  StrategyV1__factory,
} from '../../../typechain-types';
import { calculateInterfaceId } from '../../helpers/utils';
import { runUUPSUpgradeabilityTests } from '../../helpers/uupsUpgradeabilityTests';

describe('StrategyV1', () => {
  // Signers
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let azoriusMock: SignerWithAddress; // To simulate calls from Azorius
  let nonOwner: SignerWithAddress;
  let user1: SignerWithAddress;
  let voter1: SignerWithAddress, voter2: SignerWithAddress, voter3: SignerWithAddress;

  // Contract Instances
  let strategyImplementation: StrategyV1;
  let strategy: StrategyV1;
  let mockAdapter1: MockTokenAdapter;
  let mockAdapter2: MockTokenAdapter;
  let lightAccountFactoryMock: MockLightAccountFactory;
  let lightAccountFactoryMockAddress: string;

  // Default Initialization Parameters for StrategyV1
  const DEFAULT_VOTING_PERIOD = 100; // Example value
  const DEFAULT_QUORUM_THRESHOLD = 1; // Example value, 1 vote
  const DEFAULT_BASIS_NUMERATOR = 500_001; // Example value, >50%

  async function deployStrategyProxy(
    initialOwner: string,
    azoriusAddress: string,
    votingPeriod: number,
    quorumThreshold: number,
    basisNumerator: number,
    initialAdaptersAddresses: string[], // Changed to addresses for calldata
    lightAccountFactoryAddress: string,
  ): Promise<StrategyV1> {
    // For initialAdapters, StrategyV1's initialize expects ITokenAdapter[]
    // This helper will take addresses and we assume they are already deployed mock adapter addresses
    // If actual ITokenAdapter instances were needed for calldata, the caller would pass them.
    // However, for encoding, addresses are often what abi.encode expects for an array of interfaces.
    // Let's clarify this based on how StrategyV1 actually takes it.
    // StrategyV1 initialize takes ITokenAdapter[] memory _initialTokenAdapters
    // So, we should pass an array of addresses, which Solidity will interpret as such.

    const initializeCalldata = strategyImplementation.interface.encodeFunctionData('initialize', [
      initialOwner,
      azoriusAddress,
      votingPeriod,
      quorumThreshold,
      basisNumerator,
      initialAdaptersAddresses, // Pass addresses directly
      lightAccountFactoryAddress,
    ]);
    const proxy = await new ERC1967Proxy__factory(deployer).deploy(
      await strategyImplementation.getAddress(),
      initializeCalldata,
    );
    return StrategyV1__factory.connect(await proxy.getAddress(), deployer);
  }

  beforeEach(async () => {
    [deployer, owner, azoriusMock, nonOwner, user1, voter2, voter3] = await ethers.getSigners();
    voter1 = user1; // Alias for clarity in some tests

    strategyImplementation = await new StrategyV1__factory(deployer).deploy();
    await strategyImplementation.waitForDeployment();

    lightAccountFactoryMock = await new MockLightAccountFactory__factory(deployer).deploy();
    await lightAccountFactoryMock.waitForDeployment();
    lightAccountFactoryMockAddress = lightAccountFactoryMock.target as string;

    mockAdapter1 = await new MockTokenAdapter__factory(deployer).deploy();
    await mockAdapter1.waitForDeployment();
    mockAdapter2 = await new MockTokenAdapter__factory(deployer).deploy();
    await mockAdapter2.waitForDeployment();

    strategy = await deployStrategyProxy(
      owner.address,
      azoriusMock.address,
      DEFAULT_VOTING_PERIOD,
      DEFAULT_QUORUM_THRESHOLD,
      DEFAULT_BASIS_NUMERATOR,
      [],
      lightAccountFactoryMockAddress,
    );
  });

  describe('Initialization', () => {
    it('should initialize with correct parameters and emit StrategyParametersUpdated for each parameter set', async () => {
      const initialOwner = owner.address;
      const azoriusAddress = azoriusMock.address;
      const lightAccountFactoryAddress = lightAccountFactoryMockAddress;
      const initialAdapters: string[] = [await mockAdapter1.getAddress()];
      const votingPeriod = DEFAULT_VOTING_PERIOD + 10;
      const quorumThreshold = DEFAULT_QUORUM_THRESHOLD + 1;
      const basisNumerator = DEFAULT_BASIS_NUMERATOR + 1;

      const initializeCalldata = strategyImplementation.interface.encodeFunctionData('initialize', [
        initialOwner,
        azoriusAddress,
        votingPeriod,
        quorumThreshold,
        basisNumerator,
        initialAdapters,
        lightAccountFactoryAddress,
      ]);
      const proxy = await new ERC1967Proxy__factory(deployer).deploy(
        await strategyImplementation.getAddress(),
        initializeCalldata,
      );
      const tx = proxy.deploymentTransaction();
      const testStrategy = StrategyV1__factory.connect(await proxy.getAddress(), deployer);

      await expect(tx)
        .to.emit(testStrategy, 'StrategyParametersUpdated')
        .withArgs(votingPeriod, quorumThreshold, basisNumerator);

      expect(await testStrategy.owner()).to.equal(initialOwner);
      expect(await testStrategy.azorius()).to.equal(azoriusAddress);
      expect(await testStrategy.votingPeriod()).to.equal(votingPeriod);
      expect(await testStrategy.quorumThreshold()).to.equal(quorumThreshold);
      expect(await testStrategy.basisNumerator()).to.equal(basisNumerator);
      expect(await testStrategy.lightAccountFactory()).to.equal(lightAccountFactoryAddress);
      expect(await testStrategy.getTokenAdapterCount()).to.equal(1);
      expect(await testStrategy.tokenAdapters(0)).to.equal(await mockAdapter1.getAddress());
    });

    it('should revert if azorius address is zero', async () => {
      await expect(
        deployStrategyProxy(
          owner.address,
          ethers.ZeroAddress, // Invalid Azorius
          DEFAULT_VOTING_PERIOD,
          DEFAULT_QUORUM_THRESHOLD,
          DEFAULT_BASIS_NUMERATOR,
          [],
          lightAccountFactoryMockAddress,
        ),
      ).to.be.revertedWithCustomError(strategyImplementation, 'InvalidAzoriusAddress');
    });

    it('should revert if voting period is zero during initialization', async () => {
      await expect(
        deployStrategyProxy(
          owner.address,
          azoriusMock.address,
          0, // Invalid voting period
          DEFAULT_QUORUM_THRESHOLD,
          DEFAULT_BASIS_NUMERATOR,
          [],
          lightAccountFactoryMockAddress,
        ),
      ).to.be.revertedWithCustomError(strategyImplementation, 'InvalidVotingPeriod');
    });

    it('should revert if basis numerator is invalid (too high) during initialization', async () => {
      await expect(
        deployStrategyProxy(
          owner.address,
          azoriusMock.address,
          DEFAULT_VOTING_PERIOD,
          DEFAULT_QUORUM_THRESHOLD,
          1_000_001, // Invalid basis numerator
          [],
          lightAccountFactoryMockAddress,
        ),
      ).to.be.revertedWithCustomError(strategyImplementation, 'InvalidBasisNumerator');
    });

    it('should revert if basis numerator is invalid (too low, <50%) during initialization', async () => {
      await expect(
        deployStrategyProxy(
          owner.address,
          azoriusMock.address,
          DEFAULT_VOTING_PERIOD,
          DEFAULT_QUORUM_THRESHOLD,
          499_999, // Invalid basis numerator (49.9999%)
          [],
          lightAccountFactoryMockAddress,
        ),
      ).to.be.revertedWithCustomError(strategyImplementation, 'InvalidBasisNumerator');
    });

    it('should initialize correctly with zero quorum threshold', async () => {
      const testStrategy = await deployStrategyProxy(
        owner.address,
        azoriusMock.address,
        DEFAULT_VOTING_PERIOD,
        0, // Zero quorum threshold
        DEFAULT_BASIS_NUMERATOR,
        [],
        lightAccountFactoryMockAddress,
      );
      expect(await testStrategy.quorumThreshold()).to.equal(0);
    });

    it('should initialize correctly with basis numerator at 50%', async () => {
      const testStrategy = await deployStrategyProxy(
        owner.address,
        azoriusMock.address,
        DEFAULT_VOTING_PERIOD,
        DEFAULT_QUORUM_THRESHOLD,
        500_000, // 50% basis numerator
        [],
        lightAccountFactoryMockAddress,
      );
      expect(await testStrategy.basisNumerator()).to.equal(500_000);
    });

    it('should initialize correctly with basis numerator at 100%', async () => {
      const testStrategy = await deployStrategyProxy(
        owner.address,
        azoriusMock.address,
        DEFAULT_VOTING_PERIOD,
        DEFAULT_QUORUM_THRESHOLD,
        1_000_000, // 100% basis numerator
        [],
        lightAccountFactoryMockAddress,
      );
      expect(await testStrategy.basisNumerator()).to.equal(1_000_000);
    });
  });

  describe('Adapter Management', () => {
    // --- addAdapter ---
    it('should allow owner to add a new adapter', async () => {
      const adapterAddress = await mockAdapter1.getAddress();
      await expect(strategy.connect(owner).addAdapter(adapterAddress))
        .to.emit(strategy, 'AdapterAdded')
        .withArgs(adapterAddress, 0);
      expect(await strategy.tokenAdapters(0)).to.equal(adapterAddress);
      expect(await strategy.getTokenAdapterCount()).to.equal(1);
    });

    it('should revert when non-owner tries to add an adapter', async () => {
      await expect(
        strategy.connect(nonOwner).addAdapter(await mockAdapter1.getAddress()),
      ).to.be.revertedWithCustomError(strategy, 'OwnableUnauthorizedAccount');
    });

    it('should revert when adding a zero address adapter', async () => {
      await expect(
        strategy.connect(owner).addAdapter(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(strategy, 'AdapterIsZeroAddress');
    });

    it('should revert when adding an already existing adapter', async () => {
      await strategy.connect(owner).addAdapter(await mockAdapter1.getAddress());
      await expect(
        strategy.connect(owner).addAdapter(await mockAdapter1.getAddress()),
      ).to.be.revertedWithCustomError(strategy, 'AdapterAlreadyExists');
    });

    it('should allow adding multiple different adapters', async () => {
      const adapter1Addr = await mockAdapter1.getAddress();
      const adapter2Addr = await mockAdapter2.getAddress();
      await strategy.connect(owner).addAdapter(adapter1Addr);
      await strategy.connect(owner).addAdapter(adapter2Addr);
      expect(await strategy.getTokenAdapterCount()).to.equal(2);
      expect(await strategy.tokenAdapters(0)).to.equal(adapter1Addr);
      expect(await strategy.tokenAdapters(1)).to.equal(adapter2Addr);
    });

    // --- removeAdapter ---
    it('should allow owner to remove an existing adapter', async () => {
      const adapter1Addr = await mockAdapter1.getAddress();
      const adapter2Addr = await mockAdapter2.getAddress();
      await strategy.connect(owner).addAdapter(adapter1Addr);
      await strategy.connect(owner).addAdapter(adapter2Addr);

      // To correctly test the emitted index, we need to know the exact removal logic
      // Assuming it swaps with last and pops:
      // If removing adapter1Addr (at index 0), adapter2Addr (at index 1) moves to 0.
      // The event should reflect the original index of the removed item.
      await expect(strategy.connect(owner).removeAdapter(adapter1Addr))
        .to.emit(strategy, 'AdapterRemoved')
        .withArgs(adapter1Addr, 0);

      expect(await strategy.getTokenAdapterCount()).to.equal(1);
      expect(await strategy.tokenAdapters(0)).to.equal(adapter2Addr);
    });

    it('should allow owner to remove an existing adapter (removing last)', async () => {
      const adapter1Addr = await mockAdapter1.getAddress();
      const adapter2Addr = await mockAdapter2.getAddress();
      await strategy.connect(owner).addAdapter(adapter1Addr);
      await strategy.connect(owner).addAdapter(adapter2Addr);

      await expect(strategy.connect(owner).removeAdapter(adapter2Addr))
        .to.emit(strategy, 'AdapterRemoved')
        .withArgs(adapter2Addr, 1);

      expect(await strategy.getTokenAdapterCount()).to.equal(1);
      expect(await strategy.tokenAdapters(0)).to.equal(adapter1Addr);
    });

    it('should correctly remove the only adapter in the list', async () => {
      const adapter1Addr = await mockAdapter1.getAddress();
      await strategy.connect(owner).addAdapter(adapter1Addr);

      await expect(strategy.connect(owner).removeAdapter(adapter1Addr))
        .to.emit(strategy, 'AdapterRemoved')
        .withArgs(adapter1Addr, 0);
      expect(await strategy.getTokenAdapterCount()).to.equal(0);
    });

    it('should revert when non-owner tries to remove an adapter', async () => {
      await strategy.connect(owner).addAdapter(await mockAdapter1.getAddress());
      await expect(
        strategy.connect(nonOwner).removeAdapter(await mockAdapter1.getAddress()),
      ).to.be.revertedWithCustomError(strategy, 'OwnableUnauthorizedAccount');
    });

    it('should revert when removing a zero address adapter', async () => {
      await expect(
        strategy.connect(owner).removeAdapter(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(strategy, 'AdapterIsZeroAddress');
    });

    it('should revert when removing an adapter that does not exist', async () => {
      await strategy.connect(owner).addAdapter(await mockAdapter2.getAddress()); // Add a different one
      await expect(
        strategy.connect(owner).removeAdapter(await mockAdapter1.getAddress()),
      ).to.be.revertedWithCustomError(strategy, 'AdapterNotFound');
    });

    it('should revert when removing from an empty list of adapters', async () => {
      await expect(
        strategy.connect(owner).removeAdapter(await mockAdapter1.getAddress()),
      ).to.be.revertedWithCustomError(strategy, 'AdapterNotFound');
    });

    // --- getTokenAdapterCount ---
    it('should return the correct number of adapters', async () => {
      expect(await strategy.getTokenAdapterCount()).to.equal(0);
      await strategy.connect(owner).addAdapter(await mockAdapter1.getAddress());
      expect(await strategy.getTokenAdapterCount()).to.equal(1);
      await strategy.connect(owner).addAdapter(await mockAdapter2.getAddress());
      expect(await strategy.getTokenAdapterCount()).to.equal(2);
      await strategy.connect(owner).removeAdapter(await mockAdapter1.getAddress());
      expect(await strategy.getTokenAdapterCount()).to.equal(1);
    });
  });

  describe('initializeProposal', () => {
    let defaultProposalId: number;
    let encodedDefaultProposalId: string;

    beforeEach(() => {
      defaultProposalId = 1;
      encodedDefaultProposalId = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint32'],
        [defaultProposalId],
      );
    });

    it('should revert if called by a non-azorius address', async () => {
      // Ensure at least one adapter is set so NoAdapters isn't hit first
      await strategy.connect(owner).addAdapter(await mockAdapter1.getAddress());
      await expect(
        strategy.connect(nonOwner).initializeProposal(encodedDefaultProposalId),
      ).to.be.revertedWithCustomError(strategy, 'InvalidAzoriusAddress');
    });

    it('should revert if no token adapters are configured', async () => {
      // Strategy is deployed with no adapters by default in the main beforeEach
      await expect(
        strategy.connect(azoriusMock).initializeProposal(encodedDefaultProposalId),
      ).to.be.revertedWithCustomError(strategy, 'NoAdapters');
    });

    it('should correctly initialize proposal details and emit event', async () => {
      await strategy.connect(owner).addAdapter(await mockAdapter1.getAddress());

      const blockBefore = await ethers.provider.getBlock('latest');
      if (!blockBefore) throw new Error('Failed to get latest block');
      const timestampBefore = blockBefore.timestamp;
      const blockNumberBefore = blockBefore.number;

      await expect(strategy.connect(azoriusMock).initializeProposal(encodedDefaultProposalId))
        .to.emit(strategy, 'ProposalInitialized')
        .withArgs(
          defaultProposalId,
          timestampBefore + 1, // Approximate, depends on block mining time
          timestampBefore + 1 + DEFAULT_VOTING_PERIOD, // Approximate
          blockNumberBefore + 1,
        );

      const proposalDetails = await strategy.proposalVotingDetails(defaultProposalId);
      expect(proposalDetails.votingStartTimestamp).to.be.closeTo(timestampBefore + 1, 2); // Allow some leeway for block time
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
      await strategy.connect(owner).addAdapter(await mockAdapter1.getAddress());
      await strategy.connect(azoriusMock).initializeProposal(encodedDefaultProposalId);

      await strategy.connect(azoriusMock).initializeProposal(encodedDefaultProposalId); // Re-initialize

      const proposalDetails = await strategy.proposalVotingDetails(defaultProposalId);
      expect(proposalDetails.yesVotes).to.equal(0);
      expect(proposalDetails.noVotes).to.equal(0);
      expect(proposalDetails.abstainVotes).to.equal(0);
    });
  });

  describe('isProposer', () => {
    it('should return false if no adapters are configured', async () => {
      void expect(await strategy.isProposer(user1.address)).to.be.false;
    });

    it('should return true if any adapter identifies the address as a proposer', async () => {
      await strategy.connect(owner).addAdapter(await mockAdapter1.getAddress());
      await strategy.connect(owner).addAdapter(await mockAdapter2.getAddress());

      // mockAdapter1 says NO, mockAdapter2 says YES
      await mockAdapter1.connect(owner).setProposerStatus(user1.address, false);
      await mockAdapter2.connect(owner).setProposerStatus(user1.address, true);

      void expect(await strategy.isProposer(user1.address)).to.be.true;
    });

    it('should return false if no adapter identifies the address as a proposer', async () => {
      await strategy.connect(owner).addAdapter(await mockAdapter1.getAddress());
      await strategy.connect(owner).addAdapter(await mockAdapter2.getAddress());

      await mockAdapter1.connect(owner).setProposerStatus(user1.address, false);
      await mockAdapter2.connect(owner).setProposerStatus(user1.address, false);

      void expect(await strategy.isProposer(user1.address)).to.be.false;
    });

    it('should return true if the first adapter identifies the address as a proposer', async () => {
      await strategy.connect(owner).addAdapter(await mockAdapter1.getAddress());
      await strategy.connect(owner).addAdapter(await mockAdapter2.getAddress());

      await mockAdapter1.connect(owner).setProposerStatus(user1.address, true);
      await mockAdapter2.connect(owner).setProposerStatus(user1.address, false); // Should not be checked

      void expect(await strategy.isProposer(user1.address)).to.be.true;
    });
  });

  describe('getVotingTimestamps & getProposalBlocks', () => {
    let proposalId: number;
    let encodedProposalId: string;

    beforeEach(async () => {
      proposalId = 1;
      encodedProposalId = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);
      // Ensure at least one adapter is added for initializeProposal to succeed
      await strategy.connect(owner).addAdapter(await mockAdapter1.getAddress());
    });

    it('should return correct timestamps and block after proposal initialization', async () => {
      const blockBefore = await ethers.provider.getBlock('latest');
      if (!blockBefore) throw new Error('Failed to get latest block');
      const timestampBefore = blockBefore.timestamp;
      const blockNumberBefore = blockBefore.number;

      await strategy.connect(azoriusMock).initializeProposal(encodedProposalId);

      const [startTime, endTime] = await strategy.getVotingTimestamps(proposalId);
      const startBlock = await strategy.getProposalBlocks(proposalId);

      expect(startTime).to.be.closeTo(timestampBefore + 1, 2);
      expect(endTime).to.be.closeTo(timestampBefore + 1 + DEFAULT_VOTING_PERIOD, 2);
      expect(startBlock).to.equal(blockNumberBefore + 1);
    });

    it('getVotingTimestamps should revert if proposal is not initialized', async () => {
      const uninitializedProposalId = 999;
      await expect(
        strategy.getVotingTimestamps(uninitializedProposalId),
      ).to.be.revertedWithCustomError(strategy, 'ProposalNotInitialized');
    });

    it('getProposalBlocks should revert if proposal is not initialized', async () => {
      const uninitializedProposalId = 999;
      await expect(
        strategy.getProposalBlocks(uninitializedProposalId),
      ).to.be.revertedWithCustomError(strategy, 'ProposalNotInitialized');
    });
  });

  describe('vote', () => {
    let proposalId: number;
    let encodedProposalId: string;
    let adapter1Data: string; // abi.encode(tokenId[]) for ERC721, or empty for ERC20
    let adapter2Data: string;

    beforeEach(async () => {
      proposalId = 1;
      encodedProposalId = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);

      // Add at least one adapter for most tests
      await strategy.connect(owner).addAdapter(await mockAdapter1.getAddress());
      // Initialize the proposal by azoriusMock
      await strategy.connect(azoriusMock).initializeProposal(encodedProposalId);

      // Example adapter data (can be customized per test)
      // For ERC20Adapter, this would typically be ethers.AbiCoder.defaultAbiCoder().encode([], []); (empty)
      // For ERC721Adapter, ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[101, 102]]);
      adapter1Data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1]]); // Mocking ERC721 style data
      adapter2Data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[2]]);

      // Deploy MockLightAccount for ERC4337 tests if not already available globally
      // For this specific test, we might deploy it inside if needed fresh
    });

    it('should revert if _adaptersToUse and _adapterVoteData lengths mismatch', async () => {
      const adaptersToUse = [mockAdapter1]; // 1 adapter
      const adapterVoteData: string[] = []; // 0 data entries
      await expect(
        strategy.connect(user1).vote(proposalId, 1, adaptersToUse, adapterVoteData),
      ).to.be.revertedWithCustomError(strategy, 'MismatchedInputs');
    });

    it('should revert if proposal is not initialized (votingEndTimestamp is 0)', async () => {
      const uninitializedProposalId = 999;
      await expect(
        strategy.connect(user1).vote(uninitializedProposalId, 1, [mockAdapter1], [adapter1Data]),
      ).to.be.revertedWithCustomError(strategy, 'ProposalNotFoundOrNotActive');
    });

    it('should revert if voting period has ended', async () => {
      // Advance time beyond voting period
      const proposalDetails = await strategy.proposalVotingDetails(proposalId);
      await time.increaseTo(proposalDetails.votingEndTimestamp + 1n);

      await expect(
        strategy.connect(user1).vote(proposalId, 1, [mockAdapter1], [adapter1Data]),
      ).to.be.revertedWithCustomError(strategy, 'ProposalNotFoundOrNotActive');
    });

    it('should revert if total weight cast is zero (e.g., adapter.recordVote returns 0)', async () => {
      await mockAdapter1.connect(owner).setWeight(user1.address, 0); // Ensure recordVote (via setWeight) returns 0
      await expect(
        strategy.connect(user1).vote(proposalId, 1, [mockAdapter1], [adapter1Data]),
      ).to.be.revertedWithCustomError(strategy, 'NoVotingWeight');
    });

    it('should revert on invalid voteType', async () => {
      const invalidVoteType = 3; // VoteType enum is 0, 1, 2
      await mockAdapter1.connect(owner).setWeight(user1.address, 10); // Give some weight
      await expect(
        strategy.connect(user1).vote(proposalId, invalidVoteType, [mockAdapter1], [adapter1Data]),
      ).to.be.revertedWithCustomError(strategy, 'InvalidVoteType');
    });

    it('should correctly record a YES vote, update counts, and emit Voted event', async () => {
      const voteWeight = 100;
      await mockAdapter1.connect(owner).setWeight(user1.address, voteWeight);

      const tx = await strategy
        .connect(user1)
        .vote(proposalId, 1 /* YES */, [mockAdapter1], [adapter1Data]);

      await expect(tx)
        .to.emit(strategy, 'Voted')
        .withArgs(user1.address, proposalId, 1 /* YES */, voteWeight);

      const proposalDetails = await strategy.proposalVotingDetails(proposalId);
      expect(proposalDetails.yesVotes).to.equal(voteWeight);
      expect(proposalDetails.noVotes).to.equal(0);
      expect(proposalDetails.abstainVotes).to.equal(0);

      // Verify adapter's recordVote was called (using our mock's state)
      expect(await mockAdapter1.lastVoterForRecordVote()).to.equal(user1.address);
      expect(await mockAdapter1.lastProposalIdForRecordVote()).to.equal(proposalId);
      // Note: MockTokenAdapter currently doesn't store lastAdapterDataForRecordVote to save gas
      // but we can check if it was recorded if needed by enhancing the mock.
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
      await mockAdapter1.connect(owner).setWeight(user1.address, voteWeight);

      await expect(
        strategy.connect(user1).vote(proposalId, 0 /* NO */, [mockAdapter1], [adapter1Data]),
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
      await mockAdapter1.connect(owner).setWeight(user1.address, voteWeight);

      await expect(
        strategy.connect(user1).vote(proposalId, 2 /* ABSTAIN */, [mockAdapter1], [adapter1Data]),
      )
        .to.emit(strategy, 'Voted')
        .withArgs(user1.address, proposalId, 2 /* ABSTAIN */, voteWeight);

      const proposalDetails = await strategy.proposalVotingDetails(proposalId);
      expect(proposalDetails.abstainVotes).to.equal(voteWeight);
      expect(proposalDetails.yesVotes).to.equal(0);
      expect(proposalDetails.noVotes).to.equal(0);
    });

    it('should sum weights if multiple adapters are used in one vote call', async () => {
      // Add second adapter to the strategy for this test
      await strategy.connect(owner).addAdapter(await mockAdapter2.getAddress());

      const weight1 = 60;
      const weight2 = 40;
      await mockAdapter1.connect(owner).setWeight(user1.address, weight1);
      await mockAdapter2.connect(owner).setWeight(user1.address, weight2); // user1 votes with both adapters

      const adaptersToUse = [mockAdapter1, mockAdapter2];
      const adapterVoteDataArray = [adapter1Data, adapter2Data]; // Assuming different data for each or just placeholders

      await expect(
        strategy.connect(user1).vote(proposalId, 1 /* YES */, adaptersToUse, adapterVoteDataArray),
      )
        .to.emit(strategy, 'Voted')
        .withArgs(user1.address, proposalId, 1 /* YES */, weight1 + weight2);

      const proposalDetails = await strategy.proposalVotingDetails(proposalId);
      expect(proposalDetails.yesVotes).to.equal(weight1 + weight2);
    });

    it('should support ERC4337 by using the resolved voter address', async () => {
      const smartAccountOwner = user1;
      const relayer = nonOwner;

      // 1. Deploy MockLightAccount directly, owned by smartAccountOwner
      const mockLightAccountDeployedFactory = new MockLightAccount__factory(deployer);
      const mockSmartAccount = await mockLightAccountDeployedFactory.deploy(
        smartAccountOwner.address,
      );
      await mockSmartAccount.waitForDeployment();
      const mockSmartAccountAddress = await mockSmartAccount.getAddress();

      // 2. IMPORTANT: Configure the lightAccountFactoryMock (used by StrategyV1) to correctly resolve this smart account
      await lightAccountFactoryMock.setAccountAddress(
        smartAccountOwner.address,
        0,
        mockSmartAccountAddress,
      );

      const voteWeight = 77;
      // Set weight for the smartAccountOwner (user1) in the mock adapter
      await mockAdapter1.connect(owner).setWeight(smartAccountOwner.address, voteWeight);

      const tx = await mockSmartAccount
        .connect(relayer)
        .callStrategyVote(
          await strategy.getAddress(),
          proposalId,
          1 /* YES */,
          [await mockAdapter1.getAddress()],
          [adapter1Data],
        );

      await expect(tx)
        .to.emit(strategy, 'Voted')
        .withArgs(smartAccountOwner.address, proposalId, 1 /* YES */, voteWeight);

      const proposalDetails = await strategy.proposalVotingDetails(proposalId);
      expect(proposalDetails.yesVotes).to.equal(voteWeight);

      expect(await mockAdapter1.lastVoterForRecordVote()).to.equal(smartAccountOwner.address);
    });

    it('should revert if an adapter call to recordVote reverts', async () => {
      await mockAdapter1.connect(owner).setWeight(user1.address, 10);
      await mockAdapter1.setShouldRevertOnRecordVote(true); // Configure mock to revert

      await expect(
        strategy.connect(user1).vote(proposalId, 1 /* YES */, [mockAdapter1], [adapter1Data]),
      ).to.be.revertedWith('MockTokenAdapter: recordVote forced revert');
    });

    it('should revert if any adapter call reverts in a multi-adapter vote (all-or-nothing)', async () => {
      await strategy.connect(owner).addAdapter(await mockAdapter2.getAddress());

      await mockAdapter1.connect(owner).setWeight(user1.address, 10);
      await mockAdapter2.connect(owner).setWeight(user1.address, 20);

      await mockAdapter1.setShouldRevertOnRecordVote(false); // Adapter 1 should succeed initially
      await mockAdapter2.setShouldRevertOnRecordVote(true); // Adapter 2 will revert

      const adaptersToUse = [mockAdapter1, mockAdapter2];
      const adapterDataForVoter1Adapter1 = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[777]],
      );
      const adapterDataForVoter1Adapter2 = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[888]],
      );
      const adapterVoteDataArray = [adapterDataForVoter1Adapter1, adapterDataForVoter1Adapter2];

      await expect(
        strategy.connect(user1).vote(proposalId, 1 /* YES */, adaptersToUse, adapterVoteDataArray),
      ).to.be.revertedWith('MockTokenAdapter: recordVote forced revert');

      const proposalDetails = await strategy.proposalVotingDetails(proposalId);
      expect(proposalDetails.yesVotes).to.equal(0);
      expect(proposalDetails.noVotes).to.equal(0);
      expect(proposalDetails.abstainVotes).to.equal(0);

      const dataHashAdapter1 = ethers.keccak256(adapterDataForVoter1Adapter1);
      void expect(await mockAdapter1.hasRecordedVote(user1.address, proposalId, dataHashAdapter1))
        .to.be.false;
    });
  });

  describe('isPassed', () => {
    let proposalId: number;
    let encodedProposalId: string;
    let adapter1Data: string;

    beforeEach(async () => {
      proposalId = 1;
      encodedProposalId = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);
      adapter1Data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1001]]);
    });

    it('should return false if proposal was not initialized', async () => {
      const uninitializedProposalId = 999;
      void expect(await strategy.isPassed(uninitializedProposalId)).to.be.false;
    });

    it('should return false if voting period is not over', async () => {
      await strategy.connect(owner).addAdapter(await mockAdapter1.getAddress());
      await strategy.connect(azoriusMock).initializeProposal(encodedProposalId);

      await mockAdapter1.connect(owner).setWeight(voter1.address, 100);
      await strategy.connect(voter1).vote(proposalId, 1 /* YES */, [mockAdapter1], [adapter1Data]);
      void expect(await strategy.isPassed(proposalId)).to.be.false;
    });

    describe('Quorum Logic', () => {
      let localMockAdapter1: MockTokenAdapter;
      let localAdapter1Data: string;
      let localAdapter2Data: string;

      beforeEach(async () => {
        localMockAdapter1 = await new MockTokenAdapter__factory(deployer).deploy();
        await localMockAdapter1.waitForDeployment();

        localAdapter1Data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[3003]]);
        localAdapter2Data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[4004]]);
      });

      it('should return false if quorum is not met (yes + abstain < threshold)', async () => {
        const specificQuorumThreshold = 100;
        const localStrategy = await deployStrategyProxy(
          owner.address,
          azoriusMock.address,
          DEFAULT_VOTING_PERIOD,
          specificQuorumThreshold,
          DEFAULT_BASIS_NUMERATOR,
          [await localMockAdapter1.getAddress()],
          lightAccountFactoryMockAddress,
        );
        await localStrategy.connect(azoriusMock).initializeProposal(encodedProposalId);

        await localMockAdapter1.connect(owner).setWeight(voter1.address, 50);
        await localMockAdapter1.connect(owner).setWeight(voter2.address, 49);

        await localStrategy
          .connect(voter1)
          .vote(proposalId, 1 /* YES */, [localMockAdapter1], [localAdapter1Data]);
        await localStrategy
          .connect(voter2)
          .vote(proposalId, 2 /* ABSTAIN */, [localMockAdapter1], [localAdapter2Data]);

        const propDetails = await localStrategy.proposalVotingDetails(proposalId);

        await time.increaseTo(propDetails.votingEndTimestamp + 1n);

        void expect(await localStrategy.isPassed(proposalId)).to.be.false;
      });

      it('should evaluate basis if quorum is met exactly (yes + abstain == threshold)', async () => {
        const specificQuorumThreshold = 100;
        const localStrategy = await deployStrategyProxy(
          owner.address,
          azoriusMock.address,
          DEFAULT_VOTING_PERIOD,
          specificQuorumThreshold,
          DEFAULT_BASIS_NUMERATOR,
          [await localMockAdapter1.getAddress()],
          lightAccountFactoryMockAddress,
        );
        await localStrategy.connect(azoriusMock).initializeProposal(encodedProposalId);

        await localMockAdapter1.connect(owner).setWeight(voter1.address, 100);
        await localStrategy
          .connect(voter1)
          .vote(proposalId, 1 /* YES */, [localMockAdapter1], [localAdapter1Data]);

        const propDetails = await localStrategy.proposalVotingDetails(proposalId);
        await time.increaseTo(propDetails.votingEndTimestamp + 1n);

        void expect(await localStrategy.isPassed(proposalId)).to.be.true;
      });

      it('should evaluate basis if quorum is exceeded (yes + abstain > threshold)', async () => {
        const specificQuorumThreshold = 100;
        const localStrategy = await deployStrategyProxy(
          owner.address,
          azoriusMock.address,
          DEFAULT_VOTING_PERIOD,
          specificQuorumThreshold,
          DEFAULT_BASIS_NUMERATOR,
          [await localMockAdapter1.getAddress()],
          lightAccountFactoryMockAddress,
        );
        await localStrategy.connect(azoriusMock).initializeProposal(encodedProposalId);

        await localMockAdapter1.connect(owner).setWeight(voter1.address, 101);
        await localStrategy
          .connect(voter1)
          .vote(proposalId, 1 /* YES */, [localMockAdapter1], [localAdapter1Data]);

        const propDetails = await localStrategy.proposalVotingDetails(proposalId);
        await time.increaseTo(propDetails.votingEndTimestamp + 1n);

        void expect(await localStrategy.isPassed(proposalId)).to.be.true;
      });

      it('should pass quorum if threshold is 0, even with 0 votes, but fail basis', async () => {
        const localStrategy = await deployStrategyProxy(
          owner.address,
          azoriusMock.address,
          DEFAULT_VOTING_PERIOD,
          0,
          DEFAULT_BASIS_NUMERATOR,
          [await localMockAdapter1.getAddress()],
          lightAccountFactoryMockAddress,
        );
        await localStrategy.connect(azoriusMock).initializeProposal(encodedProposalId);

        const propDetails = await localStrategy.proposalVotingDetails(proposalId);
        await time.increaseTo(propDetails.votingEndTimestamp + 1n);

        void expect(await localStrategy.isPassed(proposalId)).to.be.false;
      });
    });

    describe('Basis Logic (assuming quorum met, voting ended)', () => {
      const highQuorumThreshold = 200;
      let localMockAdapterBasis1: MockTokenAdapter;
      let localAdapterBasis1Data: string;
      let localAdapterBasis2Data: string;
      let localStrategyForBasis: StrategyV1;

      beforeEach(async () => {
        localMockAdapterBasis1 = await new MockTokenAdapter__factory(deployer).deploy();
        await localMockAdapterBasis1.waitForDeployment();

        localAdapterBasis1Data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[5005]]);
        localAdapterBasis2Data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[6006]]);

        localStrategyForBasis = await deployStrategyProxy(
          owner.address,
          azoriusMock.address,
          DEFAULT_VOTING_PERIOD,
          highQuorumThreshold,
          DEFAULT_BASIS_NUMERATOR,
          [await localMockAdapterBasis1.getAddress()],
          lightAccountFactoryMockAddress,
        );
        await localStrategyForBasis.connect(azoriusMock).initializeProposal(encodedProposalId);
      });

      it('should return false if basis is not met (YES <= NO with >50% basis)', async () => {
        await localMockAdapterBasis1.connect(owner).setWeight(voter1.address, 100);
        await localMockAdapterBasis1.connect(owner).setWeight(voter2.address, 100);

        await localStrategyForBasis
          .connect(voter1)
          .vote(proposalId, 1 /* YES */, [localMockAdapterBasis1], [localAdapterBasis1Data]);
        await localStrategyForBasis
          .connect(voter2)
          .vote(proposalId, 0 /* NO */, [localMockAdapterBasis1], [localAdapterBasis2Data]);

        const propDetails = await localStrategyForBasis.proposalVotingDetails(proposalId);
        await time.increaseTo(propDetails.votingEndTimestamp + 1n);
        void expect(await localStrategyForBasis.isPassed(proposalId)).to.be.false;
      });

      it('should return true if basis is met (YES > NO with >50% basis)', async () => {
        await localMockAdapterBasis1.connect(owner).setWeight(voter1.address, 101);
        await localMockAdapterBasis1.connect(owner).setWeight(voter2.address, 100);
        await localMockAdapterBasis1.connect(owner).setWeight(voter3.address, 99);

        await localStrategyForBasis
          .connect(voter1)
          .vote(proposalId, 1 /* YES */, [localMockAdapterBasis1], [localAdapterBasis1Data]);
        await localStrategyForBasis
          .connect(voter2)
          .vote(proposalId, 0 /* NO */, [localMockAdapterBasis1], [localAdapterBasis2Data]);
        await localStrategyForBasis
          .connect(voter3)
          .vote(proposalId, 2 /* ABSTAIN */, [localMockAdapterBasis1], [localAdapterBasis2Data]);

        const propDetails = await localStrategyForBasis.proposalVotingDetails(proposalId);
        await time.increaseTo(propDetails.votingEndTimestamp + 1n);
        void expect(await localStrategyForBasis.isPassed(proposalId)).to.be.true;
      });

      it('should return true if basis is met (YES > 0, NO = 0 with >50% basis)', async () => {
        await localMockAdapterBasis1.connect(owner).setWeight(voter1.address, highQuorumThreshold);
        await localStrategyForBasis
          .connect(voter1)
          .vote(proposalId, 1 /* YES */, [localMockAdapterBasis1], [localAdapterBasis1Data]);

        const propDetails = await localStrategyForBasis.proposalVotingDetails(proposalId);
        await time.increaseTo(propDetails.votingEndTimestamp + 1n);
        void expect(await localStrategyForBasis.isPassed(proposalId)).to.be.true;
      });

      it('should return false if totalYesAndNoVotes is 0 (e.g. only Abstain votes)', async () => {
        await localMockAdapterBasis1.connect(owner).setWeight(voter1.address, highQuorumThreshold);
        await localStrategyForBasis
          .connect(voter1)
          .vote(proposalId, 2 /* ABSTAIN */, [localMockAdapterBasis1], [localAdapterBasis1Data]);

        const propDetails = await localStrategyForBasis.proposalVotingDetails(proposalId);
        await time.increaseTo(propDetails.votingEndTimestamp + 1n);
        void expect(await localStrategyForBasis.isPassed(proposalId)).to.be.false;
      });
    });
  });

  describe('ERC165 Supports Interface', () => {
    let iStrategyV1InterfaceId: string;
    let iERC165InterfaceId: string;

    beforeEach(async () => {
      const IStrategyV1Interface = IStrategyV1__factory.createInterface();
      iStrategyV1InterfaceId = calculateInterfaceId(IStrategyV1Interface);

      const IERC165Interface = IERC165__factory.createInterface();
      iERC165InterfaceId = calculateInterfaceId(IERC165Interface);
    });

    it('Should support IStrategyV1 interface', async () => {
      void expect(await strategy.supportsInterface(iStrategyV1InterfaceId)).to.be.true;
    });

    it('Should support IERC165 interface', async () => {
      void expect(await strategy.supportsInterface(iERC165InterfaceId)).to.be.true;
    });

    it('Should not support a random interface', async () => {
      const randomInterfaceId = '0x12345678';
      void expect(await strategy.supportsInterface(randomInterfaceId)).to.be.false;
    });
  });

  describe('UUPS Upgradeability', () => {
    // Note: The `strategy` instance used here is the proxy deployed in the main beforeEach.
    // The owner of this proxy is `owner` (the signer).
    runUUPSUpgradeabilityTests({
      getContract: () => strategy,
      createNewImplementation: async () => {
        // Deploy a new logic contract using the `owner` signer for consistency,
        // as owner is typically responsible for upgrades.
        const newImplementation = await new StrategyV1__factory(owner).deploy();
        return newImplementation;
      },
      owner: () => owner, // The `owner` variable from the test suite
      nonOwner: () => nonOwner, // The `nonOwner` variable from the test suite
    });
  });

  describe('Update Strategy Parameters', () => {
    describe('updateVotingPeriod', () => {
      it('should allow owner to update voting period and emit StrategyParametersUpdated event', async () => {
        const newVotingPeriod = 200;
        await expect(strategy.connect(owner).updateVotingPeriod(newVotingPeriod))
          .to.emit(strategy, 'StrategyParametersUpdated')
          .withArgs(newVotingPeriod, DEFAULT_QUORUM_THRESHOLD, DEFAULT_BASIS_NUMERATOR);
        expect(await strategy.votingPeriod()).to.equal(newVotingPeriod);
      });

      it('should revert if non-owner tries to update voting period', async () => {
        const newVotingPeriod = 200;
        await expect(
          strategy.connect(nonOwner).updateVotingPeriod(newVotingPeriod),
        ).to.be.revertedWithCustomError(strategy, 'OwnableUnauthorizedAccount');
      });

      it('should revert if voting period is zero', async () => {
        await expect(strategy.connect(owner).updateVotingPeriod(0)).to.be.revertedWithCustomError(
          strategy,
          'InvalidVotingPeriod',
        );
      });
    });

    describe('updateQuorumThreshold', () => {
      it('should allow owner to update quorum threshold and emit StrategyParametersUpdated event', async () => {
        const newQuorumThreshold = 50;
        await expect(strategy.connect(owner).updateQuorumThreshold(newQuorumThreshold))
          .to.emit(strategy, 'StrategyParametersUpdated')
          .withArgs(DEFAULT_VOTING_PERIOD, newQuorumThreshold, DEFAULT_BASIS_NUMERATOR);
        expect(await strategy.quorumThreshold()).to.equal(newQuorumThreshold);
      });

      it('should allow owner to set quorum threshold to zero', async () => {
        const newQuorumThreshold = 0;
        await expect(strategy.connect(owner).updateQuorumThreshold(newQuorumThreshold))
          .to.emit(strategy, 'StrategyParametersUpdated')
          .withArgs(DEFAULT_VOTING_PERIOD, newQuorumThreshold, DEFAULT_BASIS_NUMERATOR);
        expect(await strategy.quorumThreshold()).to.equal(newQuorumThreshold);
      });

      it('should revert if non-owner tries to update quorum threshold', async () => {
        const newQuorumThreshold = 50;
        await expect(
          strategy.connect(nonOwner).updateQuorumThreshold(newQuorumThreshold),
        ).to.be.revertedWithCustomError(strategy, 'OwnableUnauthorizedAccount');
      });
    });

    describe('updateBasisNumerator', () => {
      it('should allow owner to update basis numerator and emit StrategyParametersUpdated event', async () => {
        const newBasisNumerator = 600_000; // 60%
        await expect(strategy.connect(owner).updateBasisNumerator(newBasisNumerator))
          .to.emit(strategy, 'StrategyParametersUpdated')
          .withArgs(DEFAULT_VOTING_PERIOD, DEFAULT_QUORUM_THRESHOLD, newBasisNumerator);
        expect(await strategy.basisNumerator()).to.equal(newBasisNumerator);
      });

      it('should revert if non-owner tries to update basis numerator', async () => {
        const newBasisNumerator = 600_000;
        await expect(
          strategy.connect(nonOwner).updateBasisNumerator(newBasisNumerator),
        ).to.be.revertedWithCustomError(strategy, 'OwnableUnauthorizedAccount');
      });

      it('should revert if basis numerator is too high (> 1,000,000)', async () => {
        const invalidBasisNumerator = 1_000_001;
        await expect(
          strategy.connect(owner).updateBasisNumerator(invalidBasisNumerator),
        ).to.be.revertedWithCustomError(strategy, 'InvalidBasisNumerator');
      });

      it('should revert if basis numerator is too low (< 500,000)', async () => {
        const invalidBasisNumerator = 499_999;
        await expect(
          strategy.connect(owner).updateBasisNumerator(invalidBasisNumerator),
        ).to.be.revertedWithCustomError(strategy, 'InvalidBasisNumerator');
      });

      it('should allow setting basis numerator to 50% (500,000) and emit StrategyParametersUpdated', async () => {
        const newBasisNumerator = 500_000;
        await expect(strategy.connect(owner).updateBasisNumerator(newBasisNumerator))
          .to.emit(strategy, 'StrategyParametersUpdated')
          .withArgs(DEFAULT_VOTING_PERIOD, DEFAULT_QUORUM_THRESHOLD, newBasisNumerator);
        expect(await strategy.basisNumerator()).to.equal(newBasisNumerator);
      });

      it('should allow setting basis numerator to 100% (1,000,000) and emit StrategyParametersUpdated', async () => {
        const newBasisNumerator = 1_000_000;
        await expect(strategy.connect(owner).updateBasisNumerator(newBasisNumerator))
          .to.emit(strategy, 'StrategyParametersUpdated')
          .withArgs(DEFAULT_VOTING_PERIOD, DEFAULT_QUORUM_THRESHOLD, newBasisNumerator);
        expect(await strategy.basisNumerator()).to.equal(newBasisNumerator);
      });
    });
  });

  describe('Version', () => {
    it('should return the correct version', async () => {
      void expect(await strategy.getVersion()).to.equal(1);
    });
  });
});
