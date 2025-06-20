import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  IDeploymentBlockV1__factory,
  IERC165__factory,
  IProposerAdapterBaseV1__factory,
  IProposerAdapterERC721V1__factory,
  IVersion__factory,
  MockERC721,
  MockERC721__factory,
  ProposerAdapterERC721V1,
  ProposerAdapterERC721V1__factory,
} from '../../../../../typechain-types';
import { runDeploymentBlockTests } from '../../../../shared/deploymentBlockTests';
import { runSupportsInterfaceTests } from '../../../../shared/supportsInterfaceTests';

async function deployERC721ProposerAdapterProxy(
  deployer: SignerWithAddress,
  implementationAddress: string,
  tokenAddress: string,
  proposerThreshold: bigint,
): Promise<ProposerAdapterERC721V1> {
  const adapterInterface = ProposerAdapterERC721V1__factory.createInterface();
  const initializeCalldata = adapterInterface.encodeFunctionData('initialize', [
    tokenAddress,
    proposerThreshold,
  ]);
  const proxyFactory = new ERC1967Proxy__factory(deployer);
  const proxy = await proxyFactory.deploy(implementationAddress, initializeCalldata);
  await proxy.waitForDeployment();
  return ProposerAdapterERC721V1__factory.connect(await proxy.getAddress(), deployer);
}

describe('ProposerAdapterERC721V1', () => {
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;

  let adapterImplementation: ProposerAdapterERC721V1;
  let adapter: ProposerAdapterERC721V1;
  let mockNft: MockERC721;

  const DEFAULT_PROPOSER_THRESHOLD = 5n;

  beforeEach(async () => {
    [deployer, user1] = await ethers.getSigners();

    const mockNftFactory = new MockERC721__factory(deployer);
    mockNft = await mockNftFactory.deploy();
    await mockNft.waitForDeployment();

    if (!adapterImplementation) {
      const adapterFactory = new ProposerAdapterERC721V1__factory(deployer);
      adapterImplementation = await adapterFactory.deploy();
      await adapterImplementation.waitForDeployment();
    }

    adapter = await deployERC721ProposerAdapterProxy(
      deployer,
      await adapterImplementation.getAddress(),
      await mockNft.getAddress(),
      DEFAULT_PROPOSER_THRESHOLD,
    );
  });

  describe('Initialization (via Proxy)', () => {
    it('should initialize correctly with valid parameters', async () => {
      expect(await adapter.token()).to.equal(await mockNft.getAddress());
      expect(await adapter.proposerThreshold()).to.equal(DEFAULT_PROPOSER_THRESHOLD);
    });

    it('should prevent reinitialization on proxied adapter', async () => {
      await expect(
        adapter.initialize(await mockNft.getAddress(), DEFAULT_PROPOSER_THRESHOLD),
      ).to.be.revertedWithCustomError(adapter, 'InvalidInitialization');
    });

    it('Implementation contract should remain uninitialized', async () => {
      await expect(
        adapterImplementation.initialize(await mockNft.getAddress(), DEFAULT_PROPOSER_THRESHOLD),
      ).to.be.revertedWithCustomError(adapterImplementation, 'InvalidInitialization');
    });
  });

  describe('isProposer', () => {
    it('should return true if user meets the proposer threshold (balance * weight)', async () => {
      for (let i = 0; i < 5; i++) {
        await mockNft.connect(deployer).mint(user1.address);
      }
      const canPropose = await adapter.isProposer(user1.address, ethers.ZeroHash);
      expect(canPropose).to.be.true;
    });

    it('should return true if user exceeds the proposer threshold', async () => {
      for (let i = 0; i < 6; i++) {
        await mockNft.connect(deployer).mint(user1.address);
      }
      const canPropose = await adapter.isProposer(user1.address, ethers.ZeroHash);
      expect(canPropose).to.be.true;
    });

    it('should return false if user is below the proposer threshold', async () => {
      for (let i = 0; i < 4; i++) {
        await mockNft.connect(deployer).mint(user1.address);
      }
      const canPropose = await adapter.isProposer(user1.address, ethers.ZeroHash);
      expect(canPropose).to.be.false;
    });

    it('should return false if user has no NFTs', async () => {
      const canPropose = await adapter.isProposer(user1.address, ethers.ZeroHash);
      expect(canPropose).to.be.false;
    });

    it('should return true if proposerThreshold is 0, even with zero NFTs', async () => {
      const localAdapter = await deployERC721ProposerAdapterProxy(
        deployer,
        await adapterImplementation.getAddress(),
        await mockNft.getAddress(),
        0n,
      );
      const canPropose = await localAdapter.isProposer(user1.address, ethers.ZeroHash);
      expect(canPropose).to.be.true;
    });
  });

  describe('version', () => {
    it('should return the correct version', async () => {
      expect(await adapter.version()).to.equal(1n);
    });
  });

  describe('ERC165 supportsInterface', () => {
    runSupportsInterfaceTests({
      getContract: () => adapter,
      supportedInterfaceFactories: [
        {
          factory: IProposerAdapterERC721V1__factory,
          inheritedFactories: [IProposerAdapterBaseV1__factory],
        },
        IProposerAdapterBaseV1__factory,
        IVersion__factory,
        IERC165__factory,
        IDeploymentBlockV1__factory,
      ],
    });
  });

  describe('Deployment Block', () => {
    runDeploymentBlockTests({
      getContract: () => adapter,
    });
  });
});
