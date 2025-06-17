import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  IDeploymentBlockV1__factory,
  IERC165__factory,
  IProposerAdapterBaseV1__factory,
  IProposerAdapterHatsV1__factory,
  IVersion__factory,
  MockHats,
  MockHats__factory,
  ProposerAdapterHatsV1,
  ProposerAdapterHatsV1__factory,
} from '../../../../../typechain-types';
import { runDeploymentBlockTests } from '../../../../helpers/deploymentBlockTests';
import { calculateInterfaceId } from '../../../../helpers/utils';

async function deployHatsProposerAdapterProxy(
  deployer: SignerWithAddress,
  implementationAddress: string,
  hatsContractAddress: string,
  initialWhitelistedHats: bigint[],
): Promise<ProposerAdapterHatsV1> {
  const adapterInterface = ProposerAdapterHatsV1__factory.createInterface();
  const initializeCalldata = adapterInterface.encodeFunctionData('initialize', [
    hatsContractAddress,
    initialWhitelistedHats,
  ]);
  const proxyFactory = new ERC1967Proxy__factory(deployer);
  const proxy = await proxyFactory.deploy(implementationAddress, initializeCalldata);
  await proxy.waitForDeployment();
  return ProposerAdapterHatsV1__factory.connect(await proxy.getAddress(), deployer);
}

