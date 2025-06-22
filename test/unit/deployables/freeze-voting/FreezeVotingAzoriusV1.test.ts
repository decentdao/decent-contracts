import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  FreezeVotingAzoriusV1,
  FreezeVotingAzoriusV1__factory,
  IDeploymentBlock__factory,
  IERC165__factory,
  IFreezeVotingAzoriusV1,
  IFreezeVotingAzoriusV1__factory,
  IFreezeVotingBase__factory,
  ILightAccountValidator__factory,
  IVersion__factory,
  MockLightAccountFactory,
  MockLightAccountFactory__factory,
  MockModuleAzoriusV1,
  MockModuleAzoriusV1__factory,
  MockVotingAdapter,
  MockVotingAdapter__factory,
  MockVotingStrategy,
  MockVotingStrategy__factory,
} from '../../../../typechain-types';
import { runDeploymentBlockTests } from '../../shared/deploymentBlockTests';
import { runSupportsInterfaceTests } from '../../shared/supportsInterfaceTests';

async function deployAzoriusFreezeVotingProxy(
  proxyDeployer: SignerWithAddress,
  implementationAddress: string,
  owner: string,
  freezeVotesThreshold: bigint,
  freezeProposalPeriod: number,
  freezePeriod: number,
  parentAzoriusAddress: string,
  lightAccountFactoryAddress: string,
): Promise<FreezeVotingAzoriusV1> {
  const initData = FreezeVotingAzoriusV1__factory.createInterface().encodeFunctionData(
    'initialize',
    [
      owner,
      freezeVotesThreshold,
      freezeProposalPeriod,
      freezePeriod,
      parentAzoriusAddress,
      lightAccountFactoryAddress,
    ],
  );
  const proxy = await new ERC1967Proxy__factory(proxyDeployer).deploy(
    implementationAddress,
    initData,
  );
  await proxy.waitForDeployment();
  return FreezeVotingAzoriusV1__factory.connect(await proxy.getAddress(), proxyDeployer);
}

