import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import type { ContractTransactionResponse } from 'ethers';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  ERC20TokenAdapterV1,
  ERC20TokenAdapterV1__factory,
  IERC165__factory,
  ITokenAdapterBaseV1__factory,
  ITokenAdapterV1__factory,
  IVersion__factory,
  MockERC20Votes,
  MockERC20Votes__factory,
  MockVotingStrategy,
  MockVotingStrategy__factory,
} from '../../../../typechain-types';
import { calculateInterfaceId } from '../../../helpers/utils';
import { runUUPSUpgradeabilityTests } from '../../../helpers/uupsUpgradeabilityTests';

// Modified helper function to return deployment tx hash
async function deployERC20AdapterProxy(
  proxyDeployer: SignerWithAddress,
  implementationAddress: string,
  ownerAddress: string,
  tokenAddress: string,
  strategyAddress: string,
  weightPerToken: bigint,
): Promise<{ adapter: ERC20TokenAdapterV1; deployTx: ContractTransactionResponse }> {
  const initData = ERC20TokenAdapterV1__factory.createInterface().encodeFunctionData('initialize', [
    ownerAddress,
    tokenAddress,
    strategyAddress,
    weightPerToken,
  ]);
  const proxyContractFactory = new ERC1967Proxy__factory(proxyDeployer);
  const proxy = await proxyContractFactory.deploy(implementationAddress, initData);
  await proxy.waitForDeployment();

  const adapter = ERC20TokenAdapterV1__factory.connect(await proxy.getAddress(), proxyDeployer);
  const deployTx = proxy.deploymentTransaction();
  if (!deployTx) {
    throw new Error('Proxy deployment transaction not found');
  }
  return { adapter, deployTx };
}