describe('ProposerAdapterHatsV1', () => {
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;

  let adapterImplementation: ProposerAdapterHatsV1;
  let adapter: ProposerAdapterHatsV1;
  let mockHats: MockHats;

  const HAT_ID_1 = 111n;
  const HAT_ID_2 = 222n;

  beforeEach(async () => {
    [deployer, user1] = await ethers.getSigners();

    const mockHatsFactory = new MockHats__factory(deployer);
    mockHats = await mockHatsFactory.deploy();
    await mockHats.waitForDeployment();

    if (!adapterImplementation) {
      const adapterFactory = new ProposerAdapterHatsV1__factory(deployer);
      adapterImplementation = await adapterFactory.deploy();
      await adapterImplementation.waitForDeployment();
    }

    // Deploy with a default whitelisted hat for most tests
    adapter = await deployHatsProposerAdapterProxy(
      deployer,
      await adapterImplementation.getAddress(),
      await mockHats.getAddress(),
      [HAT_ID_1],
    );
  });

  describe('Initialization (via Proxy)', () => {
    it('should initialize correctly with valid parameters', async () => {
      expect(await adapter.hatsContract()).to.equal(await mockHats.getAddress());
      const whitelistedHats = await adapter.whitelistedHatIds();
      expect(whitelistedHats).to.deep.equal([HAT_ID_1]);
    });

    it('should prevent reinitialization on proxied adapter', async () => {
      await expect(
        adapter.initialize(await mockHats.getAddress(), [HAT_ID_1]),
      ).to.be.revertedWithCustomError(adapter, 'InvalidInitialization');
    });

    it('Implementation contract should remain uninitialized', async () => {
      await expect(
        adapterImplementation.initialize(await mockHats.getAddress(), [HAT_ID_1]),
      ).to.be.revertedWithCustomError(adapterImplementation, 'InvalidInitialization');
    });
  });

  describe('isProposer', () => {
    // Adapter is initialized with HAT_ID_1 in beforeEach

    it('should return true if user wears a whitelisted hat', async () => {
      await mockHats.setWearerStatus(user1.address, HAT_ID_1, true);
      const canPropose = await adapter.isProposer(
        user1.address,
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [HAT_ID_1]),
      );
      void expect(canPropose).to.be.true;
    });

    it('should return false if user does not wear any whitelisted hat', async () => {
      await mockHats.setWearerStatus(user1.address, HAT_ID_1, false);
      await mockHats.setWearerStatus(user1.address, HAT_ID_2, true); // Wears a non-whitelisted hat
      const canPropose = await adapter.isProposer(
        user1.address,
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [HAT_ID_1]),
      );
      void expect(canPropose).to.be.false;
    });

    it('should return false if user wears a hat that is not whitelisted', async () => {
      await mockHats.setWearerStatus(user1.address, HAT_ID_2, true); // Wears a non-whitelisted hat
      const canPropose = await adapter.isProposer(
        user1.address,
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [HAT_ID_2]),
      );
      void expect(canPropose).to.be.false;
    });

    it('should return false if user wears no hats', async () => {
      const canPropose = await adapter.isProposer(
        user1.address,
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [HAT_ID_1]),
      );
      void expect(canPropose).to.be.false;
    });

    it('should work with multiple whitelisted hats', async () => {
      const localAdapter = await deployHatsProposerAdapterProxy(
        deployer,
        await adapterImplementation.getAddress(),
        await mockHats.getAddress(),
        [HAT_ID_1, HAT_ID_2],
      );
      await mockHats.setWearerStatus(user1.address, HAT_ID_1, false);
      await mockHats.setWearerStatus(user1.address, HAT_ID_2, true); // Wears the second whitelisted hat
      const canPropose = await localAdapter.isProposer(
        user1.address,
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [HAT_ID_2]),
      );
      void expect(canPropose).to.be.true;
    });

    it('should return false if adapter was initialized with no whitelisted hats', async () => {
      const localAdapter = await deployHatsProposerAdapterProxy(
        deployer,
        await adapterImplementation.getAddress(),
        await mockHats.getAddress(),
        [],
      );
      await mockHats.setWearerStatus(user1.address, HAT_ID_1, true);
      const canPropose = await localAdapter.isProposer(
        user1.address,
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [HAT_ID_1]),
      );
      void expect(canPropose).to.be.false;
    });

    it('should revert if data is not a valid abi-encoded uint256', async () => {
      // Empty data
      await expect(adapter.isProposer(user1.address, '0x')).to.be.reverted;

      // Data too short
      await expect(adapter.isProposer(user1.address, '0x1234')).to.be.reverted;
    });
  });

  describe('IProposerAdapterHatsV1 View Functions', () => {
    it('hatsContract(): should return the correct hats contract address', async () => {
      expect(await adapter.hatsContract()).to.equal(await mockHats.getAddress());
    });

    describe('whitelistedHatIds()', () => {
      it('should return the list of whitelisted hat IDs', async () => {
        expect(await adapter.whitelistedHatIds()).to.deep.equal([HAT_ID_1]);
      });

      it('should return an empty array if initialized with no hats', async () => {
        const localAdapter = await deployHatsProposerAdapterProxy(
          deployer,
          await adapterImplementation.getAddress(),
          await mockHats.getAddress(),
          [], // empty array
        );
        expect(await localAdapter.whitelistedHatIds()).to.deep.equal([]);
      });
    });

    describe('hatIdIsWhitelisted()', () => {
      it('should return true for a whitelisted hat ID', async () => {
        void expect(await adapter.hatIdIsWhitelisted(HAT_ID_1)).to.be.true;
      });

      it('should return false for a non-whitelisted hat ID', async () => {
        void expect(await adapter.hatIdIsWhitelisted(HAT_ID_2)).to.be.false;
      });

      it('should return false for any hat ID if initialized with no hats', async () => {
        const localAdapter = await deployHatsProposerAdapterProxy(
          deployer,
          await adapterImplementation.getAddress(),
          await mockHats.getAddress(),
          [], // empty array
        );
        void expect(await localAdapter.hatIdIsWhitelisted(HAT_ID_1)).to.be.false;
        void expect(await localAdapter.hatIdIsWhitelisted(HAT_ID_2)).to.be.false;
      });
    });
  });

  describe('version', () => {
    it('should return the correct version', async () => {
      expect(await adapter.version()).to.equal(1n);
    });
  });

  describe('ERC165 supportsInterface', () => {
    it('should support IProposerAdapterHatsV1', async () => {
      void expect(
        await adapter.supportsInterface(
          calculateInterfaceId(IProposerAdapterHatsV1__factory.createInterface(), [
            IProposerAdapterBaseV1__factory.createInterface(),
          ]),
        ),
      ).to.be.true;
    });

    it('should support IProposerAdapterBaseV1', async () => {
      void expect(
        await adapter.supportsInterface(
          calculateInterfaceId(IProposerAdapterBaseV1__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('should support IVersion', async () => {
      void expect(
        await adapter.supportsInterface(calculateInterfaceId(IVersion__factory.createInterface())),
      ).to.be.true;
    });

    it('should support IERC165', async () => {
      void expect(
        await adapter.supportsInterface(calculateInterfaceId(IERC165__factory.createInterface())),
      ).to.be.true;
    });

    it('should support IDeploymentBlockV1', async () => {
      void expect(
        await adapter.supportsInterface(
          calculateInterfaceId(IDeploymentBlockV1__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('should not support a random interfaceId', async () => {
      void expect(await adapter.supportsInterface('0x12345678')).to.be.false;
    });
  });

  describe('Deployment Block', () => {
    runDeploymentBlockTests({
      getContract: () => adapter,
    });
  });
});
