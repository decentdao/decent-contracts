import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import type { ContractTransactionResponse } from 'ethers';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  ERC721TokenAdapterV1,
  ERC721TokenAdapterV1__factory,
  IERC165__factory,
  ITokenAdapterBaseV1__factory,
  ITokenAdapterV1__factory,
  IVersion__factory,
  MockERC721,
  MockERC721__factory,
  MockVotingStrategy,
  MockVotingStrategy__factory,
} from '../../../../typechain-types';
import { calculateInterfaceId } from '../../../helpers/utils';
import { runUUPSUpgradeabilityTests } from '../../../helpers/uupsUpgradeabilityTests';

async function deployERC721AdapterProxy(
  proxyDeployer: SignerWithAddress,
  implementationAddress: string,
  initialOwnerAddress: string,
  tokenAddress: string,
  strategyAddress: string,
  weightPerNft: bigint,
): Promise<{ adapter: ERC721TokenAdapterV1; deployTx: ContractTransactionResponse }> {
  const initData = ERC721TokenAdapterV1__factory.createInterface().encodeFunctionData(
    'initialize',
    [initialOwnerAddress, tokenAddress, strategyAddress, weightPerNft],
  );
  const proxyContractFactory = new ERC1967Proxy__factory(proxyDeployer);
  const proxy = await proxyContractFactory.deploy(implementationAddress, initData);
  await proxy.waitForDeployment();

  const adapterInstance = ERC721TokenAdapterV1__factory.connect(
    await proxy.getAddress(),
    proxyDeployer,
  );
  const deployTxObj = proxy.deploymentTransaction();
  if (!deployTxObj) {
    throw new Error('Proxy deployment transaction not found for ERC721AdapterV1');
  }
  return { adapter: adapterInstance, deployTx: deployTxObj };
}