describe('ERC20TokenAdapterV1', () => {
  let deployerG: SignerWithAddress;
  let ownerG: SignerWithAddress;
  let erc20AdapterImplementationAddressG: string;

  const DEFAULT_WEIGHT_PER_TOKEN = 1n;

  async function deployGlobalFixture() {
    const [deployer, owner, user1, user2, nonOwner] = await ethers.getSigners();
    const adapterImplFactory = new ERC20TokenAdapterV1__factory(deployer);
    const deployedAdapterImpl = await adapterImplFactory.deploy();
    await deployedAdapterImpl.waitForDeployment();

    // Assign to global vars
    deployerG = deployer;
    ownerG = owner;
    erc20AdapterImplementationAddressG = await deployedAdapterImpl.getAddress();

    // Only return what's needed if this fixture is for global one-time setup
    // For deploying fresh mocks per test suite, a different fixture or direct deployment is better.
    return {
      deployer,
      owner,
      user1,
      user2,
      nonOwner,
      erc20AdapterImplementationAddress: erc20AdapterImplementationAddressG,
    };
  }

  // This specialized fixture is for deploying fresh mocks for specific test suites
  async function deployMocksAndSignersFixture() {
    const [deployer, owner, user1, user2, nonOwner] = await ethers.getSigners();

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
      ownerSigner: owner,
      user1Signer: user1,
      user2Signer: user2,
      nonOwnerSigner: nonOwner,
      mockToken: deployedMockToken,
      mockStrategy: deployedMockStrategy,
    };
  }

  before(async () => {
    // Load global (one-time) deployments like the adapter implementation address
    await loadFixture(deployGlobalFixture);
  });

  let ownerSigner: SignerWithAddress;
  let nonOwnerSigner: SignerWithAddress;
  let mockToken: MockERC20Votes;
  let mockStrategy: MockVotingStrategy;
  let deployer: SignerWithAddress;
  let user1Signer: SignerWithAddress;

  beforeEach(async () => {
    const {
      ownerSigner: oSigner,
      nonOwnerSigner: nSigner,
      mockToken: mToken,
      mockStrategy: mStrategy,
      deployer: dDeployer,
      user1Signer: vSigner,
    } = await loadFixture(deployMocksAndSignersFixture);

    user1Signer = vSigner;
    ownerSigner = oSigner;
    nonOwnerSigner = nSigner;
    mockToken = mToken;
    mockStrategy = mStrategy;
    deployer = dDeployer;
  });

  describe('Initialization', () => {
    it('should initialize correctly with valid parameters and emit event', async () => {
      const { adapter: erc20Adapter, deployTx } = await deployERC20AdapterProxy(
        deployer,
        erc20AdapterImplementationAddressG,
        ownerSigner.address,
        await mockToken.getAddress(),
        await mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_TOKEN,
      );

      // Check the event on the deployment transaction hash.
      // Provide the proxy instance (erc20Adapter) to .to.emit(),
      // as the event is emitted from the proxy's address due to delegatecall.
      await expect(deployTx.hash)
        .to.emit(erc20Adapter, 'TokenAdapterParametersUpdated')
        .withArgs(DEFAULT_WEIGHT_PER_TOKEN);

      expect(await erc20Adapter.owner()).to.equal(ownerSigner.address);
      expect(await erc20Adapter.token()).to.equal(await mockToken.getAddress());
      expect(await erc20Adapter.strategy()).to.equal(await mockStrategy.getAddress());
      expect(await erc20Adapter.weightPerToken()).to.equal(DEFAULT_WEIGHT_PER_TOKEN);
    });

    it('should revert if token address is zero', async () => {
      const erc20AdapterImplementation = ERC20TokenAdapterV1__factory.connect(
        erc20AdapterImplementationAddressG,
        deployerG,
      );

      await expect(
        deployERC20AdapterProxy(
          deployer,
          erc20AdapterImplementationAddressG,
          ownerSigner.address,
          ethers.ZeroAddress,
          await mockStrategy.getAddress(),
          DEFAULT_WEIGHT_PER_TOKEN,
        ),
      ).to.be.revertedWithCustomError(erc20AdapterImplementation, 'InvalidTokenAddress');
    });

    it('should revert if strategy address is zero', async () => {
      const erc20AdapterImplementation = ERC20TokenAdapterV1__factory.connect(
        erc20AdapterImplementationAddressG,
        deployerG,
      );

      await expect(
        deployERC20AdapterProxy(
          deployer,
          erc20AdapterImplementationAddressG,
          ownerSigner.address,
          await mockToken.getAddress(),
          ethers.ZeroAddress,
          DEFAULT_WEIGHT_PER_TOKEN,
        ),
      ).to.be.revertedWithCustomError(erc20AdapterImplementation, 'InvalidStrategyAddress');
    });

    it('should revert if weightPerToken is zero', async () => {
      const erc20AdapterImplementation = ERC20TokenAdapterV1__factory.connect(
        erc20AdapterImplementationAddressG,
        deployerG,
      );

      await expect(
        deployERC20AdapterProxy(
          deployer,
          erc20AdapterImplementationAddressG,
          ownerSigner.address,
          await mockToken.getAddress(),
          await mockStrategy.getAddress(),
          0n,
        ),
      ).to.be.revertedWithCustomError(erc20AdapterImplementation, 'InvalidWeightPerToken');
    });

    it('should not allow reinitialization', async () => {
      const { adapter: erc20Adapter } = await deployERC20AdapterProxy(
        deployer,
        erc20AdapterImplementationAddressG,
        ownerSigner.address,
        await mockToken.getAddress(),
        await mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_TOKEN,
      );

      await expect(
        erc20Adapter.initialize(ownerSigner.address, ethers.ZeroAddress, ethers.ZeroAddress, 0n),
      ).to.be.revertedWithCustomError(erc20Adapter, 'InvalidInitialization');
    });

    it('Should have initialization disabled in the implementation contract', async function () {
      const implementationContract = ERC20TokenAdapterV1__factory.connect(
        erc20AdapterImplementationAddressG,
        ownerG,
      );

      await expect(
        implementationContract.initialize(
          ownerSigner.address,
          await mockToken.getAddress(),
          await mockStrategy.getAddress(),
          DEFAULT_WEIGHT_PER_TOKEN,
        ),
      ).to.be.revertedWithCustomError(implementationContract, 'InvalidInitialization');
    });
  });

  describe('Owner Functions', () => {
    let erc20Adapter: ERC20TokenAdapterV1;
    let currentOwnerSigner: SignerWithAddress;
    let currentNonOwnerSigner: SignerWithAddress;

    beforeEach(async () => {
      currentOwnerSigner = ownerSigner;
      currentNonOwnerSigner = nonOwnerSigner;

      const { adapter } = await deployERC20AdapterProxy(
        deployer,
        erc20AdapterImplementationAddressG,
        currentOwnerSigner.address,
        await mockToken.getAddress(),
        await mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_TOKEN,
      );
      erc20Adapter = adapter;
    });

    describe('updateWeightPerToken', () => {
      const NEW_WEIGHT_PER_TOKEN = 2n;

      it('should allow owner to update weight per token and emit event', async () => {
        await expect(
          erc20Adapter.connect(currentOwnerSigner).updateWeightPerToken(NEW_WEIGHT_PER_TOKEN),
        )
          .to.emit(erc20Adapter, 'TokenAdapterParametersUpdated')
          .withArgs(NEW_WEIGHT_PER_TOKEN);
        expect(await erc20Adapter.weightPerToken()).to.equal(NEW_WEIGHT_PER_TOKEN);
      });

      it('should not allow non-owner to update weight per token', async () => {
        await expect(
          erc20Adapter.connect(currentNonOwnerSigner).updateWeightPerToken(NEW_WEIGHT_PER_TOKEN),
        )
          .to.be.revertedWithCustomError(erc20Adapter, 'OwnableUnauthorizedAccount')
          .withArgs(currentNonOwnerSigner.address);
      });

      it('should revert if new weightPerToken is zero', async () => {
        await expect(
          erc20Adapter.connect(currentOwnerSigner).updateWeightPerToken(0n),
        ).to.be.revertedWithCustomError(erc20Adapter, 'InvalidWeightPerToken');
      });
    });
  });

  describe('weightOf', () => {
    const proposalId = 1;
    const mockExtraData = ethers.ZeroHash;
    let adapter: ERC20TokenAdapterV1;

    async function setupAdapterForWeightOf(clockMode: 0 | 1, customWeightPerToken?: bigint) {
      await mockToken.setClockMode(clockMode);
      const { adapter: deployedAdapter } = await deployERC20AdapterProxy(
        deployer,
        erc20AdapterImplementationAddressG,
        ownerSigner.address,
        await mockToken.getAddress(),
        await mockStrategy.getAddress(),
        customWeightPerToken || DEFAULT_WEIGHT_PER_TOKEN,
      );
      adapter = deployedAdapter;
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
        await mockStrategy.setVotingTimestamps(proposalId, 0, 1000);
        await expect(
          adapter.weightOf(user1Signer.address, proposalId, mockExtraData),
        ).to.be.revertedWithCustomError(adapter, 'ProposalNotReadyForSnapshot');
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
        ).to.be.revertedWithCustomError(adapter, 'ProposalNotReadyForSnapshot');
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
      await adapter.connect(user1Signer).recordVote(user1Signer.address, proposalId, mockExtraData);
      const weight = await adapter.weightOf(user1Signer.address, proposalId, mockExtraData);
      expect(weight).to.equal(0);
    });
  });

  describe('recordVote', () => {
    const proposalId = 1;
    const mockExtraData = ethers.ZeroHash;
    const expectedEventAdapterVoteData = '0x';

    let adapter: ERC20TokenAdapterV1;
    let token: MockERC20Votes;
    let strategy: MockVotingStrategy;
    let voter: SignerWithAddress;
    let owner: SignerWithAddress;
    let currentDeployer: SignerWithAddress;

    async function setupAdapterForRecordVote(clockMode: 0 | 1, customWeightPerToken?: bigint) {
      const {
        ownerSigner: fixtureOwner,
        user1Signer: fixtureVoter,
        deployer: fixDeployer,
        mockToken: fToken,
        mockStrategy: fStrategy,
      } = await loadFixture(deployMocksAndSignersFixture);

      owner = fixtureOwner;
      voter = fixtureVoter;
      token = fToken;
      strategy = fStrategy;
      currentDeployer = fixDeployer;

      await token.setClockMode(clockMode);
      const { adapter: deployedAdapter } = await deployERC20AdapterProxy(
        currentDeployer,
        erc20AdapterImplementationAddressG,
        owner.address,
        await token.getAddress(),
        await strategy.getAddress(),
        customWeightPerToken || DEFAULT_WEIGHT_PER_TOKEN,
      );
      adapter = deployedAdapter;
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

      const weightCastedStatically = await adapter
        .connect(voter)
        .recordVote.staticCall(voter.address, proposalId, mockExtraData);
      expect(weightCastedStatically).to.equal(expectedWeightCasted);

      await expect(adapter.connect(voter).recordVote(voter.address, proposalId, mockExtraData))
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

      const weightCastedStatically = await adapter
        .connect(voter)
        .recordVote.staticCall(voter.address, proposalId, mockExtraData);
      expect(weightCastedStatically).to.equal(expectedWeightCasted);

      await expect(adapter.connect(voter).recordVote(voter.address, proposalId, mockExtraData))
        .to.emit(adapter, 'VoteRecorded')
        .withArgs(voter.address, proposalId, expectedWeightCasted, expectedEventAdapterVoteData);
    });

    it('should revert with ERC20AlreadyVoted if trying to vote again', async () => {
      await setupAdapterForRecordVote(0);
      const votingStartTimestamp = (await time.latest()) + 200;
      await token.setPastVotes(voter.address, votingStartTimestamp, ethers.parseUnits('10', 18));
      await strategy.setVotingTimestamps(
        proposalId,
        votingStartTimestamp,
        votingStartTimestamp + 1000,
      );
      await adapter.recordVote(voter.address, proposalId, mockExtraData);
      await expect(
        adapter.recordVote(voter.address, proposalId, mockExtraData),
      ).to.be.revertedWithCustomError(adapter, 'ERC20AlreadyVoted');
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
      await adapter.recordVote(voter.address, proposalId, mockExtraData);
      const weight = await adapter.weightOf(voter.address, proposalId, mockExtraData);
      expect(weight).to.equal(0);
    });

    it('should revert with ProposalNotReadyForSnapshot if strategy returns startTimestamp as 0 (Timestamp Mode)', async () => {
      await setupAdapterForRecordVote(0);
      await strategy.setVotingTimestamps(proposalId, 0, 1000);
      await expect(
        adapter.recordVote(voter.address, proposalId, mockExtraData),
      ).to.be.revertedWithCustomError(adapter, 'ProposalNotReadyForSnapshot');
    });

    it('should revert with ProposalNotReadyForSnapshot if strategy returns startBlock as 0 (BlockNumber Mode)', async () => {
      await setupAdapterForRecordVote(1);
      await strategy.setVotingStartBlock(proposalId, 0);
      await expect(
        adapter.recordVote(voter.address, proposalId, mockExtraData),
      ).to.be.revertedWithCustomError(adapter, 'ProposalNotReadyForSnapshot');
    });
  });

  describe('getVersion()', () => {
    it('should return the correct version', async () => {
      const { adapter: erc20Adapter } = await deployERC20AdapterProxy(
        deployer,
        erc20AdapterImplementationAddressG,
        ownerSigner.address,
        await mockToken.getAddress(),
        await mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_TOKEN,
      );

      expect(await erc20Adapter.getVersion()).to.equal(1);
    });
  });

  describe('ERC165 supportsInterface', () => {
    let erc20Adapter: ERC20TokenAdapterV1;
    let iTokenAdapterV1InterfaceId: string;
    let iTokenAdapterBaseV1InterfaceId: string;
    let iVersionInterfaceId: string;
    let iERC165InterfaceId: string;

    beforeEach(async () => {
      const { adapter } = await deployERC20AdapterProxy(
        deployer,
        erc20AdapterImplementationAddressG,
        ownerSigner.address,
        await mockToken.getAddress(),
        await mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_TOKEN,
      );
      erc20Adapter = adapter;

      iTokenAdapterV1InterfaceId = calculateInterfaceId(
        ITokenAdapterV1__factory.createInterface(),
        [ITokenAdapterBaseV1__factory.createInterface()],
      );
      iTokenAdapterBaseV1InterfaceId = calculateInterfaceId(
        ITokenAdapterBaseV1__factory.createInterface(),
      );
      iVersionInterfaceId = calculateInterfaceId(IVersion__factory.createInterface());
      iERC165InterfaceId = calculateInterfaceId(IERC165__factory.createInterface());
    });

    it('should support ITokenAdapterV1', async () => {
      void expect(await erc20Adapter.supportsInterface(iTokenAdapterV1InterfaceId)).to.be.true;
    });

    it('should support ITokenAdapterBaseV1', async () => {
      void expect(await erc20Adapter.supportsInterface(iTokenAdapterBaseV1InterfaceId)).to.be.true;
    });

    it('should support IVersion', async () => {
      void expect(await erc20Adapter.supportsInterface(iVersionInterfaceId)).to.be.true;
    });

    it('should support IERC165', async () => {
      void expect(await erc20Adapter.supportsInterface(iERC165InterfaceId)).to.be.true;
    });

    it('should not support a random interfaceId', async () => {
      void expect(await erc20Adapter.supportsInterface('0x12345678')).to.be.false;
    });
  });

  describe('UUPS Upgradeability', () => {
    let erc20AdapterProxy: ERC20TokenAdapterV1;

    beforeEach(async () => {
      const { adapter } = await deployERC20AdapterProxy(
        deployer,
        erc20AdapterImplementationAddressG,
        ownerSigner.address,
        await mockToken.getAddress(),
        await mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_TOKEN,
      );
      erc20AdapterProxy = adapter;
    });

    runUUPSUpgradeabilityTests({
      getContract: () => erc20AdapterProxy,
      createNewImplementation: async () => {
        const newImplementation = await new ERC20TokenAdapterV1__factory(deployer).deploy();
        return newImplementation;
      },
      owner: () => ownerSigner,
      nonOwner: () => nonOwnerSigner,
    });
  });
});
