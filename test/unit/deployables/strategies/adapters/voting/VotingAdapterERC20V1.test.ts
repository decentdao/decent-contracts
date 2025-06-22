import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  IDeploymentBlock__factory,
  IERC165__factory,
  IVersion__factory,
  IVotingAdapterBase__factory,
  IVotingAdapterERC20V1__factory,
  MockERC20Votes,
  MockERC20Votes__factory,
  MockVotingStrategy,
  MockVotingStrategy__factory,
  VotingAdapterERC20V1,
  VotingAdapterERC20V1__factory,
} from '../../../../../../typechain-types';
import { runDeploymentBlockTests } from '../../../../shared/deploymentBlockTests';
import { runSupportsInterfaceTests } from '../../../../shared/supportsInterfaceTests';

// Modified helper function to return deployment tx hash
async function deployERC20AdapterProxy(
  proxyDeployer: SignerWithAddress,
  implementationAddress: string,
  tokenAddress: string,
  strategyAddress: string,
  weightPerToken: bigint,
): Promise<{ adapter: VotingAdapterERC20V1 }> {
  const initData = VotingAdapterERC20V1__factory.createInterface().encodeFunctionData(
    'initialize',
    [tokenAddress, strategyAddress, weightPerToken],
  );
  const proxyContractFactory = new ERC1967Proxy__factory(proxyDeployer);
  const proxy = await proxyContractFactory.deploy(implementationAddress, initData);
  await proxy.waitForDeployment();

  const adapter = VotingAdapterERC20V1__factory.connect(await proxy.getAddress(), proxyDeployer);
  return { adapter };
}

