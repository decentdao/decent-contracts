import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ConcreteUUPSUpgradeableExtended,
  ConcreteUUPSUpgradeableExtended__factory,
  ERC1967Proxy__factory,
} from '../../typechain-types';

// Helper function for deploying ConcreteUUPSUpgradeableExtended instances using ERC1967Proxy
async function deployConcreteUUPSExtendedProxy(
  proxyDeployer: SignerWithAddress,
  implementation: ConcreteUUPSUpgradeableExtended,
  owner: SignerWithAddress,
): Promise<ConcreteUUPSUpgradeableExtended> {
  // Encode the initialize call
  const initData = ConcreteUUPSUpgradeableExtended__factory.createInterface().encodeFunctionData(
    'initialize',
    [owner.address],
  );

  // Deploy the proxy with the implementation
  const proxy = await new ERC1967Proxy__factory(proxyDeployer).deploy(
    await implementation.getAddress(),
    initData,
  );

  // Return a contract instance connected to the proxy
  return ConcreteUUPSUpgradeableExtended__factory.connect(await proxy.getAddress(), owner);
}

describe('UUPSUpgradeableExtended', function () {
  let owner: SignerWithAddress;
  let nonOwner: SignerWithAddress;
  let proxyDeployer: SignerWithAddress;
  let implementation: ConcreteUUPSUpgradeableExtended;
  let proxy: ConcreteUUPSUpgradeableExtended;

  beforeEach(async function () {
    [proxyDeployer, owner, nonOwner] = await ethers.getSigners();

    // Deploy implementation
    implementation = await new ConcreteUUPSUpgradeableExtended__factory(owner).deploy();

    // Deploy proxy
    proxy = await deployConcreteUUPSExtendedProxy(proxyDeployer, implementation, owner);
  });

  describe('Initialization', function () {
    it('Should initialize with correct owner', async function () {
      expect(await proxy.owner()).to.equal(owner.address);
    });

    it('Should initialize with correct test value', async function () {
      expect(await proxy.testValue()).to.equal(42);
    });

    it('Should have implementation initialization disabled', async function () {
      const implContract = ConcreteUUPSUpgradeableExtended__factory.connect(
        await implementation.getAddress(),
        owner,
      );

      await expect(implContract.initialize(owner.address)).to.be.revertedWithCustomError(
        implContract,
        'InvalidInitialization',
      );
    });

    it('Should not allow reinitialization', async function () {
      await expect(proxy.initialize(nonOwner.address)).to.be.revertedWithCustomError(
        proxy,
        'InvalidInitialization',
      );
    });
  });

  describe('implementation()', function () {
    it('Should return the correct implementation address', async function () {
      expect(await proxy.implementation()).to.equal(await implementation.getAddress());
    });

    it('Should be callable by anyone', async function () {
      const proxyAsNonOwner = proxy.connect(nonOwner);
      expect(await proxyAsNonOwner.implementation()).to.equal(await implementation.getAddress());
    });

    it('Should update after upgrade', async function () {
      // Deploy new implementation
      const newImplementation = await new ConcreteUUPSUpgradeableExtended__factory(owner).deploy();

      // Upgrade to new implementation
      await proxy.upgradeToAndCall(await newImplementation.getAddress(), '0x');

      // Check that implementation() returns the new address
      expect(await proxy.implementation()).to.equal(await newImplementation.getAddress());
    });
  });

  describe('Upgradeability', function () {
    it('Should allow owner to upgrade', async function () {
      const newImplementation = await new ConcreteUUPSUpgradeableExtended__factory(owner).deploy();

      await expect(proxy.upgradeToAndCall(await newImplementation.getAddress(), '0x'))
        .to.emit(proxy, 'Upgraded')
        .withArgs(await newImplementation.getAddress());

      expect(await proxy.implementation()).to.equal(await newImplementation.getAddress());
    });

    it('Should not allow non-owner to upgrade', async function () {
      const newImplementation = await new ConcreteUUPSUpgradeableExtended__factory(owner).deploy();

      const proxyAsNonOwner = proxy.connect(nonOwner);
      await expect(
        proxyAsNonOwner.upgradeToAndCall(await newImplementation.getAddress(), '0x'),
      ).to.be.revertedWithCustomError(proxy, 'OwnableUnauthorizedAccount');
    });

    it('Should maintain state after upgrade', async function () {
      // Set a new test value
      await proxy.setTestValue(123);
      expect(await proxy.testValue()).to.equal(123);

      // Deploy new implementation
      const newImplementation = await new ConcreteUUPSUpgradeableExtended__factory(owner).deploy();

      // Upgrade
      await proxy.upgradeToAndCall(await newImplementation.getAddress(), '0x');

      // Check state is maintained
      expect(await proxy.testValue()).to.equal(123);
    });
  });

  describe('Basic Functionality', function () {
    it('Should allow owner to set test value', async function () {
      await proxy.setTestValue(999);
      expect(await proxy.testValue()).to.equal(999);
    });

    it('Should not allow non-owner to set test value', async function () {
      const proxyAsNonOwner = proxy.connect(nonOwner);
      await expect(proxyAsNonOwner.setTestValue(999)).to.be.revertedWithCustomError(
        proxy,
        'OwnableUnauthorizedAccount',
      );
    });
  });
});