describe('ERC721TokenAdapterV1', () => {
  // Globally scoped (from first fixture load in `before`)
  let erc721AdapterImplementationAddressG: string;
  let deployerG: SignerWithAddress;

  // Default Test Params
  const DEFAULT_WEIGHT_PER_NFT = 1n;

  async function deployGlobalERC721Fixture() {
    const [deployer] = await ethers.getSigners();
    const adapterImplFactory = new ERC721TokenAdapterV1__factory(deployer);
    const deployedAdapterImpl = await adapterImplFactory.deploy();
    await deployedAdapterImpl.waitForDeployment();
    erc721AdapterImplementationAddressG = await deployedAdapterImpl.getAddress();
    deployerG = deployer;
    return { erc721AdapterImplementationAddress: erc721AdapterImplementationAddressG, deployer };
  }

  async function deployMocksAndSignersERC721Fixture() {
    const [deployer, owner, user1, user2, nonOwnerAccount] = await ethers.getSigners();

    const mockNftFactory = new MockERC721__factory(deployer);
    const mockNft = await mockNftFactory.deploy();
    await mockNft.waitForDeployment();

    const mockStrategyFactory = new MockVotingStrategy__factory(deployer);
    const mockStrategy = await mockStrategyFactory.deploy(user1.address);
    await mockStrategy.waitForDeployment();

    const user1TokenIds: bigint[] = [];
    let nextTokenId: bigint;

    // Mint first token for user1
    nextTokenId = await mockNft.getCurrentTokenId();
    user1TokenIds.push(nextTokenId);
    await mockNft.mint(user1.address);

    // Mint second token for user1
    nextTokenId = await mockNft.getCurrentTokenId();
    user1TokenIds.push(nextTokenId);
    await mockNft.mint(user1.address);

    // Mint third token for user1
    nextTokenId = await mockNft.getCurrentTokenId();
    user1TokenIds.push(nextTokenId);
    await mockNft.mint(user1.address);

    const user2TokenIds: bigint[] = [];
    // Mint first token for user2
    nextTokenId = await mockNft.getCurrentTokenId();
    user2TokenIds.push(nextTokenId);
    await mockNft.mint(user2.address);

    // Mint second token for user2
    nextTokenId = await mockNft.getCurrentTokenId();
    user2TokenIds.push(nextTokenId);
    await mockNft.mint(user2.address);

    return {
      deployer,
      ownerSigner: owner,
      user1Signer: user1,
      user2Signer: user2,
      nonOwnerSigner: nonOwnerAccount,
      mockNft,
      mockStrategy,
      user1TokenIds,
      user2TokenIds,
    };
  }

  before(async () => {
    await loadFixture(deployGlobalERC721Fixture);
  });

  describe('Initialization', () => {
    it('should initialize correctly, set owner, and emit TokenAdapterParametersUpdated event', async () => {
      const {
        ownerSigner,
        mockNft,
        mockStrategy,
        deployer: fixtureDeployer,
      } = await loadFixture(deployMocksAndSignersERC721Fixture);

      const { adapter: erc721Adapter, deployTx } = await deployERC721AdapterProxy(
        fixtureDeployer,
        erc721AdapterImplementationAddressG,
        ownerSigner.address,
        await mockNft.getAddress(),
        await mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_NFT,
      );

      await expect(deployTx)
        .to.emit(erc721Adapter, 'TokenAdapterParametersUpdated')
        .withArgs(DEFAULT_WEIGHT_PER_NFT);

      expect(await erc721Adapter.owner()).to.equal(ownerSigner.address);
      expect(await erc721Adapter.token()).to.equal(await mockNft.getAddress());
      expect(await erc721Adapter.strategy()).to.equal(await mockStrategy.getAddress());
      expect(await erc721Adapter.weightPerNft()).to.equal(DEFAULT_WEIGHT_PER_NFT);
    });

    it('should revert if token address is zero', async () => {
      const { mockNft, deployer: fixtureDeployer } = await loadFixture(
        deployMocksAndSignersERC721Fixture,
      );
      const erc721AdapterImplementation = ERC721TokenAdapterV1__factory.connect(
        erc721AdapterImplementationAddressG,
        deployerG,
      );
      await expect(
        deployERC721AdapterProxy(
          fixtureDeployer,
          erc721AdapterImplementationAddressG,
          fixtureDeployer.address,
          ethers.ZeroAddress,
          await mockNft.getAddress(),
          DEFAULT_WEIGHT_PER_NFT,
        ),
      ).to.be.revertedWithCustomError(erc721AdapterImplementation, 'InvalidTokenAddress');
    });

    it('should revert if strategy address is zero', async () => {
      const { mockNft, deployer: fixtureDeployer } = await loadFixture(
        deployMocksAndSignersERC721Fixture,
      );
      const erc721AdapterImplementation = ERC721TokenAdapterV1__factory.connect(
        erc721AdapterImplementationAddressG,
        deployerG,
      );
      await expect(
        deployERC721AdapterProxy(
          fixtureDeployer,
          erc721AdapterImplementationAddressG,
          fixtureDeployer.address,
          await mockNft.getAddress(),
          ethers.ZeroAddress,
          DEFAULT_WEIGHT_PER_NFT,
        ),
      ).to.be.revertedWithCustomError(erc721AdapterImplementation, 'InvalidStrategyAddress');
    });

    it('should revert if weightPerNft is zero', async () => {
      const {
        mockNft,
        mockStrategy,
        deployer: fixtureDeployer,
      } = await loadFixture(deployMocksAndSignersERC721Fixture);
      const erc721AdapterImplementation = ERC721TokenAdapterV1__factory.connect(
        erc721AdapterImplementationAddressG,
        deployerG,
      );
      await expect(
        deployERC721AdapterProxy(
          fixtureDeployer,
          erc721AdapterImplementationAddressG,
          fixtureDeployer.address,
          await mockNft.getAddress(),
          await mockStrategy.getAddress(),
          0n, // Invalid weight
        ),
      ).to.be.revertedWithCustomError(erc721AdapterImplementation, 'InvalidWeightPerNft');
    });

    it('should not allow reinitialization', async () => {
      const {
        mockNft,
        mockStrategy,
        deployer: fixtureDeployer,
      } = await loadFixture(deployMocksAndSignersERC721Fixture);
      const { adapter: erc721Adapter } = await deployERC721AdapterProxy(
        fixtureDeployer,
        erc721AdapterImplementationAddressG,
        fixtureDeployer.address,
        await mockNft.getAddress(),
        await mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_NFT,
      );
      await expect(
        erc721Adapter.initialize(
          fixtureDeployer.address,
          await mockNft.getAddress(),
          await mockStrategy.getAddress(),
          DEFAULT_WEIGHT_PER_NFT,
        ),
      ).to.be.revertedWithCustomError(erc721Adapter, 'InvalidInitialization');
    });

    it('Should have initialization disabled in the implementation contract', async function () {
      const {
        mockNft,
        mockStrategy,
        deployer: fixtureDeployer,
      } = await loadFixture(deployMocksAndSignersERC721Fixture);
      const implementationContract = ERC721TokenAdapterV1__factory.connect(
        erc721AdapterImplementationAddressG,
        fixtureDeployer,
      );
      await expect(
        implementationContract.initialize(
          fixtureDeployer.address,
          await mockNft.getAddress(),
          await mockStrategy.getAddress(),
          DEFAULT_WEIGHT_PER_NFT,
        ),
      ).to.be.revertedWithCustomError(implementationContract, 'InvalidInitialization');
    });
  });

  describe('weightOf', () => {
    let adapter: ERC721TokenAdapterV1;
    let mockNft: MockERC721; // Explicitly type mockNft here
    let user1: SignerWithAddress;
    let user1TokenIds: bigint[];
    let user2TokenIds: bigint[];
    let deployer: SignerWithAddress;

    const proposalId = 1;

    beforeEach(async () => {
      const fixture = await loadFixture(deployMocksAndSignersERC721Fixture);
      mockNft = fixture.mockNft; // mockNft is now correctly typed
      user1 = fixture.user1Signer;
      user1TokenIds = fixture.user1TokenIds;
      user2TokenIds = fixture.user2TokenIds;
      deployer = fixture.deployer;

      const { adapter: deployedAdapter } = await deployERC721AdapterProxy(
        deployer,
        erc721AdapterImplementationAddressG,
        deployer.address,
        await mockNft.getAddress(),
        await fixture.mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_NFT,
      );
      adapter = deployedAdapter;
    });

    it('should return correct weight if voter owns all provided, unvoted token IDs', async () => {
      const tokenIdsToVoteWith = [user1TokenIds[0], user1TokenIds[1]]; // e.g. [0, 1]
      const adapterVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [tokenIdsToVoteWith],
      );
      const weight = await adapter.weightOf(user1.address, proposalId, adapterVoteData);
      expect(weight).to.equal(BigInt(tokenIdsToVoteWith.length) * DEFAULT_WEIGHT_PER_NFT);
    });

    it('should return correct weight if voter owns some of the provided token IDs', async () => {
      const tokenIdsToVoteWith = [user1TokenIds[0], user2TokenIds[0]]; // User1 owns first, not second
      const adapterVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [tokenIdsToVoteWith],
      );
      const weight = await adapter.weightOf(user1.address, proposalId, adapterVoteData);
      expect(weight).to.equal(1n * DEFAULT_WEIGHT_PER_NFT); // Only user1TokenIds[0] is valid for user1
    });

    it('should return 0 weight for token IDs already used in the proposal', async () => {
      const tokenToUse = user1TokenIds[0];
      // First, use the token in a vote (recordVote will mark it as used)
      const initialAdapterVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[tokenToUse]],
      );
      await adapter.connect(user1).recordVote(user1.address, proposalId, initialAdapterVoteData);

      // Then, try to get weightOf for the same token
      const adapterVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[tokenToUse]],
      );
      const weight = await adapter.weightOf(user1.address, proposalId, adapterVoteData);
      expect(weight).to.equal(0n);
    });

    it('should count duplicate token IDs in _adapterVoteData only once', async () => {
      const tokenIdsToVoteWith = [user1TokenIds[0], user1TokenIds[0], user1TokenIds[1]]; // Duplicate user1TokenIds[0]
      const adapterVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [tokenIdsToVoteWith],
      );
      const weight = await adapter.weightOf(user1.address, proposalId, adapterVoteData);
      // Expected weight is for user1TokenIds[0] and user1TokenIds[1] (2 tokens)
      expect(weight).to.equal(2n * DEFAULT_WEIGHT_PER_NFT);
    });

    it('should return 0 if _adapterVoteData is empty or decodes to an empty array', async () => {
      let adapterVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[]]);
      let weight = await adapter.weightOf(user1.address, proposalId, adapterVoteData);
      expect(weight).to.equal(0n);

      // Test with malformed/non-array data (should ideally be caught by abi.decode or revert)
      // However, the contract handles empty array gracefully. For other malformations, it might revert.
      // This specific test focuses on empty array logic.
    });

    it('should return 0 if voter owns none of the valid provided token IDs', async () => {
      const tokenIdsToVoteWith = [user2TokenIds[0], user2TokenIds[1]]; // Tokens owned by user2
      const adapterVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [tokenIdsToVoteWith],
      );
      const weight = await adapter.weightOf(user1.address, proposalId, adapterVoteData); // User1 tries to vote
      expect(weight).to.equal(0n);
    });

    it('should correctly apply weightPerNft > 1', async () => {
      const customWeightPerNft = 3n;
      const { adapter: customAdapter } = await deployERC721AdapterProxy(
        deployer, // from beforeEach
        erc721AdapterImplementationAddressG,
        deployer.address,
        await mockNft.getAddress(),
        await (await loadFixture(deployMocksAndSignersERC721Fixture)).mockStrategy.getAddress(), // Fresh strategy address
        customWeightPerNft,
      );

      const tokenIdsToVoteWith = [user1TokenIds[0], user1TokenIds[1]];
      const adapterVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [tokenIdsToVoteWith],
      );
      const weight = await customAdapter.weightOf(user1.address, proposalId, adapterVoteData);
      expect(weight).to.equal(BigInt(tokenIdsToVoteWith.length) * customWeightPerNft);
    });
  });

  describe('recordVote', () => {
    let adapter: ERC721TokenAdapterV1;
    let mockNft: MockERC721;
    let user1: SignerWithAddress;
    let user1TokenIds: bigint[];
    let user2TokenIds: bigint[];
    let deployer: SignerWithAddress;
    let owner: SignerWithAddress;
    let mockStrategy: MockVotingStrategy;

    const proposalId = 1;

    beforeEach(async () => {
      const fixture = await loadFixture(deployMocksAndSignersERC721Fixture);
      mockNft = fixture.mockNft;
      user1 = fixture.user1Signer;
      user1TokenIds = fixture.user1TokenIds;
      user2TokenIds = fixture.user2TokenIds;
      deployer = fixture.deployer;
      owner = fixture.ownerSigner;
      mockStrategy = fixture.mockStrategy;

      const { adapter: deployedAdapter } = await deployERC721AdapterProxy(
        deployer,
        erc721AdapterImplementationAddressG,
        owner.address,
        await mockNft.getAddress(),
        await mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_NFT,
      );
      adapter = deployedAdapter;
    });

    it('should record vote, return casted weight, mark NFTs as used, and emit VoteRecorded event', async () => {
      const tokenIdsToVoteWith = [user1TokenIds[0], user1TokenIds[1]];
      const adapterVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [tokenIdsToVoteWith],
      );
      const expectedWeight = BigInt(tokenIdsToVoteWith.length) * DEFAULT_WEIGHT_PER_NFT;

      const weightCastedStatically = await adapter
        .connect(user1)
        .recordVote.staticCall(user1.address, proposalId, adapterVoteData);
      expect(weightCastedStatically).to.equal(expectedWeight);

      await expect(adapter.connect(user1).recordVote(user1.address, proposalId, adapterVoteData))
        .to.emit(adapter, 'VoteRecorded')
        .withArgs(user1.address, proposalId, expectedWeight, adapterVoteData);

      void expect(await adapter.nftUsedForVote(proposalId, user1TokenIds[0])).to.be.true;
      void expect(await adapter.nftUsedForVote(proposalId, user1TokenIds[1])).to.be.true;
      if (user1TokenIds.length > 2) {
        void expect(await adapter.nftUsedForVote(proposalId, user1TokenIds[2])).to.be.false;
      }
      const weightAfter = await adapter.weightOf(user1.address, proposalId, adapterVoteData);
      expect(weightAfter).to.equal(0n);
    });

    it('should return 0 and emit VoteRecorded if no valid NFTs are provided or all are already used', async () => {
      const tokenToUse = user1TokenIds[0];
      const voteDataSingle = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [[tokenToUse]],
      );
      // First vote
      await adapter.connect(user1).recordVote(user1.address, proposalId, voteDataSingle);

      // Attempt second vote with same token
      const weightCastedStatically = await adapter
        .connect(user1)
        .recordVote.staticCall(user1.address, proposalId, voteDataSingle);
      expect(weightCastedStatically).to.equal(0n);
      await expect(adapter.connect(user1).recordVote(user1.address, proposalId, voteDataSingle))
        .to.emit(adapter, 'VoteRecorded')
        .withArgs(user1.address, proposalId, 0n, voteDataSingle);

      // Case 2: Empty token list
      const emptyVoteData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[]]);
      const weightCastedEmptyStatically = await adapter
        .connect(user1)
        .recordVote.staticCall(user1.address, proposalId, emptyVoteData);
      expect(weightCastedEmptyStatically).to.equal(0n);
      await expect(adapter.connect(user1).recordVote(user1.address, proposalId, emptyVoteData))
        .to.emit(adapter, 'VoteRecorded')
        .withArgs(user1.address, proposalId, 0n, emptyVoteData);
    });

    it('should not allow voting with NFTs not owned by the voter, emit VoteRecorded with 0 weight', async () => {
      const tokenIdsNotOwnedByUser1 = [user2TokenIds[0]]; // Owned by user2 (from fixture)
      const adapterVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [tokenIdsNotOwnedByUser1],
      );

      const weightCastedStatically = await adapter
        .connect(user1)
        .recordVote.staticCall(user1.address, proposalId, adapterVoteData);
      expect(weightCastedStatically).to.equal(0n);

      await expect(adapter.connect(user1).recordVote(user1.address, proposalId, adapterVoteData))
        .to.emit(adapter, 'VoteRecorded')
        .withArgs(user1.address, proposalId, 0n, adapterVoteData);

      void expect(await adapter.nftUsedForVote(proposalId, user2TokenIds[0])).to.be.false;
    });

    it('should correctly apply custom weightPerNft on recordVote and emit event', async () => {
      const customWeightPerNft = 3n;

      // Load fresh instances FOR THIS TEST to ensure clean state for customAdapter deployment
      const {
        mockNft: localMockNft,
        mockStrategy: localMockStrategy,
        ownerSigner: localOwner,
        user1Signer: localUser1,
        deployer: localDeployer,
      } = await loadFixture(deployMocksAndSignersERC721Fixture);

      // Mint specific tokens for localUser1 on localMockNft
      const localUser1TestTokenIds: bigint[] = [];
      let tokenId1 = await localMockNft.getCurrentTokenId();
      localUser1TestTokenIds.push(tokenId1);
      await localMockNft.mint(localUser1.address);
      let tokenId2 = await localMockNft.getCurrentTokenId();
      localUser1TestTokenIds.push(tokenId2);
      await localMockNft.mint(localUser1.address);

      const { adapter: customAdapter } = await deployERC721AdapterProxy(
        localDeployer,
        erc721AdapterImplementationAddressG,
        localOwner.address,
        await localMockNft.getAddress(),
        await localMockStrategy.getAddress(),
        customWeightPerNft,
      );

      const tokenIdsToUseInVote = [localUser1TestTokenIds[0]]; // Use a token minted for localUser1 on localMockNft
      const adapterVoteData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256[]'],
        [tokenIdsToUseInVote],
      );
      const expectedWeight = BigInt(tokenIdsToUseInVote.length) * customWeightPerNft;

      // localUser1 is the owner of tokenIdsToUseInVote on the localMockNft that customAdapter uses
      const weightCastedStatically = await customAdapter
        .connect(localUser1)
        .recordVote.staticCall(localUser1.address, proposalId, adapterVoteData);
      expect(weightCastedStatically).to.equal(expectedWeight);

      await expect(
        customAdapter
          .connect(localUser1)
          .recordVote(localUser1.address, proposalId, adapterVoteData),
      )
        .to.emit(customAdapter, 'VoteRecorded')
        .withArgs(localUser1.address, proposalId, expectedWeight, adapterVoteData);

      void expect(await customAdapter.nftUsedForVote(proposalId, tokenIdsToUseInVote[0])).to.be
        .true;
    });
  });

  describe('getVersion()', () => {
    it('should return the correct version', async () => {
      const {
        mockNft,
        mockStrategy,
        deployer: fixtureDeployer,
      } = await loadFixture(deployMocksAndSignersERC721Fixture);
      const { adapter: erc721Adapter } = await deployERC721AdapterProxy(
        fixtureDeployer,
        erc721AdapterImplementationAddressG,
        fixtureDeployer.address,
        await mockNft.getAddress(),
        await mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_NFT,
      );
      expect(await erc721Adapter.getVersion()).to.equal(1);
    });
  });

  describe('ERC165 supportsInterface', () => {
    let erc721Adapter: ERC721TokenAdapterV1;
    let iTokenAdapterV1InterfaceId: string;
    let iTokenAdapterBaseV1InterfaceId: string;
    let iVersionInterfaceId: string;
    let iERC165InterfaceId: string;

    beforeEach(async () => {
      const {
        mockNft,
        mockStrategy,
        deployer: fixtureDeployer,
      } = await loadFixture(deployMocksAndSignersERC721Fixture);
      const { adapter } = await deployERC721AdapterProxy(
        fixtureDeployer,
        erc721AdapterImplementationAddressG,
        fixtureDeployer.address,
        await mockNft.getAddress(),
        await mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_NFT,
      );
      erc721Adapter = adapter;

      // Calculate interface IDs
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
      void expect(await erc721Adapter.supportsInterface(iTokenAdapterV1InterfaceId)).to.be.true;
    });

    it('should support ITokenAdapterBaseV1', async () => {
      void expect(await erc721Adapter.supportsInterface(iTokenAdapterBaseV1InterfaceId)).to.be.true;
    });

    it('should support IVersion', async () => {
      void expect(await erc721Adapter.supportsInterface(iVersionInterfaceId)).to.be.true;
    });

    it('should support IERC165', async () => {
      void expect(await erc721Adapter.supportsInterface(iERC165InterfaceId)).to.be.true;
    });

    it('should not support a random interfaceId', async () => {
      void expect(await erc721Adapter.supportsInterface('0x12345678')).to.be.false;
    });
  });

  describe('Owner Functions', () => {
    let adapter: ERC721TokenAdapterV1;
    let owner: SignerWithAddress;
    let nonOwner: SignerWithAddress;
    let deployer: SignerWithAddress; // This will be the fixture.deployer
    let mockNftAddress: string;
    let mockStrategyAddress: string;

    beforeEach(async () => {
      const fixture = await loadFixture(deployMocksAndSignersERC721Fixture);
      owner = fixture.ownerSigner; // This is the intended owner for the adapter
      nonOwner = fixture.nonOwnerSigner;
      deployer = fixture.deployer; // This is the signer used to deploy the proxy
      mockNftAddress = await fixture.mockNft.getAddress();
      mockStrategyAddress = await fixture.mockStrategy.getAddress();

      const { adapter: deployedAdapter } = await deployERC721AdapterProxy(
        deployer, // The fixture.deployer can deploy the proxy
        erc721AdapterImplementationAddressG,
        owner.address, // The fixture.ownerSigner becomes the owner of the adapter
        mockNftAddress,
        mockStrategyAddress,
        DEFAULT_WEIGHT_PER_NFT,
      );
      adapter = deployedAdapter;
    });

    describe('updateWeightPerNft', () => {
      const NEW_WEIGHT_PER_NFT = 5n;

      it('should allow owner to update weightPerNft and emit event', async () => {
        await expect(adapter.connect(owner).updateWeightPerNft(NEW_WEIGHT_PER_NFT))
          .to.emit(adapter, 'TokenAdapterParametersUpdated')
          .withArgs(NEW_WEIGHT_PER_NFT);
        expect(await adapter.weightPerNft()).to.equal(NEW_WEIGHT_PER_NFT);
      });

      it('should not allow non-owner to update weightPerNft', async () => {
        await expect(adapter.connect(nonOwner).updateWeightPerNft(NEW_WEIGHT_PER_NFT))
          .to.be.revertedWithCustomError(adapter, 'OwnableUnauthorizedAccount')
          .withArgs(nonOwner.address);
      });

      it('should revert if new weightPerNft is zero', async () => {
        await expect(adapter.connect(owner).updateWeightPerNft(0n)).to.be.revertedWithCustomError(
          adapter,
          'InvalidWeightPerNft',
        );
      });
    });
  });

  describe('UUPS Upgradeability', () => {
    let erc721AdapterProxy: ERC721TokenAdapterV1;
    let fixtureOwner: SignerWithAddress;
    let fixtureNonOwner: SignerWithAddress;
    let fixtureDeployer: SignerWithAddress;

    beforeEach(async () => {
      const {
        ownerSigner,
        nonOwnerSigner,
        deployer: testDeployer,
        mockNft,
        mockStrategy,
      } = await loadFixture(deployMocksAndSignersERC721Fixture);
      fixtureOwner = ownerSigner;
      fixtureNonOwner = nonOwnerSigner;
      fixtureDeployer = testDeployer;

      const { adapter } = await deployERC721AdapterProxy(
        fixtureDeployer,
        erc721AdapterImplementationAddressG,
        fixtureOwner.address,
        await mockNft.getAddress(),
        await mockStrategy.getAddress(),
        DEFAULT_WEIGHT_PER_NFT,
      );
      erc721AdapterProxy = adapter;
    });

    runUUPSUpgradeabilityTests({
      getContract: () => erc721AdapterProxy,
      createNewImplementation: async () => {
        const newImplementation = await new ERC721TokenAdapterV1__factory(fixtureDeployer).deploy();
        await newImplementation.waitForDeployment();
        return newImplementation;
      },
      owner: () => fixtureOwner,
      nonOwner: () => fixtureNonOwner,
    });
  });
});