describe('FreezeVotingAzoriusV1', () => {
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let voter1: SignerWithAddress;
  let voter2: SignerWithAddress;

  let azoriusFreezeVoting: FreezeVotingAzoriusV1;
  let mockParentAzorius: MockModuleAzoriusV1;
  let mockStrategy: MockVotingStrategy;
  let mockAdapter1: MockVotingAdapter;
  let mockLightAccountFactory: MockLightAccountFactory;
  let azoriusFreezeVotingImplementationAddress: string;

  const DEFAULT_FREEZE_VOTES_THRESHOLD = 100n;
  const DEFAULT_FREEZE_PROPOSAL_PERIOD = 60 * 60 * 24; // 1 day
  const DEFAULT_FREEZE_PERIOD = 60 * 60 * 24 * 7; // 7 days

  async function fixture() {
    const [d, o, paa, v1, v2] = await ethers.getSigners();

    const implFactory = new FreezeVotingAzoriusV1__factory(d);
    const impl = await implFactory.deploy();
    await impl.waitForDeployment();
    const implAddr = await impl.getAddress();

    const mockAzoriusFactory = new MockModuleAzoriusV1__factory(d);
    const mAzorius = await mockAzoriusFactory.deploy();
    await mAzorius.waitForDeployment();

    const mockStrategyFactory = new MockVotingStrategy__factory(d);
    const mStrategy = await mockStrategyFactory.deploy(paa.address); // Paa as mock strategy owner/proposerInitializer
    await mStrategy.waitForDeployment();
    await mAzorius.connect(d).updateStrategy(await mStrategy.getAddress()); // Configure mock Azorius with mock Strategy

    const mockAdapterFactory = new MockVotingAdapter__factory(d);
    const mAdapter1 = await mockAdapterFactory.deploy();
    await mAdapter1.waitForDeployment();
    const mAdapter2 = await mockAdapterFactory.deploy();
    await mAdapter2.waitForDeployment();

    // Register mock adapters with mock strategy
    await mStrategy.connect(paa).setVotingAdapter(await mAdapter1.getAddress(), true);
    await mStrategy.connect(paa).setVotingAdapter(await mAdapter2.getAddress(), true);

    const lightAccountFactory = await new MockLightAccountFactory__factory(d).deploy();
    await lightAccountFactory.waitForDeployment();

    return {
      deployer: d,
      owner: o,
      voter1: v1,
      voter2: v2,
      azoriusFreezeVotingImplementationAddress: implAddr,
      mockParentAzorius: mAzorius,
      mockStrategy: mStrategy,
      mockAdapter1: mAdapter1,
      mockLightAccountFactory: lightAccountFactory,
    };
  }

  beforeEach(async () => {
    const f = await loadFixture(fixture);
    deployer = f.deployer;
    owner = f.owner;
    voter1 = f.voter1;
    voter2 = f.voter2;
    azoriusFreezeVotingImplementationAddress = f.azoriusFreezeVotingImplementationAddress;
    mockParentAzorius = f.mockParentAzorius;
    mockStrategy = f.mockStrategy;
    mockAdapter1 = f.mockAdapter1;
    mockLightAccountFactory = f.mockLightAccountFactory;

    azoriusFreezeVoting = await deployAzoriusFreezeVotingProxy(
      deployer,
      azoriusFreezeVotingImplementationAddress,
      owner.address,
      DEFAULT_FREEZE_VOTES_THRESHOLD,
      DEFAULT_FREEZE_PROPOSAL_PERIOD,
      DEFAULT_FREEZE_PERIOD,
      await mockParentAzorius.getAddress(),
      mockLightAccountFactory.target as string,
    );
  });

  describe('Initialization', () => {
    it('should initialize with correct parameters', async () => {
      expect(await azoriusFreezeVoting.owner()).to.equal(owner.address);
      expect(await azoriusFreezeVoting.freezeVotesThreshold()).to.equal(
        DEFAULT_FREEZE_VOTES_THRESHOLD,
      );
      expect(await azoriusFreezeVoting.freezeProposalPeriod()).to.equal(
        DEFAULT_FREEZE_PROPOSAL_PERIOD,
      );
      expect(await azoriusFreezeVoting.freezePeriod()).to.equal(DEFAULT_FREEZE_PERIOD);
      expect(await azoriusFreezeVoting.parentAzorius()).to.equal(
        await mockParentAzorius.getAddress(),
      );
      expect(await azoriusFreezeVoting.lightAccountFactory()).to.equal(
        mockLightAccountFactory.target as string,
      );
    });

    it('should not allow reinitialization', async () => {
      await expect(
        azoriusFreezeVoting.initialize(
          owner.address,
          DEFAULT_FREEZE_VOTES_THRESHOLD,
          DEFAULT_FREEZE_PROPOSAL_PERIOD,
          DEFAULT_FREEZE_PERIOD,
          await mockParentAzorius.getAddress(),
          mockLightAccountFactory.target as string,
        ),
      ).to.be.revertedWithCustomError(azoriusFreezeVoting, 'InvalidInitialization');
    });

    it('implementation contract should have initializers disabled', async () => {
      const newImpl = FreezeVotingAzoriusV1__factory.connect(
        azoriusFreezeVotingImplementationAddress,
        deployer,
      );
      await expect(
        newImpl.initialize(
          owner.address,
          DEFAULT_FREEZE_VOTES_THRESHOLD,
          DEFAULT_FREEZE_PROPOSAL_PERIOD,
          DEFAULT_FREEZE_PERIOD,
          await mockParentAzorius.getAddress(),
          mockLightAccountFactory.target as string,
        ),
      ).to.be.revertedWithCustomError(newImpl, 'InvalidInitialization');
    });
  });

  describe('parentAzorius()', () => {
    it('should return the correct parent Azorius contract address', async () => {
      expect(await azoriusFreezeVoting.parentAzorius()).to.equal(
        await mockParentAzorius.getAddress(),
      );
    });
  });

  describe('castFreezeVote', () => {
    let votingAdapterData: IFreezeVotingAzoriusV1.VotingAdapterVoteDataStruct[];
    const voteWeightFromAdapter = 50n;

    beforeEach(async () => {
      // Configure mock adapter
      await mockAdapter1.setWeightToReturnOnRecord(voteWeightFromAdapter);
      await mockAdapter1.resetRecordVoteCall(); // Ensure clean state for call recording

      // Ensure the AzoriusFreezeVoting contract is authorized by the strategy (if it were a real strategy with the modifier)
      // For MockVotingStrategy, we added addAuthorizedFreezeVoter - this is for testing the modifier on real adapters.
      // Our MockFreezeVoteContributorAdapter doesn't use the modifier internally, but AzoriusFreezeVotingV1 calls it.
      // No direct authorization needed on MockFreezeVoteContributorAdapter itself for this test flow to work.

      const adapterVoteBytes = ethers.AbiCoder.defaultAbiCoder().encode(
        ['string'],
        ['mockVoteData'],
      );
      votingAdapterData = [
        {
          votingAdapter: await mockAdapter1.getAddress(),
          adapterVoteData: adapterVoteBytes,
        },
      ];
    });

    it('should initiate a new freeze proposal period if none active and record a vote', async () => {
      const initialFreezeProposalCreated = await azoriusFreezeVoting.freezeProposalCreated();
      expect(initialFreezeProposalCreated).to.equal(0); // Should be 0 before first vote

      const txPromise = azoriusFreezeVoting.connect(voter1).castFreezeVote(votingAdapterData, 0n);

      const blockNumBefore = await ethers.provider.getBlockNumber();
      await (await txPromise).wait();
      const blockAfter = await ethers.provider.getBlock(blockNumBefore + 1);
      const txTimestamp = BigInt(blockAfter!.timestamp);

      await expect(txPromise)
        .to.emit(azoriusFreezeVoting, 'FreezeProposalCreated')
        .withArgs(voter1.address, await mockStrategy.getAddress());

      await expect(txPromise)
        .to.emit(azoriusFreezeVoting, 'FreezeVoteCast')
        .withArgs(voter1.address, voteWeightFromAdapter);

      expect(await azoriusFreezeVoting.freezeProposalCreated()).to.equal(txTimestamp);
      expect(await azoriusFreezeVoting.freezeProposalVoteCount()).to.equal(voteWeightFromAdapter);
      expect(await azoriusFreezeVoting.freezeProposalStrategy()).to.equal(
        await mockStrategy.getAddress(),
      );

      // Verify adapter was called correctly
      expect(await mockAdapter1.recordVoteCalled()).to.be.true;
      expect(await mockAdapter1.lastVoterForRecord()).to.equal(voter1.address);
      expect(await mockAdapter1.lastSnapshotAndIdForRecord()).to.equal(txTimestamp);
      expect(await mockAdapter1.lastAdapterDataForRecord()).to.equal(
        votingAdapterData[0].adapterVoteData,
      );
    });

    it('should use an existing active freeze proposal period', async () => {
      // First vote to establish a period
      await azoriusFreezeVoting.connect(voter1).castFreezeVote(votingAdapterData, 0n);
      const firstProposalCreatedTimestamp = await azoriusFreezeVoting.freezeProposalCreated();
      const firstVoteCount = await azoriusFreezeVoting.freezeProposalVoteCount();

      // Ensure some time passes but not enough to expire the proposal period
      await time.increase(DEFAULT_FREEZE_PROPOSAL_PERIOD / 2);
      await mockAdapter1.resetRecordVoteCall(); // Reset for second call check
      const newVoteWeight = 30n;
      await mockAdapter1.setWeightToReturnOnRecord(newVoteWeight);

      const txPromise = azoriusFreezeVoting.connect(voter2).castFreezeVote(votingAdapterData, 0n); // voter2 casts a vote

      // Should NOT emit FreezeProposalCreated again
      await expect(txPromise).to.not.emit(azoriusFreezeVoting, 'FreezeProposalCreated');
      await expect(txPromise)
        .to.emit(azoriusFreezeVoting, 'FreezeVoteCast')
        .withArgs(voter2.address, newVoteWeight);

      expect(await azoriusFreezeVoting.freezeProposalCreated()).to.equal(
        firstProposalCreatedTimestamp,
      );
      expect(await azoriusFreezeVoting.freezeProposalVoteCount()).to.equal(
        firstVoteCount + newVoteWeight,
      );
      expect(await mockAdapter1.lastVoterForRecord()).to.equal(voter2.address);
      expect(await mockAdapter1.lastSnapshotAndIdForRecord()).to.equal(
        firstProposalCreatedTimestamp,
      );
    });

    it('should start a new proposal period if current one has expired', async () => {
      // First vote
      await azoriusFreezeVoting.connect(voter1).castFreezeVote(votingAdapterData, 0n);
      const firstProposalCreatedTimestamp = await azoriusFreezeVoting.freezeProposalCreated();

      // Expire the proposal period
      await time.increase(DEFAULT_FREEZE_PROPOSAL_PERIOD + 1);
      await mockAdapter1.resetRecordVoteCall();
      const newVoteWeight = 70n;
      await mockAdapter1.setWeightToReturnOnRecord(newVoteWeight);

      const txPromise = azoriusFreezeVoting.connect(voter2).castFreezeVote(votingAdapterData, 0n);

      const blockNumBefore = await ethers.provider.getBlockNumber();
      await (await txPromise).wait();
      const blockAfter = await ethers.provider.getBlock(blockNumBefore + 1);
      const newTxTimestamp = BigInt(blockAfter!.timestamp);

      await expect(txPromise)
        .to.emit(azoriusFreezeVoting, 'FreezeProposalCreated')
        .withArgs(voter2.address, await mockStrategy.getAddress());
      await expect(txPromise)
        .to.emit(azoriusFreezeVoting, 'FreezeVoteCast')
        .withArgs(voter2.address, newVoteWeight);

      const newProposalCreatedTimestamp = await azoriusFreezeVoting.freezeProposalCreated();
      expect(newProposalCreatedTimestamp).to.not.equal(firstProposalCreatedTimestamp);
      expect(newProposalCreatedTimestamp).to.equal(newTxTimestamp);
      expect(await azoriusFreezeVoting.freezeProposalVoteCount()).to.equal(newVoteWeight);
    });

    // Add more tests for reverts and other conditions here
  });

  // Placeholder for isFrozen tests
  describe('isFrozen', () => {
    it('should correctly report freeze status', async () => {
      // Test will go here
    });
  });

  // Placeholder for unfreeze tests
  describe('unfreeze', () => {
    it('should allow owner to unfreeze', async () => {
      // Test will go here
    });
  });

  describe('Version', () => {
    it('should return the correct version', async () => {
      expect(await azoriusFreezeVoting.version()).to.equal(1);
    });
  });

  describe('ERC165 supportsInterface', () => {
    runSupportsInterfaceTests({
      getContract: () => azoriusFreezeVoting,
      supportedInterfaceFactories: [
        {
          factory: IFreezeVotingAzoriusV1__factory,
          inheritedFactories: [IFreezeVotingBase__factory],
        },
        IFreezeVotingBase__factory,
        IVersion__factory,
        IERC165__factory,
        ILightAccountValidator__factory,
        IDeploymentBlock__factory,
      ],
    });
  });

  describe('Deployment Block', () => {
    runDeploymentBlockTests({
      getContract: () => azoriusFreezeVoting,
    });
  });
});