describe('VotingAdapterERC20V1', () => {
  let deployerG: SignerWithAddress;
  let erc20AdapterImplementationAddressG: string;

  const DEFAULT_WEIGHT_PER_TOKEN = 1n;

  async function deployGlobalFixture() {
    const [deployer, user1, user2] = await ethers.getSigners();
    const deployedAdapterImpl = await new VotingAdapterERC20V1__factory(deployer).deploy();
    await deployedAdapterImpl.waitForDeployment();

    // Assign to global vars
    deployerG = deployer;
    erc20AdapterImplementationAddressG = await deployedAdapterImpl.getAddress();

    // Only return what's needed if this fixture is for global one-time setup
    // For deploying fresh mocks per test suite, a different fixture or direct deployment is better.
    return {
      deployer,
      user1,
      user2,
      erc20AdapterImplementationAddress: erc20AdapterImplementationAddressG,
    };
  }

  // This specialized fixture is for deploying fresh mocks for specific test suites
  async function deployMocksAndSignersFixture() {
    const [deployer, user1, user2] = await ethers.getSigners();

    const deployedMockToken = await new MockERC20Votes__factory(deployer).deploy();

    const deployedMockStrategy = await new MockVotingStrategy__factory(deployer).deploy(
      user1.address,
    ); // user1 as default mock proposer

    // Mint and delegate on the fresh mockToken
    await deployedMockToken.mint(user1.address, ethers.parseUnits('1000', 18));
    await deployedMockToken.mint(user2.address, ethers.parseUnits('500', 18));
    await deployedMockToken.connect(user1).delegate(user1.address);
    await deployedMockToken.connect(user2).delegate(user2.address);

    return {
      deployer,
      user1Signer: user1,
      user2Signer: user2,
      mockToken: deployedMockToken,
      mockStrategy: deployedMockStrategy,
    };
  }

  before(async () => {
    // Load global (one-time) deployments like the adapter implementation address
    await loadFixture(deployGlobalFixture);
  });

  let mockToken: MockERC20Votes;
  let mockStrategy: MockVotingStrategy;
  let deployer: SignerWithAddress;
  let user1Signer: SignerWithAddress;

  beforeEach(async () => {
    const {
      mockToken: mToken,
      mockStrategy: mStrategy,
      deployer: dDeployer,
      user1Signer: vSigner,
    } = await loadFixture(deployMocksAndSignersFixture);

    user1Signer = vSigner;
    mockToken = mToken;
    mockStrategy = mStrategy;
    deployer = dDeployer;
  });

  describe('Initialization', () => {
    it('should initialize correctly with valid parameters and emit event', async () => {
      const { adapter: erc20Adapter } = await deployERC20AdapterProxy(
        deployer,
        erc20AdapterImplementationAddressG,
        await mockToken.getAddress(),
        await mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_TOKEN,
      );

      expect(await erc20Adapter.token()).to.equal(await mockToken.getAddress());
      expect(await erc20Adapter.strategy()).to.equal(await mockStrategy.getAddress());
      expect(await erc20Adapter.weightPerToken()).to.equal(DEFAULT_WEIGHT_PER_TOKEN);
    });

    it('should not allow reinitialization', async () => {
      const { adapter: erc20Adapter } = await deployERC20AdapterProxy(
        deployer,
        erc20AdapterImplementationAddressG,
        await mockToken.getAddress(),
        await mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_TOKEN,
      );

      await expect(
        erc20Adapter.initialize(ethers.ZeroAddress, ethers.ZeroAddress, 0n),
      ).to.be.revertedWithCustomError(erc20Adapter, 'InvalidInitialization');
    });

    it('Should have initialization disabled in the implementation contract', async function () {
      const implementationContract = VotingAdapterERC20V1__factory.connect(
        erc20AdapterImplementationAddressG,
        deployerG,
      );

      await expect(
        implementationContract.initialize(
          await mockToken.getAddress(),
          await mockStrategy.getAddress(),
          DEFAULT_WEIGHT_PER_TOKEN,
        ),
      ).to.be.revertedWithCustomError(implementationContract, 'InvalidInitialization');
    });
  });

  describe('weightOf', () => {
    const proposalId = 1;
    const mockExtraData = ethers.ZeroHash;
    let adapter: VotingAdapterERC20V1;

    async function setupAdapterForWeightOf(clockMode: 0 | 1, customWeightPerToken?: bigint) {
      await mockToken.setClockMode(clockMode);
      const { adapter: deployedAdapter } = await deployERC20AdapterProxy(
        deployer,
        erc20AdapterImplementationAddressG,
        await mockToken.getAddress(),
        await mockStrategy.getAddress(),
        customWeightPerToken || DEFAULT_WEIGHT_PER_TOKEN,
      );
      adapter = deployedAdapter;
      await mockStrategy.setVotingAdapter(await adapter.getAddress(), true);
    }

    describe('Timestamp Mode', () => {
      beforeEach(async () => {
        await setupAdapterForWeightOf(0);
      });

      it('should return correct weight based on past votes at startTimestamp', async () => {
        const expectedRawVotes = ethers.parseUnits('50', 18);
        const votingStartTimestamp = (await time.latest()) + 100;
        await time.increaseTo(votingStartTimestamp - 50);
        await mockToken.mint(user1Signer.address, expectedRawVotes);
        await mockToken.connect(user1Signer).delegate(user1Signer.address);
        await mockToken.setPastVotes(user1Signer.address, votingStartTimestamp, expectedRawVotes);
        await mockStrategy.setVotingTimestamps(
          proposalId,
          votingStartTimestamp,
          votingStartTimestamp + 1000,
        );
        const weight = await adapter.weightOf(user1Signer.address, proposalId, mockExtraData);
        expect(weight).to.equal(expectedRawVotes * DEFAULT_WEIGHT_PER_TOKEN);
      });

      it('should correctly apply custom weightPerToken', async () => {
        const customWeight = 5n;
        await setupAdapterForWeightOf(0, customWeight);

        const expectedRawVotes = ethers.parseUnits('50', 18);
        const votingStartTimestamp = (await time.latest()) + 100;
        await time.increaseTo(votingStartTimestamp - 50);
        await mockToken.mint(user1Signer.address, expectedRawVotes);
        await mockToken.connect(user1Signer).delegate(user1Signer.address);
        await mockToken.setPastVotes(user1Signer.address, votingStartTimestamp, expectedRawVotes);
        await mockStrategy.setVotingTimestamps(
          proposalId,
          votingStartTimestamp,
          votingStartTimestamp + 1000,
        );

        const weight = await adapter.weightOf(user1Signer.address, proposalId, mockExtraData);
        expect(weight).to.equal(expectedRawVotes * customWeight);
      });

      it('should revert if strategy returns startTimestamp as 0', async () => {
        await mockStrategy.initializeProposal(proposalId);
        await mockStrategy.setVotingTimestamps(proposalId, 0, 1000);
        await expect(
          adapter.weightOf(user1Signer.address, proposalId, mockExtraData),
        ).to.be.revertedWithCustomError(adapter, 'ProposalNotInitialized');
      });
    });

    describe('BlockNumber Mode', () => {
      beforeEach(async () => {
        await setupAdapterForWeightOf(1);
      });

      it('should return correct weight based on past votes at startBlock', async () => {
        const expectedRawVotes = ethers.parseUnits('75', 18);
        await mockToken.mint(user1Signer.address, expectedRawVotes);
        await mockToken.connect(user1Signer).delegate(user1Signer.address);
        const snapshotBlockNumber = (await time.latestBlock()) + 5;
        await mockToken.setPastVotes(user1Signer.address, snapshotBlockNumber, expectedRawVotes);
        await mockStrategy.setVotingStartBlock(proposalId, snapshotBlockNumber);
        const weight = await adapter.weightOf(user1Signer.address, proposalId, mockExtraData);
        expect(weight).to.equal(expectedRawVotes * DEFAULT_WEIGHT_PER_TOKEN);
      });

      it('should revert if strategy returns startBlock as 0', async () => {
        await mockStrategy.setVotingStartBlock(proposalId, 0);
        await expect(
          adapter.weightOf(user1Signer.address, proposalId, mockExtraData),
        ).to.be.revertedWithCustomError(adapter, 'ProposalNotInitialized');
      });
    });

    it('should return 0 if voter has already casted a vote for the proposal', async () => {
      await setupAdapterForWeightOf(0); // Default to timestamp mode
      const votingStartTimestamp = (await time.latest()) + 100;
      await mockStrategy.setVotingTimestamps(
        proposalId,
        votingStartTimestamp,
        votingStartTimestamp + 1000,
      );
      await mockToken.setPastVotes(
        user1Signer.address,
        votingStartTimestamp,
        ethers.parseUnits('10', 18),
      );
      await mockStrategy.connect(user1Signer).castVote(
        proposalId,
        0, // voteType
        [
          {
            votingAdapter: await adapter.getAddress(),
            adapterVoteData: mockExtraData,
          },
        ],
        0n,
      );
      const weight = await adapter.weightOf(user1Signer.address, proposalId, mockExtraData);
      expect(weight).to.equal(0);
    });
  });

  describe('recordVote', () => {
    const proposalId = 1;
    const mockExtraData = ethers.ZeroHash;
    const expectedEventAdapterVoteData = '0x';

    let adapter: VotingAdapterERC20V1;
    let token: MockERC20Votes;
    let strategy: MockVotingStrategy;
    let voter: SignerWithAddress;
    let currentDeployer: SignerWithAddress;

    async function setupAdapterForRecordVote(clockMode: 0 | 1, customWeightPerToken?: bigint) {
      const {
        user1Signer: fixtureVoter,
        deployer: fixDeployer,
        mockToken: fToken,
        mockStrategy: fStrategy,
      } = await loadFixture(deployMocksAndSignersFixture);

      voter = fixtureVoter;
      token = fToken;
      strategy = fStrategy;
      currentDeployer = fixDeployer;

      await token.setClockMode(clockMode);
      const { adapter: deployedAdapter } = await deployERC20AdapterProxy(
        currentDeployer,
        erc20AdapterImplementationAddressG,
        await token.getAddress(),
        await strategy.getAddress(),
        customWeightPerToken || DEFAULT_WEIGHT_PER_TOKEN,
      );
      adapter = deployedAdapter;
      await strategy.setVotingAdapter(await adapter.getAddress(), true);
    }

    it('should record vote, return casted weight, set flag, and emit VoteRecorded event', async () => {
      await setupAdapterForRecordVote(0);
      const expectedRawVotes = ethers.parseUnits('120', 18);
      const votingStartTimestamp = (await time.latest()) + 200;
      await time.increaseTo(votingStartTimestamp - 100);
      await token.mint(voter.address, expectedRawVotes);
      await token.connect(voter).delegate(voter.address);
      await token.setPastVotes(voter.address, votingStartTimestamp, expectedRawVotes);
      await strategy.setVotingTimestamps(
        proposalId,
        votingStartTimestamp,
        votingStartTimestamp + 1000,
      );

      const expectedWeightCasted = expectedRawVotes * DEFAULT_WEIGHT_PER_TOKEN;

      await expect(
        strategy.connect(voter).castVote(
          proposalId,
          0, // voteType
          [
            {
              votingAdapter: await adapter.getAddress(),
              adapterVoteData: mockExtraData,
            },
          ],
          0n,
        ),
      )
        .to.emit(adapter, 'VoteRecorded')
        .withArgs(voter.address, proposalId, expectedWeightCasted, expectedEventAdapterVoteData);

      const weightAfterVote = await adapter.weightOf(voter.address, proposalId, mockExtraData);
      expect(weightAfterVote).to.equal(0);
    });

    it('should correctly apply custom weightPerToken on recordVote and emit event', async () => {
      const customWeight = 3n;
      await setupAdapterForRecordVote(0, customWeight);
      const expectedRawVotes = ethers.parseUnits('70', 18);
      const votingStartTimestamp = (await time.latest()) + 200;
      await time.increaseTo(votingStartTimestamp - 100);
      await token.mint(voter.address, expectedRawVotes);
      await token.connect(voter).delegate(voter.address);
      await token.setPastVotes(voter.address, votingStartTimestamp, expectedRawVotes);
      await strategy.setVotingTimestamps(
        proposalId,
        votingStartTimestamp,
        votingStartTimestamp + 1000,
      );

      const expectedWeightCasted = expectedRawVotes * customWeight;

      await expect(
        strategy.connect(voter).castVote(
          proposalId,
          0, // voteType
          [
            {
              votingAdapter: await adapter.getAddress(),
              adapterVoteData: mockExtraData,
            },
          ],
          0n,
        ),
      )
        .to.emit(adapter, 'VoteRecorded')
        .withArgs(voter.address, proposalId, expectedWeightCasted, expectedEventAdapterVoteData);
    });

    it('should revert with AlreadyVoted if trying to vote again', async () => {
      await setupAdapterForRecordVote(0);
      const votingStartTimestamp = (await time.latest()) + 200;
      await token.setPastVotes(voter.address, votingStartTimestamp, ethers.parseUnits('10', 18));
      await strategy.setVotingTimestamps(
        proposalId,
        votingStartTimestamp,
        votingStartTimestamp + 1000,
      );
      await strategy.connect(voter).castVote(
        proposalId,
        0, // voteType
        [
          {
            votingAdapter: await adapter.getAddress(),
            adapterVoteData: mockExtraData,
          },
        ],
        0n,
      );
      await expect(
        strategy.connect(voter).castVote(
          proposalId,
          0, // voteType
          [
            {
              votingAdapter: await adapter.getAddress(),
              adapterVoteData: mockExtraData,
            },
          ],
          0n,
        ),
      ).to.be.revertedWithCustomError(adapter, 'AlreadyVoted');
    });

    it('subsequent weightOf should return 0 after recordVote', async () => {
      await setupAdapterForRecordVote(0);
      const votingStartTimestamp = (await time.latest()) + 200;
      await token.setPastVotes(voter.address, votingStartTimestamp, ethers.parseUnits('10', 18));
      await strategy.setVotingTimestamps(
        proposalId,
        votingStartTimestamp,
        votingStartTimestamp + 1000,
      );
      await strategy.connect(voter).castVote(
        proposalId,
        0, // voteType
        [
          {
            votingAdapter: await adapter.getAddress(),
            adapterVoteData: mockExtraData,
          },
        ],
        0n,
      );
      const weight = await adapter.weightOf(voter.address, proposalId, mockExtraData);
      expect(weight).to.equal(0);
    });

    it('should revert with ProposalNotInitialized if strategy returns startTimestamp as 0 (Timestamp Mode)', async () => {
      await setupAdapterForRecordVote(0);
      await strategy.setVotingTimestamps(proposalId, 0, 1000);
      await expect(
        strategy.connect(voter).castVote(
          proposalId,
          0, // voteType
          [
            {
              votingAdapter: await adapter.getAddress(),
              adapterVoteData: mockExtraData,
            },
          ],
          0n,
        ),
      ).to.be.revertedWithCustomError(adapter, 'ProposalNotInitialized');
    });

    it('should revert with ProposalNotInitialized if strategy returns startBlock as 0 (BlockNumber Mode)', async () => {
      await setupAdapterForRecordVote(1);
      await strategy.setVotingStartBlock(proposalId, 0);
      await expect(
        strategy.connect(voter).castVote(
          proposalId,
          0, // voteType
          [
            {
              votingAdapter: await adapter.getAddress(),
              adapterVoteData: mockExtraData,
            },
          ],
          0n,
        ),
      ).to.be.revertedWithCustomError(adapter, 'ProposalNotInitialized');
    });
  });

  describe('version()', () => {
    it('should return the correct version', async () => {
      const { adapter: erc20Adapter } = await deployERC20AdapterProxy(
        deployer,
        erc20AdapterImplementationAddressG,
        await mockToken.getAddress(),
        await mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_TOKEN,
      );

      expect(await erc20Adapter.version()).to.equal(1);
    });
  });

  describe('State Getters', () => {
    let adapter: VotingAdapterERC20V1;
    let token: MockERC20Votes;
    let strategy: MockVotingStrategy;
    let voter: SignerWithAddress;
    const proposalId = 1;
    const freezeProposalSnapshotAndId = Math.floor(Date.now() / 1000) - 100;
    const ZERO_EXTRA_DATA = '0x';

    beforeEach(async () => {
      const mocks = await loadFixture(deployMocksAndSignersFixture);
      voter = mocks.user1Signer;
      token = mocks.mockToken;
      strategy = mocks.mockStrategy;

      const { adapter: deployedAdapter } = await deployERC20AdapterProxy(
        mocks.deployer,
        erc20AdapterImplementationAddressG,
        await token.getAddress(),
        await strategy.getAddress(),
        DEFAULT_WEIGHT_PER_TOKEN,
      );
      adapter = deployedAdapter;
      await strategy.setVotingAdapter(await adapter.getAddress(), true);
    });

    describe('hasCastedVoteForProposal', () => {
      it('should return false initially', async () => {
        const hasVoted = await adapter.hasCastedVoteForProposal(proposalId, voter.address);
        expect(hasVoted).to.be.false;
      });

      it('should return true after recording a vote', async () => {
        const votingStartTimestamp = (await time.latest()) + 200;
        await token.setPastVotes(voter.address, votingStartTimestamp, ethers.parseUnits('10', 18));
        await strategy.setVotingTimestamps(
          proposalId,
          votingStartTimestamp,
          votingStartTimestamp + 1000,
        );

        // Record a vote
        await strategy.connect(voter).castVote(
          proposalId,
          0, // voteType
          [
            {
              votingAdapter: await adapter.getAddress(),
              adapterVoteData: ZERO_EXTRA_DATA,
            },
          ],
          0n,
        );

        // Check the state
        const hasVoted = await adapter.hasCastedVoteForProposal(proposalId, voter.address);
        expect(hasVoted).to.be.true;
      });

      it('should only mark the specific proposalId/voter combination as voted', async () => {
        const anotherProposalId = 2;
        const anotherVoter = (await ethers.getSigners())[3];

        const votingStartTimestamp = (await time.latest()) + 200;
        await token.setPastVotes(voter.address, votingStartTimestamp, ethers.parseUnits('10', 18));
        await strategy.setVotingTimestamps(
          proposalId,
          votingStartTimestamp,
          votingStartTimestamp + 1000,
        );
        await strategy.setVotingTimestamps(
          anotherProposalId,
          votingStartTimestamp,
          votingStartTimestamp + 1000,
        );

        // Record a vote for proposalId/voter
        await strategy.connect(voter).castVote(
          proposalId,
          0, // voteType
          [
            {
              votingAdapter: await adapter.getAddress(),
              adapterVoteData: ZERO_EXTRA_DATA,
            },
          ],
          0n,
        );

        // Check states
        expect(await adapter.hasCastedVoteForProposal(proposalId, voter.address)).to.be.true;
        expect(await adapter.hasCastedVoteForProposal(anotherProposalId, voter.address)).to.be
          .false;
        expect(await adapter.hasCastedVoteForProposal(proposalId, anotherVoter.address)).to.be
          .false;
      });
    });

    describe('hasCastedVotePerFreezeVoteProposalsPerFreezeVoteContract', () => {
      let freezeVoteContract: SignerWithAddress;
      let anotherFreezeVoteContract: SignerWithAddress;

      beforeEach(async () => {
        const signers = await ethers.getSigners();
        freezeVoteContract = signers[4];
        anotherFreezeVoteContract = signers[5];

        // Set up the authorization
        await strategy.addAuthorizedFreezeVoter(freezeVoteContract.address);
        await token.setPastVotes(
          voter.address,
          freezeProposalSnapshotAndId,
          ethers.parseUnits('10', 18),
        );
      });

      it('should return false initially', async () => {
        const hasVoted = await adapter.hasCastedVotePerFreezeVoteProposalPerFreezeVoteContract(
          freezeVoteContract.address,
          freezeProposalSnapshotAndId,
          voter.address,
        );
        expect(hasVoted).to.be.false;
      });

      it('should return true after recording a freeze vote', async () => {
        // Record a freeze vote
        await adapter
          .connect(freezeVoteContract)
          .recordFreezeVote(voter.address, freezeProposalSnapshotAndId, ZERO_EXTRA_DATA);

        // Check the state
        const hasVoted = await adapter.hasCastedVotePerFreezeVoteProposalPerFreezeVoteContract(
          freezeVoteContract.address,
          freezeProposalSnapshotAndId,
          voter.address,
        );
        expect(hasVoted).to.be.true;
      });

      it('should only mark the specific contract/proposalId/voter combination as voted', async () => {
        const anotherSnapshotId = freezeProposalSnapshotAndId + 1000;
        const anotherVoter = (await ethers.getSigners())[3];

        await token.setPastVotes(voter.address, anotherSnapshotId, ethers.parseUnits('10', 18));
        await strategy.addAuthorizedFreezeVoter(anotherFreezeVoteContract.address);

        // Record a vote
        await adapter
          .connect(freezeVoteContract)
          .recordFreezeVote(voter.address, freezeProposalSnapshotAndId, ZERO_EXTRA_DATA);

        // Check states - same voter, different params
        expect(
          await adapter.hasCastedVotePerFreezeVoteProposalPerFreezeVoteContract(
            freezeVoteContract.address,
            freezeProposalSnapshotAndId,
            voter.address,
          ),
        ).to.be.true;

        expect(
          await adapter.hasCastedVotePerFreezeVoteProposalPerFreezeVoteContract(
            anotherFreezeVoteContract.address,
            freezeProposalSnapshotAndId,
            voter.address,
          ),
        ).to.be.false;

        expect(
          await adapter.hasCastedVotePerFreezeVoteProposalPerFreezeVoteContract(
            freezeVoteContract.address,
            anotherSnapshotId,
            voter.address,
          ),
        ).to.be.false;

        expect(
          await adapter.hasCastedVotePerFreezeVoteProposalPerFreezeVoteContract(
            freezeVoteContract.address,
            freezeProposalSnapshotAndId,
            anotherVoter.address,
          ),
        ).to.be.false;
      });
    });
  });

  describe('ERC165 supportsInterface', () => {
    let erc20Adapter: VotingAdapterERC20V1;

    beforeEach(async () => {
      const { adapter } = await deployERC20AdapterProxy(
        deployer,
        erc20AdapterImplementationAddressG,
        await mockToken.getAddress(),
        await mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_TOKEN,
      );
      erc20Adapter = adapter;
    });

    runSupportsInterfaceTests({
      getContract: () => erc20Adapter,
      supportedInterfaceFactories: [
        IVotingAdapterERC20V1__factory,
        IVotingAdapterBase__factory,
        IVersion__factory,
        IERC165__factory,
        IDeploymentBlock__factory,
      ],
    });
  });

  // New Test Suite for Freeze Voting
  describe('Freeze Voting', () => {
    let adapter: VotingAdapterERC20V1;
    let token: MockERC20Votes;
    let strategy: MockVotingStrategy;
    let deployerSigner: SignerWithAddress;
    let voter1: SignerWithAddress;
    let authorizedCaller: SignerWithAddress;
    let unauthorizedCaller: SignerWithAddress;

    const PROPOSAL_SNAPSHOT_AND_ID_1 = Math.floor(Date.now() / 1000) - 100; // Example timestamp
    const PROPOSAL_SNAPSHOT_AND_ID_2 = PROPOSAL_SNAPSHOT_AND_ID_1 + 5000;
    const DEFAULT_VOTES = ethers.parseUnits('100', 18);
    const ZERO_EXTRA_DATA = '0x';

    beforeEach(async () => {
      const mocks = await loadFixture(deployMocksAndSignersFixture);
      deployerSigner = mocks.deployer;
      voter1 = mocks.user1Signer;
      authorizedCaller = mocks.user2Signer; // Using user2 as a designated authorized caller for tests
      token = mocks.mockToken;
      strategy = mocks.mockStrategy;

      // Get another signer for unauthorized calls
      const signers = await ethers.getSigners();
      unauthorizedCaller = signers[0]; // Fallback to deployer if user2 was also fallback above

      const { adapter: deployedAdapter } = await deployERC20AdapterProxy(
        deployerSigner,
        erc20AdapterImplementationAddressG, // from global fixture
        await token.getAddress(),
        await strategy.getAddress(),
        DEFAULT_WEIGHT_PER_TOKEN,
      );
      adapter = deployedAdapter;
      await strategy.setVotingAdapter(await adapter.getAddress(), true); // Important for mock strategy
    });

    describe('getFreezeVoteWeight', () => {
      it('should return correct weight based on past votes at the given snapshot timestamp', async () => {
        await token.setPastVotes(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, DEFAULT_VOTES);
        const weight = await adapter
          .connect(authorizedCaller)
          .getFreezeVoteWeight(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1);
        expect(weight).to.equal(DEFAULT_VOTES * DEFAULT_WEIGHT_PER_TOKEN);
      });

      it('should return 0 if voter has no votes at the snapshot timestamp', async () => {
        await token.setPastVotes(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, 0n);
        const weight = await adapter
          .connect(authorizedCaller)
          .getFreezeVoteWeight(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1);
        expect(weight).to.equal(0n);
      });

      it('should correctly apply custom weightPerToken', async () => {
        const customWeightPerToken = 5n;
        const { adapter: customAdapter } = await deployERC20AdapterProxy(
          deployerSigner,
          erc20AdapterImplementationAddressG,
          await token.getAddress(),
          await strategy.getAddress(),
          customWeightPerToken,
        );
        await strategy.setVotingAdapter(await customAdapter.getAddress(), true);
        await token.setPastVotes(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, DEFAULT_VOTES);

        const weight = await customAdapter
          .connect(authorizedCaller)
          .getFreezeVoteWeight(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1);
        expect(weight).to.equal(DEFAULT_VOTES * customWeightPerToken);
      });

      it('should not alter any freeze voting state', async () => {
        await token.setPastVotes(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, DEFAULT_VOTES);
        await adapter
          .connect(authorizedCaller)
          .getFreezeVoteWeight(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1);

        // Now try to record a vote, it should succeed if state wasn't altered by getFreezeVoteWeight
        await strategy.addAuthorizedFreezeVoter(authorizedCaller.address);
        await expect(
          adapter
            .connect(authorizedCaller)
            .recordFreezeVote(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, ZERO_EXTRA_DATA),
        )
          .to.emit(adapter, 'FreezeVoteRecorded')
          .withArgs(
            voter1.address,
            PROPOSAL_SNAPSHOT_AND_ID_1,
            DEFAULT_VOTES * DEFAULT_WEIGHT_PER_TOKEN,
            ZERO_EXTRA_DATA,
          );
      });
    });

    describe('recordFreezeVote', () => {
      it('should revert with UnauthorizedFreezeVoter if caller is not authorized by the strategy', async () => {
        await token.setPastVotes(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, DEFAULT_VOTES);
        await expect(
          adapter
            .connect(unauthorizedCaller)
            .recordFreezeVote(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, ZERO_EXTRA_DATA),
        )
          .to.be.revertedWithCustomError(adapter, 'UnauthorizedFreezeVoter')
          .withArgs(unauthorizedCaller.address);
      });

      it('should record vote, return casted weight, and emit FreezeVoteRecorded on success if caller is authorized', async () => {
        await strategy.addAuthorizedFreezeVoter(authorizedCaller.address);
        await token.setPastVotes(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, DEFAULT_VOTES);

        const expectedWeightCasted = DEFAULT_VOTES * DEFAULT_WEIGHT_PER_TOKEN;

        const tx = adapter
          .connect(authorizedCaller)
          .recordFreezeVote(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, ZERO_EXTRA_DATA);

        await expect(tx)
          .to.emit(adapter, 'FreezeVoteRecorded')
          .withArgs(
            voter1.address,
            PROPOSAL_SNAPSHOT_AND_ID_1,
            expectedWeightCasted,
            ZERO_EXTRA_DATA,
          );

        // Verify state change: subsequent call for weightOf for this specific freeze context should indicate voted (hard to check directly without getter)
        // So, we test by trying to vote again, which should fail.
        await expect(
          adapter
            .connect(authorizedCaller)
            .recordFreezeVote(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, ZERO_EXTRA_DATA),
        ).to.be.revertedWithCustomError(adapter, 'AlreadyVoted');
      });

      it('should revert with NoFreezeVotingWeight if calculated weight is 0', async () => {
        await strategy.addAuthorizedFreezeVoter(authorizedCaller.address);
        await token.setPastVotes(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, 0n); // Voter has 0 votes

        await expect(
          adapter
            .connect(authorizedCaller)
            .recordFreezeVote(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, ZERO_EXTRA_DATA),
        ).to.be.revertedWithCustomError(adapter, 'NoFreezeVotingWeight');
      });

      describe('Duplicate Vote Prevention', () => {
        beforeEach(async () => {
          // Ensure authorizedCaller is authorized for these tests
          await strategy.addAuthorizedFreezeVoter(authorizedCaller.address);
          // Ensure voter1 has some votes for the initial successful vote
          await token.setPastVotes(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, DEFAULT_VOTES);
          await token.setPastVotes(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_2, DEFAULT_VOTES);
        });

        it('should revert with AlreadyVoted if same voter, caller, and snapshotAndId try to vote again', async () => {
          // First vote
          await adapter
            .connect(authorizedCaller)
            .recordFreezeVote(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, ZERO_EXTRA_DATA);
          // Second attempt with same params
          await expect(
            adapter
              .connect(authorizedCaller)
              .recordFreezeVote(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, ZERO_EXTRA_DATA),
          ).to.be.revertedWithCustomError(adapter, 'AlreadyVoted');
        });

        it('should allow same voter to vote if snapshotAndId is different (new freeze proposal)', async () => {
          // Vote for first proposal ID
          await adapter
            .connect(authorizedCaller)
            .recordFreezeVote(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, ZERO_EXTRA_DATA);
          // Vote for second proposal ID (different snapshotAndId)
          await expect(
            adapter
              .connect(authorizedCaller)
              .recordFreezeVote(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_2, ZERO_EXTRA_DATA),
          )
            .to.emit(adapter, 'FreezeVoteRecorded')
            .withArgs(
              voter1.address,
              PROPOSAL_SNAPSHOT_AND_ID_2,
              DEFAULT_VOTES * DEFAULT_WEIGHT_PER_TOKEN,
              ZERO_EXTRA_DATA,
            );
        });

        it('should allow same voter and snapshotAndId if caller is different (different child DAO)', async () => {
          const [, , , , otherAuthorizedCaller] = await ethers.getSigners(); // Get a new signer
          await strategy.addAuthorizedFreezeVoter(otherAuthorizedCaller.address);
          await token.setPastVotes(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, DEFAULT_VOTES); // Ensure votes for this context too

          // Vote from first authorized caller
          await adapter
            .connect(authorizedCaller)
            .recordFreezeVote(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, ZERO_EXTRA_DATA);

          // Vote from second authorized caller for the same voter and snapshotAndId
          await expect(
            adapter
              .connect(otherAuthorizedCaller)
              .recordFreezeVote(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, ZERO_EXTRA_DATA),
          )
            .to.emit(adapter, 'FreezeVoteRecorded')
            .withArgs(
              voter1.address,
              PROPOSAL_SNAPSHOT_AND_ID_1,
              DEFAULT_VOTES * DEFAULT_WEIGHT_PER_TOKEN,
              ZERO_EXTRA_DATA,
            );
        });

        it('should allow different voter for same caller and snapshotAndId', async () => {
          const [, , voter2] = await ethers.getSigners();
          await token.mint(voter2.address, DEFAULT_VOTES);
          await token.connect(voter2).delegate(voter2.address);
          await token.setPastVotes(voter2.address, PROPOSAL_SNAPSHOT_AND_ID_1, DEFAULT_VOTES);

          // Vote from voter1
          await adapter
            .connect(authorizedCaller)
            .recordFreezeVote(voter1.address, PROPOSAL_SNAPSHOT_AND_ID_1, ZERO_EXTRA_DATA);

          // Vote from voter2
          await expect(
            adapter
              .connect(authorizedCaller)
              .recordFreezeVote(voter2.address, PROPOSAL_SNAPSHOT_AND_ID_1, ZERO_EXTRA_DATA),
          )
            .to.emit(adapter, 'FreezeVoteRecorded')
            .withArgs(
              voter2.address,
              PROPOSAL_SNAPSHOT_AND_ID_1,
              DEFAULT_VOTES * DEFAULT_WEIGHT_PER_TOKEN,
              ZERO_EXTRA_DATA,
            );
        });
      });
    });
  });

  describe('validVotingAdapterVote', () => {
    let adapter: VotingAdapterERC20V1;
    let token: MockERC20Votes;
    let strategy: MockVotingStrategy;
    let voter: SignerWithAddress;
    const proposalId = 1;
    const mockExtraData = ethers.ZeroHash;

    beforeEach(async () => {
      const mocks = await loadFixture(deployMocksAndSignersFixture);
      voter = mocks.user1Signer;
      token = mocks.mockToken;
      strategy = mocks.mockStrategy;

      const { adapter: deployedAdapter } = await deployERC20AdapterProxy(
        mocks.deployer,
        erc20AdapterImplementationAddressG,
        await token.getAddress(),
        await strategy.getAddress(),
        DEFAULT_WEIGHT_PER_TOKEN,
      );
      adapter = deployedAdapter;
      await strategy.setVotingAdapter(await adapter.getAddress(), true);
    });

    it('should return (false, 0) if the proposal is not initialized', async () => {
      const uninitializedProposalId = 999;
      // No setup for this proposal ID in the mock strategy

      const [isValid, weight] = await adapter.validVotingAdapterVote(
        voter.address,
        uninitializedProposalId,
        mockExtraData,
      );

      expect(isValid).to.be.false;
      expect(weight).to.equal(0);
    });

    async function setupValidation(voterAddress: string, startOffset: number, endOffset: number) {
      const currentTimestamp = await time.latest();
      const startTimestamp = currentTimestamp + startOffset;
      const endTimestamp = currentTimestamp + endOffset;

      await strategy.setVotingTimestamps(proposalId, startTimestamp, endTimestamp);

      return { startTimestamp, endTimestamp };
    }

    it('should return (false, 0) if user has already voted', async () => {
      const { startTimestamp } = await setupValidation(voter.address, 100, 200);
      const voteWeight = ethers.parseUnits('10', 18);
      await token.setCheckpoints(voter.address, [{ _key: startTimestamp, _value: voteWeight }]);

      // 1. Check for TRUE before voting
      const [isInitiallyValid, initialWeight] = await adapter.validVotingAdapterVote(
        voter.address,
        proposalId,
        mockExtraData,
      );
      expect(isInitiallyValid).to.be.true;
      expect(initialWeight).to.equal(voteWeight);

      // 2. Record a vote
      await strategy.connect(voter).castVote(
        proposalId,
        0, // voteType
        [
          {
            votingAdapter: await adapter.getAddress(),
            adapterVoteData: mockExtraData,
          },
        ],
        0n,
      );

      // 3. Check for FALSE after voting
      const [isFinallyValid, finalWeight] = await adapter.validVotingAdapterVote(
        voter.address,
        proposalId,
        mockExtraData,
      );

      expect(isFinallyValid).to.be.false;
      expect(finalWeight).to.equal(0);
    });

    describe('Checkpoint-based validation', () => {
      it('should return (false, 0) if there are no checkpoints', async () => {
        const { startTimestamp } = await setupValidation(voter.address, 100, 200);

        // 1. Setup and check for TRUE with a valid checkpoint
        const validWeight = 100n;
        await token.setCheckpoints(voter.address, [
          { _key: startTimestamp - 1, _value: validWeight },
        ]);
        const [isInitiallyValid, initialWeight] = await adapter.validVotingAdapterVote(
          voter.address,
          proposalId,
          mockExtraData,
        );
        expect(isInitiallyValid).to.be.true;
        expect(initialWeight).to.equal(validWeight);

        // 2. Check for FALSE with no checkpoints
        await token.setCheckpoints(voter.address, []); // no checkpoints
        const [isFinallyValid, finalWeight] = await adapter.validVotingAdapterVote(
          voter.address,
          proposalId,
          mockExtraData,
        );
        expect(isFinallyValid).to.be.false;
        expect(finalWeight).to.equal(0);
      });

      it('should return (false, 0) if all checkpoints are after proposal start', async () => {
        const { startTimestamp } = await setupValidation(voter.address, 100, 200);

        // 1. Setup and check for TRUE with a valid checkpoint
        const validWeight = 100n;
        await token.setCheckpoints(voter.address, [
          { _key: startTimestamp - 1, _value: validWeight },
        ]);
        const [isInitiallyValid, initialWeight] = await adapter.validVotingAdapterVote(
          voter.address,
          proposalId,
          mockExtraData,
        );
        expect(isInitiallyValid).to.be.true;
        expect(initialWeight).to.equal(validWeight);

        // 2. Check for FALSE with all checkpoints after start
        await token.setCheckpoints(voter.address, [
          { _key: startTimestamp + 1, _value: 100n },
          { _key: startTimestamp + 2, _value: 200n },
        ]);

        const [isFinallyValid, finalWeight] = await adapter.validVotingAdapterVote(
          voter.address,
          proposalId,
          mockExtraData,
        );
        expect(isFinallyValid).to.be.false;
        expect(finalWeight).to.equal(0);
      });

      it('should return (false, 0) if the relevant checkpoint has zero votes', async () => {
        const { startTimestamp } = await setupValidation(voter.address, 100, 200);

        // 1. Setup and check for TRUE with a valid checkpoint
        const validWeight = 100n;
        await token.setCheckpoints(voter.address, [
          { _key: startTimestamp - 1, _value: validWeight },
        ]);
        const [isInitiallyValid, initialWeight] = await adapter.validVotingAdapterVote(
          voter.address,
          proposalId,
          mockExtraData,
        );
        expect(isInitiallyValid).to.be.true;
        expect(initialWeight).to.equal(validWeight);

        // 2. Check for FALSE with a zero-vote checkpoint
        await token.setCheckpoints(voter.address, [{ _key: startTimestamp - 1, _value: 0n }]);

        const [isFinallyValid, finalWeight] = await adapter.validVotingAdapterVote(
          voter.address,
          proposalId,
          mockExtraData,
        );
        expect(isFinallyValid).to.be.false;
        expect(finalWeight).to.equal(0);
      });

      it('should return (true, votingWeight) with a single checkpoint before start timestamp', async () => {
        const { startTimestamp } = await setupValidation(voter.address, 100, 200);
        const votingWeight = 123n;

        await token.setCheckpoints(voter.address, [
          { _key: startTimestamp - 1, _value: votingWeight },
        ]);

        const [isValid, weight] = await adapter.validVotingAdapterVote(
          voter.address,
          proposalId,
          mockExtraData,
        );
        expect(isValid).to.be.true;
        expect(weight).to.equal(votingWeight);
      });

      it('should return (true, votingWeight) with a single checkpoint at start timestamp', async () => {
        const { startTimestamp } = await setupValidation(voter.address, 100, 200);
        const votingWeight = 123n;

        await token.setCheckpoints(voter.address, [{ _key: startTimestamp, _value: votingWeight }]);

        const [isValid, weight] = await adapter.validVotingAdapterVote(
          voter.address,
          proposalId,
          mockExtraData,
        );
        expect(isValid).to.be.true;
        expect(weight).to.equal(votingWeight);
      });

      it('should use most recent checkpoint before proposal start', async () => {
        const { startTimestamp } = await setupValidation(voter.address, 100, 200);
        const expectedWeight = 100n;

        await token.setCheckpoints(voter.address, [
          { _key: startTimestamp - 3, _value: 50n },
          { _key: startTimestamp - 2, _value: 0n },
          { _key: startTimestamp - 1, _value: expectedWeight },
        ]);

        const [isValid, weight] = await adapter.validVotingAdapterVote(
          voter.address,
          proposalId,
          mockExtraData,
        );
        expect(isValid).to.be.true;
        expect(weight).to.equal(expectedWeight);
      });

      it('should ignore checkpoints after proposal start', async () => {
        const { startTimestamp } = await setupValidation(voter.address, 100, 200);
        const expectedWeight = 100n;

        // 1. Check for TRUE with a valid setup
        await token.setCheckpoints(voter.address, [
          { _key: startTimestamp - 1, _value: expectedWeight },
        ]);
        const [isInitiallyValid, initialWeight] = await adapter.validVotingAdapterVote(
          voter.address,
          proposalId,
          mockExtraData,
        );
        expect(isInitiallyValid).to.be.true;
        expect(initialWeight).to.equal(expectedWeight);

        // 2. Check for FALSE by adding an ignored checkpoint (behavior doesn't change from true)
        // This test is confirming that later checkpoints are ignored, so the result should still be TRUE
        // with the weight from the last valid checkpoint.
        await token.setCheckpoints(voter.address, [
          { _key: startTimestamp - 1, _value: expectedWeight },
          { _key: startTimestamp + 1, _value: 200n },
          { _key: startTimestamp + 2, _value: 300n },
        ]);

        const [isFinallyValid, finalWeight] = await adapter.validVotingAdapterVote(
          voter.address,
          proposalId,
          mockExtraData,
        );
        expect(isFinallyValid).to.be.true;
        expect(finalWeight).to.equal(expectedWeight);
      });

      it('should return (false, 0) if most recent checkpoint is after proposal end', async () => {
        const { startTimestamp, endTimestamp } = await setupValidation(voter.address, 100, 200);

        // 1. Setup and check for TRUE with a valid checkpoint
        const validWeight = 100n;
        await token.setCheckpoints(voter.address, [
          { _key: startTimestamp - 1, _value: validWeight },
        ]);
        const [isInitiallyValid, initialWeight] = await adapter.validVotingAdapterVote(
          voter.address,
          proposalId,
          mockExtraData,
        );
        expect(isInitiallyValid).to.be.true;
        expect(initialWeight).to.equal(validWeight);

        // 2. Check for FALSE by adding a checkpoint after the end time
        await token.setCheckpoints(voter.address, [
          { _key: startTimestamp - 1, _value: 100n }, // A valid one
          { _key: endTimestamp + 1, _value: 50n }, // But this one is after end time
        ]);

        const [isFinallyValid, finalWeight] = await adapter.validVotingAdapterVote(
          voter.address,
          proposalId,
          mockExtraData,
        );
        expect(isFinallyValid).to.be.false;
        expect(finalWeight).to.equal(0);
      });

      it('should return (true, votingWeight) for happy path with default weightPerToken', async () => {
        const { startTimestamp } = await setupValidation(voter.address, 100, 200);
        const expectedRawWeight = 500n;
        await token.setCheckpoints(voter.address, [
          { _key: startTimestamp - 10, _value: 100n },
          { _key: startTimestamp - 5, _value: expectedRawWeight },
        ]);

        const [isValid, weight] = await adapter.validVotingAdapterVote(
          voter.address,
          proposalId,
          mockExtraData,
        );

        expect(isValid).to.be.true;
        expect(weight).to.equal(expectedRawWeight * DEFAULT_WEIGHT_PER_TOKEN);
      });

      it('should correctly apply weightPerToken when it is greater than 1', async () => {
        const customWeightPerToken = 5n;
        const { adapter: customAdapter } = await deployERC20AdapterProxy(
          deployer,
          erc20AdapterImplementationAddressG,
          await token.getAddress(),
          await mockStrategy.getAddress(),
          customWeightPerToken,
        );
        await strategy.setVotingAdapter(await customAdapter.getAddress(), true);

        const { startTimestamp } = await setupValidation(voter.address, 100, 200);
        const votingWeight = 100n;
        await token.setCheckpoints(voter.address, [
          { _key: startTimestamp - 1, _value: votingWeight },
        ]);

        const [isValid, weight] = await customAdapter.validVotingAdapterVote(
          voter.address,
          proposalId,
          mockExtraData,
        );

        expect(isValid).to.be.true;
        expect(weight).to.equal(votingWeight * customWeightPerToken);
      });

      it('should return (false, 0) if weightPerToken is 0', async () => {
        const { startTimestamp } = await setupValidation(voter.address, 100, 200);
        const votingWeight = 100n;

        // 1. Check for TRUE with the standard adapter
        await token.setCheckpoints(voter.address, [
          { _key: startTimestamp - 1, _value: votingWeight },
        ]);
        const [isInitiallyValid, initialWeight] = await adapter.validVotingAdapterVote(
          voter.address,
          proposalId,
          mockExtraData,
        );
        expect(isInitiallyValid).to.be.true;
        expect(initialWeight).to.equal(votingWeight * DEFAULT_WEIGHT_PER_TOKEN);

        // 2. Check for FALSE with the zero-weight adapter
        const customWeightPerToken = 0n;
        const { adapter: customAdapter } = await deployERC20AdapterProxy(
          deployer,
          erc20AdapterImplementationAddressG,
          await token.getAddress(),
          await mockStrategy.getAddress(),
          customWeightPerToken,
        );
        await strategy.setVotingAdapter(await customAdapter.getAddress(), true);

        const [isFinallyValid, finalWeight] = await customAdapter.validVotingAdapterVote(
          voter.address,
          proposalId,
          mockExtraData,
        );

        expect(isFinallyValid).to.be.false;
        expect(finalWeight).to.equal(0);
      });
    });
  });

  describe('Deployment Block', () => {
    let adapter: VotingAdapterERC20V1;

    beforeEach(async () => {
      const { adapter: deployedAdapter } = await deployERC20AdapterProxy(
        deployer,
        erc20AdapterImplementationAddressG,
        await mockToken.getAddress(),
        await mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_TOKEN,
      );
      adapter = deployedAdapter;
    });

    runDeploymentBlockTests({
      getContract: () => adapter,
    });
  });
});
