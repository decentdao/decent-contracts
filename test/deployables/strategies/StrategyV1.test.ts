import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  IERC165__factory,
  IStrategyBaseV1__factory,
  IStrategyV1__factory,
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

  // Contract Instances
  let strategyImplementation: StrategyV1;
  let strategy: StrategyV1;
  let mockAdapter1: MockTokenAdapter;
  let mockAdapter2: MockTokenAdapter;
  let lightAccountFactoryMock: MockLightAccountFactory;
  let lightAccountFactoryMockAddress: string;

  // Default Initialization Parameters for StrategyV1
  const DEFAULT_VOTING_PERIOD = 100; // Example value
  const DEFAULT_QUORUM_THRESHOLD = 1n;
  const DEFAULT_BASIS_NUMERATOR = 500_001n;

  async function deployStrategyProxy(
    initialOwner: string,
    azoriusAddress: string,
    votingPeriod: number,
    quorumThreshold: bigint,
    basisNumerator: bigint,
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
    [deployer, owner, azoriusMock, nonOwner, user1] = await ethers.getSigners();

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
      const quorumThreshold = DEFAULT_QUORUM_THRESHOLD + 1n;
      const basisNumerator = DEFAULT_BASIS_NUMERATOR + 1n;

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
          1_000_001n,
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
          499_999n,
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
        0n, // Zero quorum threshold
        DEFAULT_BASIS_NUMERATOR,
        [],
        lightAccountFactoryMockAddress,
      );
      expect(await testStrategy.quorumThreshold()).to.equal(0n);
    });

    it('should initialize correctly with basis numerator at 50%', async () => {
      const testStrategy = await deployStrategyProxy(
        owner.address,
        azoriusMock.address,
        DEFAULT_VOTING_PERIOD,
        DEFAULT_QUORUM_THRESHOLD,
        500_000n, // 50% basis numerator
        [],
        lightAccountFactoryMockAddress,
      );
      expect(await testStrategy.basisNumerator()).to.equal(500_000n);
    });

    it('should revert when initializing with basis numerator at 100% (1,000,000)', async () => {
      await expect(
        deployStrategyProxy(
          owner.address,
          azoriusMock.address,
          DEFAULT_VOTING_PERIOD,
          DEFAULT_QUORUM_THRESHOLD,
          1_000_000n, // 100% basis numerator - now invalid
          [],
          lightAccountFactoryMockAddress,
        ),
      ).to.be.revertedWithCustomError(strategyImplementation, 'InvalidBasisNumerator');
    });

    it('should initialize correctly with basis numerator at new maximum (BASIS_DENOMINATOR - 1)', async () => {
      const maxValidBasis = 1_000_000n - 1n; // BASIS_DENOMINATOR - 1
      const testStrategy = await deployStrategyProxy(
        owner.address,
        azoriusMock.address,
        DEFAULT_VOTING_PERIOD,
        DEFAULT_QUORUM_THRESHOLD,
        maxValidBasis,
        [],
        lightAccountFactoryMockAddress,
      );
      expect(await testStrategy.basisNumerator()).to.equal(maxValidBasis);
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
        strategy
          .connect(nonOwner)
          .initializeProposal(encodedDefaultProposalId, [], ethers.ZeroHash),
      ).to.be.revertedWithCustomError(strategy, 'InvalidAzoriusAddress');
    });

    it('should revert if no token adapters are configured', async () => {
      // Strategy is deployed with no adapters by default in the main beforeEach
      await expect(
        strategy
          .connect(azoriusMock)
          .initializeProposal(encodedDefaultProposalId, [], ethers.ZeroHash),
      ).to.be.revertedWithCustomError(strategy, 'NoAdapters');
    });

    it('should correctly initialize proposal details and emit event', async () => {
      await strategy.connect(owner).addAdapter(await mockAdapter1.getAddress());

      const blockBefore = await ethers.provider.getBlock('latest');
      if (!blockBefore) throw new Error('Failed to get latest block');
      const timestampBefore = blockBefore.timestamp;

      await expect(
        strategy
          .connect(azoriusMock)
          .initializeProposal(encodedDefaultProposalId, [], ethers.ZeroHash),
      )
        .to.emit(strategy, 'ProposalInitialized')
        .withArgs(
          defaultProposalId,
          timestampBefore + 1, // Approximate, depends on block mining time
          timestampBefore + 1 + DEFAULT_VOTING_PERIOD, // Approximate
        );

      const proposalDetails = await strategy.proposalVotingDetails(defaultProposalId);
      expect(proposalDetails.votingStartTimestamp).to.be.closeTo(timestampBefore + 1, 2); // Allow some leeway for block time
      expect(proposalDetails.votingEndTimestamp).to.be.closeTo(
        timestampBefore + 1 + DEFAULT_VOTING_PERIOD,
        2,
      );
      expect(proposalDetails.yesVotes).to.equal(0);
      expect(proposalDetails.noVotes).to.equal(0);
      expect(proposalDetails.abstainVotes).to.equal(0);
    });

    it('should reset vote counts for a re-initialized proposal', async () => {
      await strategy.connect(owner).addAdapter(await mockAdapter1.getAddress());
      await strategy
        .connect(azoriusMock)
        .initializeProposal(encodedDefaultProposalId, [], ethers.ZeroHash);

      await strategy
        .connect(azoriusMock)
        .initializeProposal(encodedDefaultProposalId, [], ethers.ZeroHash); // Re-initialize

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

    it('should return correct timestamps after proposal initialization', async () => {
      const blockBefore = await ethers.provider.getBlock('latest');
      if (!blockBefore) throw new Error('Failed to get latest block');
      const timestampBefore = blockBefore.timestamp;

      await strategy
        .connect(azoriusMock)
        .initializeProposal(encodedProposalId, [], ethers.ZeroHash);

      const [startTime, endTime] = await strategy.getVotingTimestamps(proposalId);

      expect(startTime).to.be.closeTo(timestampBefore + 1, 2);
      expect(endTime).to.be.closeTo(timestampBefore + 1 + DEFAULT_VOTING_PERIOD, 2);
    });

    it('getVotingTimestamps should revert if proposal is not initialized', async () => {
      const uninitializedProposalId = 999;
      await expect(
        strategy.getVotingTimestamps(uninitializedProposalId),
      ).to.be.revertedWithCustomError(strategy, 'ProposalNotInitialized');
    });
  });

  describe('isPassed', () => {
    const PROPOSAL_ID = 1;
    // This beforeEach ensures that for each test in this describe block,
    // the strategy has an adapter and a proposal is initialized.
    beforeEach(async () => {
      // Ensure adapter is present on the strategy instance for these specific tests
      await strategy.connect(owner).addAdapter(await mockAdapter1.getAddress());
      // Initialize the proposal fresh for each isPassed test
      await strategy.connect(azoriusMock).initializeProposal(PROPOSAL_ID, [], ethers.ZeroHash);
    });

    it('should revert with ProposalNotInitialized if proposal was not initialized', async () => {
      const uninitializedProposalId = 999;
      await expect(strategy.isPassed(uninitializedProposalId)).to.be.revertedWithCustomError(
        strategy,
        'ProposalNotInitialized',
      );
    });
  });

  describe('ERC165 Supports Interface', () => {
    let iStrategyBaseV1InterfaceId: string;
    let iStrategyV1InterfaceId: string;
    let iERC165InterfaceId: string;

    beforeEach(async () => {
      const IStrategyBaseV1Interface = IStrategyBaseV1__factory.createInterface();
      iStrategyBaseV1InterfaceId = calculateInterfaceId(IStrategyBaseV1Interface);

      const IStrategyV1Interface = IStrategyV1__factory.createInterface();
      iStrategyV1InterfaceId = calculateInterfaceId(IStrategyV1Interface, [
        IStrategyBaseV1Interface,
      ]);

      const IERC165Interface = IERC165__factory.createInterface();
      iERC165InterfaceId = calculateInterfaceId(IERC165Interface);
    });

    it('Should support IStrategyBaseV1 interface', async () => {
      void expect(await strategy.supportsInterface(iStrategyBaseV1InterfaceId)).to.be.true;
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
        const newQuorumThreshold = 50n;
        await expect(strategy.connect(owner).updateQuorumThreshold(newQuorumThreshold))
          .to.emit(strategy, 'StrategyParametersUpdated')
          .withArgs(DEFAULT_VOTING_PERIOD, newQuorumThreshold, DEFAULT_BASIS_NUMERATOR);
        expect(await strategy.quorumThreshold()).to.equal(newQuorumThreshold);
      });

      it('should allow owner to set quorum threshold to zero', async () => {
        const newQuorumThreshold = 0n;
        await expect(strategy.connect(owner).updateQuorumThreshold(newQuorumThreshold))
          .to.emit(strategy, 'StrategyParametersUpdated')
          .withArgs(DEFAULT_VOTING_PERIOD, newQuorumThreshold, DEFAULT_BASIS_NUMERATOR);
        expect(await strategy.quorumThreshold()).to.equal(newQuorumThreshold);
      });

      it('should revert if non-owner tries to update quorum threshold', async () => {
        const newQuorumThreshold = 50n;
        await expect(
          strategy.connect(nonOwner).updateQuorumThreshold(newQuorumThreshold),
        ).to.be.revertedWithCustomError(strategy, 'OwnableUnauthorizedAccount');
      });
    });

    describe('updateBasisNumerator', () => {
      it('should allow owner to update basis numerator and emit StrategyParametersUpdated event', async () => {
        const newBasisNumerator = 600_000n;
        await expect(strategy.connect(owner).updateBasisNumerator(newBasisNumerator))
          .to.emit(strategy, 'StrategyParametersUpdated')
          .withArgs(DEFAULT_VOTING_PERIOD, DEFAULT_QUORUM_THRESHOLD, newBasisNumerator);
        expect(await strategy.basisNumerator()).to.equal(newBasisNumerator);
      });

      it('should revert if non-owner tries to update basis numerator', async () => {
        const newBasisNumerator = 600_000n;
        await expect(
          strategy.connect(nonOwner).updateBasisNumerator(newBasisNumerator),
        ).to.be.revertedWithCustomError(strategy, 'OwnableUnauthorizedAccount');
      });

      it('should revert if basis numerator is too high (> 1,000,000)', async () => {
        const invalidBasisNumerator = 1_000_001n;
        await expect(
          strategy.connect(owner).updateBasisNumerator(invalidBasisNumerator),
        ).to.be.revertedWithCustomError(strategy, 'InvalidBasisNumerator');
      });

      it('should revert if basis numerator is too low (< 500,000)', async () => {
        const invalidBasisNumerator = 499_999n;
        await expect(
          strategy.connect(owner).updateBasisNumerator(invalidBasisNumerator),
        ).to.be.revertedWithCustomError(strategy, 'InvalidBasisNumerator');
      });

      it('should allow setting basis numerator to 50% (500,000) and emit StrategyParametersUpdated', async () => {
        const newBasisNumerator = 500_000n;
        await expect(strategy.connect(owner).updateBasisNumerator(newBasisNumerator))
          .to.emit(strategy, 'StrategyParametersUpdated')
          .withArgs(DEFAULT_VOTING_PERIOD, DEFAULT_QUORUM_THRESHOLD, newBasisNumerator);
        expect(await strategy.basisNumerator()).to.equal(newBasisNumerator);
      });

      it('should revert when updating basis numerator to 100% (1,000,000)', async () => {
        const newBasisNumerator = 1_000_000n;
        await expect(
          strategy.connect(owner).updateBasisNumerator(newBasisNumerator),
        ).to.be.revertedWithCustomError(strategy, 'InvalidBasisNumerator');
      });

      it('should allow setting basis numerator to new maximum (BASIS_DENOMINATOR - 1) and emit event', async () => {
        const newMaxBasis = 1_000_000n - 1n;
        await expect(strategy.connect(owner).updateBasisNumerator(newMaxBasis))
          .to.emit(strategy, 'StrategyParametersUpdated')
          .withArgs(DEFAULT_VOTING_PERIOD, DEFAULT_QUORUM_THRESHOLD, newMaxBasis);
        expect(await strategy.basisNumerator()).to.equal(newMaxBasis);
      });
    });
  });

  describe('Version', () => {
    it('should return the correct version', async () => {
      void expect(await strategy.getVersion()).to.equal(1);
    });
  });
});
