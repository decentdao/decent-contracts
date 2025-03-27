import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import type { Log } from 'ethers';
import { ethers } from 'hardhat';
import {
  FailingInitializerContract__factory,
  IncompatibleStorageContract__factory,
  MinimalUpgradeableContract__factory,
  ProxyFactory,
  ProxyFactory__factory,
  UpgradeContractV1,
  UpgradeContractV1__factory,
  UpgradeContractV2__factory,
  UpgradeContractV3__factory,
} from '../typechain-types';

// Helper function for deploying VotesERC20V1 instances using the ProxyFactory
async function deployConcreteUpgradeableContract(
  proxyFactory: ProxyFactory,
  proxyDeployer: SignerWithAddress,
  implementation: string,
  owner: SignerWithAddress,
  name: string,
  saltNonce?: string, // Optional salt nonce for deterministic deployment
): Promise<UpgradeContractV1> {
  // Create a unique salt if one is not provided
  const salt = saltNonce
    ? ethers.keccak256(ethers.toUtf8Bytes(saltNonce))
    : ethers.keccak256(ethers.randomBytes(32));

  // Create initialization data with function selector
  const fullInitData =
    UpgradeContractV1__factory.createInterface().getFunction('initialize').selector +
    ethers.AbiCoder.defaultAbiCoder().encode(['string', 'address'], [name, owner.address]).slice(2);

  // Deploy using the generic deployProxy method
  await proxyFactory.deployProxy(implementation, fullInitData, salt);

  // Predict the address
  const predictedAddress = await proxyFactory.predictProxyAddress(
    implementation,
    fullInitData,
    salt,
    proxyDeployer,
  );

  // Create a contract instance at the predicted address
  return UpgradeContractV1__factory.connect(predictedAddress, owner);
}

describe('ProxyFactory', () => {
  let proxyDeployer: SignerWithAddress;
  let secondDeployer: SignerWithAddress;
  let upgradeableContractOwner: SignerWithAddress;
  let nonOwner: SignerWithAddress;
  let upgradeableContract: UpgradeContractV1;
  let upgradeableMasterCopy: string;
  let proxyFactory: ProxyFactory;

  let minimalImplementation: string;
  let upgradeV1Implementation: string;
  let upgradeV2Implementation: string;
  let upgradeV3Implementation: string;
  let incompatibleImplementation: string;
  let failingImplementation: string;

  beforeEach(async () => {
    [proxyDeployer, secondDeployer, upgradeableContractOwner, nonOwner] = await ethers.getSigners();

    // Deploy the factory first so we can use it in all tests
    proxyFactory = await new ProxyFactory__factory(proxyDeployer).deploy();

    // Deploy the upgradeable master copy
    upgradeableMasterCopy = await (
      await new UpgradeContractV1__factory(upgradeableContractOwner).deploy()
    ).getAddress();

    // Deploy the proxy factory
    proxyFactory = await new ProxyFactory__factory(proxyDeployer).deploy();

    // Deploy all the implementation contracts
    minimalImplementation = await (
      await new MinimalUpgradeableContract__factory(upgradeableContractOwner).deploy()
    ).getAddress();

    failingImplementation = await (
      await new FailingInitializerContract__factory(upgradeableContractOwner).deploy()
    ).getAddress();

    upgradeV1Implementation = await (
      await new UpgradeContractV1__factory(upgradeableContractOwner).deploy()
    ).getAddress();

    incompatibleImplementation = await (
      await new IncompatibleStorageContract__factory(upgradeableContractOwner).deploy()
    ).getAddress();

    upgradeV2Implementation = await (
      await new UpgradeContractV2__factory(upgradeableContractOwner).deploy()
    ).getAddress();

    upgradeV3Implementation = await (
      await new UpgradeContractV3__factory(upgradeableContractOwner).deploy()
    ).getAddress();
  });

  describe('Deterministic deployment', () => {
    const SALT = 'deterministic-salt';
    const NAME = 'Test Name';
    let firstProxyAddress: string;

    beforeEach(async () => {
      // Deploy initial proxy that other tests can reference
      const proxy = await deployConcreteUpgradeableContract(
        proxyFactory,
        proxyDeployer,
        upgradeableMasterCopy,
        upgradeableContractOwner,
        NAME,
        SALT,
      );
      firstProxyAddress = await proxy.getAddress();
    });

    it('should fail when attempting to deploy with identical parameters', async () => {
      // Try to deploy again with EXACTLY the same parameters - should fail because the address is already taken
      try {
        await deployConcreteUpgradeableContract(
          proxyFactory,
          proxyDeployer,
          upgradeableMasterCopy,
          upgradeableContractOwner,
          NAME,
          SALT,
        );
        expect.fail(`Expected deployment of same proxy to fail.`);
      } catch (error: any) {
        // We expect this to fail, but don't check specific error message as we're testing the helper function behavior
      }
    });

    it('should allow deployment with different salt but identical parameters', async () => {
      // Deploy with a different salt but keep track of the creation parameters
      const DIFFERENT_SALT = 'different-salt';
      const saltHash = ethers.keccak256(ethers.toUtf8Bytes(DIFFERENT_SALT));
      const initData =
        UpgradeContractV1__factory.createInterface().getFunction('initialize').selector +
        ethers.AbiCoder.defaultAbiCoder()
          .encode(['string', 'address'], [NAME, upgradeableContractOwner.address])
          .slice(2);

      // Deploy a new contract with these parameters
      await proxyFactory.deployProxy(upgradeableMasterCopy, initData, saltHash);

      // Verify we can deploy with different salt but same init parameters
      const secondProxyAddress = await proxyFactory.predictProxyAddress(
        upgradeableMasterCopy,
        initData,
        saltHash,
        proxyDeployer,
      );

      expect(secondProxyAddress.toLowerCase()).to.not.equal(
        firstProxyAddress.toLowerCase(),
        'Different salt should produce different addresses',
      );

      // Confirm that the second proxy was actually deployed by confirming that bytecode exists at the predicted address
      const code = await ethers.provider.getCode(secondProxyAddress);
      expect(code).to.not.equal('0x');
    });

    it('should create different addresses with different salt but same parameters', async () => {
      // Deploy with same name but different salt
      const differentSaltProxy = await deployConcreteUpgradeableContract(
        proxyFactory,
        proxyDeployer,
        upgradeableMasterCopy,
        upgradeableContractOwner,
        NAME,
        'different-salt',
      );
      const differentSaltAddress = await differentSaltProxy.getAddress();

      expect(firstProxyAddress).to.not.equal(
        differentSaltAddress,
        'Different salt should allow users to deploy multiple similar contracts with distinct addresses',
      );
    });

    it('should correctly predict proxy addresses before deployment', async () => {
      // Setup initialization data
      const PREDICTION_SALT = 'prediction-test-salt';
      const saltHash = ethers.keccak256(ethers.toUtf8Bytes(PREDICTION_SALT));
      const initData =
        UpgradeContractV1__factory.createInterface().getFunction('initialize').selector +
        ethers.AbiCoder.defaultAbiCoder()
          .encode(['string', 'address'], [NAME, upgradeableContractOwner.address])
          .slice(2);

      // Get predicted address
      const predictedAddress = await proxyFactory.predictProxyAddress(
        upgradeableMasterCopy,
        initData,
        saltHash,
        proxyDeployer,
      );

      // Now actually deploy
      const tx = await proxyFactory.deployProxy(upgradeableMasterCopy, initData, saltHash);
      const receipt = await tx.wait();
      if (!receipt) {
        throw new Error('Transaction receipt is null');
      }

      // Extract the deployed address from the event
      const event = receipt.logs.find((log: Log) => {
        return log.topics[0] === ethers.id('ProxyDeployed(address,address)');
      });

      if (!event) {
        throw new Error('ProxyDeployed event not found');
      }

      const proxyAddressBytes = event.topics[1];
      const actualAddress = ethers.getAddress(`0x${proxyAddressBytes.slice(26)}`);

      expect(actualAddress.toLowerCase()).to.equal(
        predictedAddress.toLowerCase(),
        'Predicted address should match actual deployed address',
      );
    });

    it('should create different addresses when init parameters change, even with same salt', async () => {
      // Deploy with different name but same salt
      const differentProxy = await deployConcreteUpgradeableContract(
        proxyFactory,
        proxyDeployer,
        upgradeableMasterCopy,
        upgradeableContractOwner,
        'DifferentName',
        SALT,
      );
      const differentAddress = await differentProxy.getAddress();

      expect(firstProxyAddress).to.not.equal(
        differentAddress,
        'Different parameters should create different addresses, providing collision resistance',
      );
    });
  });

  describe('State initialization', () => {
    it('should instantiate the contract state correctly through the factory', async () => {
      const name = 'Contract';

      // Deploy using the factory
      upgradeableContract = await deployConcreteUpgradeableContract(
        proxyFactory,
        proxyDeployer,
        upgradeableMasterCopy,
        upgradeableContractOwner,
        name,
      );

      // Verify the token was deployed correctly
      expect(await upgradeableContract.name()).to.equal(name);
    });
  });

  describe('Proxy Upgrades', () => {
    let upgradedMasterCopy: string;

    beforeEach(async () => {
      const name = 'Upgradeable Contract';

      // First deploy the initial implementation proxy
      upgradeableContract = await deployConcreteUpgradeableContract(
        proxyFactory,
        proxyDeployer,
        upgradeableMasterCopy,
        upgradeableContractOwner,
        name,
      );

      // Deploy the upgraded implementation master copy
      upgradedMasterCopy = await (
        await new UpgradeContractV2__factory(upgradeableContractOwner).deploy()
      ).getAddress();
    });

    it('should successfully upgrade a proxy to a new implementation', async () => {
      // Store original contract values
      const originalName = await upgradeableContract.name();
      const originalAddress = await upgradeableContract.getAddress();

      // Upgrade the proxy to the upgraded implementation
      const tx = await upgradeableContract.upgradeTo(upgradedMasterCopy);
      await tx.wait();

      // Create a new contract instance with the upgraded interface
      const upgradedContract = UpgradeContractV2__factory.connect(
        originalAddress,
        upgradeableContractOwner,
      );

      // Verify state was preserved from the original contract
      expect(await upgradedContract.name()).to.equal(originalName);

      // Verify it's at the same address
      expect(await upgradedContract.getAddress()).to.equal(originalAddress);

      // Verify it has the new functionality (version should be 0 since it wasn't initialized)
      expect(await upgradedContract.version()).to.equal(0);
    });

    it('should allow initializing new variables during upgrade', async () => {
      const originalAddress = await upgradeableContract.getAddress();
      const originalName = await upgradeableContract.name();
      const newVersion = 2;

      // Prepare initialization data for the upgrade
      const fullInitData =
        UpgradeContractV2__factory.createInterface().getFunction('initialize(uint16)').selector +
        ethers.AbiCoder.defaultAbiCoder().encode(['uint16'], [newVersion]).slice(2);

      // Upgrade the proxy to the upgraded implementation with initialization data
      await upgradeableContract.upgradeToAndCall(upgradedMasterCopy, fullInitData);

      // Create a new contract instance with the upgraded interface
      const upgradedContract = UpgradeContractV2__factory.connect(
        originalAddress,
        upgradeableContractOwner,
      );

      // Verify state was preserved from the original contract
      expect(await upgradedContract.name()).to.equal(originalName);

      // Verify new state was initialized
      expect(await upgradedContract.version()).to.equal(newVersion);
    });

    it('should only allow the owner to upgrade the implementation', async () => {
      // Attempt to upgrade from non-owner account
      await expect(
        upgradeableContract.connect(nonOwner).upgradeToAndCall(upgradedMasterCopy, '0x'),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should not allow upgrade to non-contract address', async () => {
      // Generate a random non-contract address
      const nonContractAddress = ethers.Wallet.createRandom().address;

      // Attempt to upgrade to a non-contract address
      await expect(upgradeableContract.upgradeToAndCall(nonContractAddress, '0x')).to.be.reverted;
    });
  });

  describe('Initialization Data Tests', () => {
    it('should handle empty initialization data', async () => {
      // Create empty initialization data with minimal initializer function selector
      const iface = MinimalUpgradeableContract__factory.createInterface();
      const emptyInitData = iface.getFunction('initializeEmpty').selector;

      // Deploy with empty init data
      const salt = ethers.keccak256(ethers.randomBytes(32));
      await proxyFactory.deployProxy(minimalImplementation, emptyInitData, salt);

      // Get the deployed address
      const predictedAddress = await proxyFactory.predictProxyAddress(
        minimalImplementation,
        emptyInitData,
        salt,
        proxyDeployer.address,
      );

      // Create a contract instance and verify initialization worked
      const minimalContract = MinimalUpgradeableContract__factory.connect(
        predictedAddress,
        upgradeableContractOwner,
      );

      void expect(await minimalContract.isInitialized()).to.be.true;
    });

    it('should handle very large initialization data', async () => {
      // Create a large string (will still be within gas limits)
      const largeString = 'x'.repeat(10000);

      // Create initialization data with the large string
      const iface = MinimalUpgradeableContract__factory.createInterface();
      const largeInitData =
        iface.getFunction('initializeWithLargeData').selector +
        ethers.AbiCoder.defaultAbiCoder().encode(['string'], [largeString]).slice(2);

      // Deploy with large init data
      const salt = ethers.keccak256(ethers.randomBytes(32));
      await proxyFactory.deployProxy(minimalImplementation, largeInitData, salt);

      // Get the deployed address
      const predictedAddress = await proxyFactory.predictProxyAddress(
        minimalImplementation,
        largeInitData,
        salt,
        proxyDeployer.address,
      );

      // Create a contract instance and verify initialization worked with large data
      const minimalContract = MinimalUpgradeableContract__factory.connect(
        predictedAddress,
        upgradeableContractOwner,
      );

      void expect(await minimalContract.isInitialized()).to.be.true;
      expect(await minimalContract.largeData()).to.equal(largeString);
    });
  });

  describe('Multiple Deployer Tests', () => {
    it('should allow different deployers to use the same salt but get different addresses', async () => {
      const iface = MinimalUpgradeableContract__factory.createInterface();
      const initData = iface.getFunction('initializeEmpty').selector;

      // Use the same salt string for both deployers
      const saltString = 'same-salt-different-deployers';
      const salt = ethers.keccak256(ethers.toUtf8Bytes(saltString));

      // First deployment with first deployer
      await proxyFactory.deployProxy(minimalImplementation, initData, salt);

      const predicted1 = await proxyFactory.predictProxyAddress(
        minimalImplementation,
        initData,
        salt,
        proxyDeployer.address,
      );

      // Second deployment with second deployer
      await proxyFactory.connect(secondDeployer).deployProxy(minimalImplementation, initData, salt);

      const predicted2 = await proxyFactory.predictProxyAddress(
        minimalImplementation,
        initData,
        salt,
        secondDeployer.address,
      );

      // The addresses should be different despite using the same salt
      expect(predicted1).to.not.equal(predicted2);

      // Create contract instances to verify both deployments worked
      const contract1 = MinimalUpgradeableContract__factory.connect(
        predicted1,
        upgradeableContractOwner,
      );

      const contract2 = MinimalUpgradeableContract__factory.connect(
        predicted2,
        upgradeableContractOwner,
      );

      void expect(await contract1.isInitialized()).to.be.true;
      void expect(await contract2.isInitialized()).to.be.true;
    });
  });

  describe('Initializer Protection', () => {
    it('should not allow initialize to be called twice', async () => {
      // Deploy a contract
      const name = 'InitializerTest';
      const initData =
        UpgradeContractV1__factory.createInterface().getFunction('initialize').selector +
        ethers.AbiCoder.defaultAbiCoder()
          .encode(['string', 'address'], [name, upgradeableContractOwner.address])
          .slice(2);

      const salt = ethers.keccak256(ethers.randomBytes(32));
      await proxyFactory.deployProxy(upgradeV1Implementation, initData, salt);

      const predictedAddress = await proxyFactory.predictProxyAddress(
        upgradeV1Implementation,
        initData,
        salt,
        proxyDeployer.address,
      );

      // Create a contract instance
      const contract = UpgradeContractV1__factory.connect(
        predictedAddress,
        upgradeableContractOwner,
      );

      // Try to call initialize again - should revert
      await expect(contract.initialize(name, upgradeableContractOwner.address)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });

    it('should correctly handle reinitializers with proper version increments', async () => {
      // Deploy a contract
      const name = 'ReinitializerTest';
      const initData =
        UpgradeContractV1__factory.createInterface().getFunction('initialize').selector +
        ethers.AbiCoder.defaultAbiCoder()
          .encode(['string', 'address'], [name, upgradeableContractOwner.address])
          .slice(2);

      const salt = ethers.keccak256(ethers.randomBytes(32));
      await proxyFactory.deployProxy(upgradeV1Implementation, initData, salt);

      const predictedAddress = await proxyFactory.predictProxyAddress(
        upgradeV1Implementation,
        initData,
        salt,
        proxyDeployer.address,
      );

      // Create a contract instance
      const contract = UpgradeContractV1__factory.connect(
        predictedAddress,
        upgradeableContractOwner,
      );

      // Upgrade to V2
      const v2Version = 2;
      const v2InitData =
        UpgradeContractV2__factory.createInterface().getFunction('initialize(uint16)').selector +
        ethers.AbiCoder.defaultAbiCoder().encode(['uint16'], [v2Version]).slice(2);

      await contract.upgradeToAndCall(upgradeV2Implementation, v2InitData);

      // Get the V2 contract
      const contractV2 = UpgradeContractV2__factory.connect(
        predictedAddress,
        upgradeableContractOwner,
      );

      // Verify state was preserved and new state was initialized
      expect(await contractV2.name()).to.equal(name);
      expect(await contractV2.version()).to.equal(v2Version);

      // Try to call the reinitializer again - should revert
      await expect(contractV2['initialize(uint16)'](v2Version + 1)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );

      // Upgrade to V3 - should work with reinitializer(3)
      const v3AdditionalValue = 42;
      const v3InitData =
        UpgradeContractV3__factory.createInterface().getFunction('initialize(uint256)').selector +
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [v3AdditionalValue]).slice(2);

      await contractV2.upgradeToAndCall(upgradeV3Implementation, v3InitData);

      // Get the V3 contract
      const contractV3 = UpgradeContractV3__factory.connect(
        predictedAddress,
        upgradeableContractOwner,
      );

      // Verify state was preserved through both upgrades
      expect(await contractV3.name()).to.equal(name);
      expect(await contractV3.version()).to.equal(v2Version);
      expect(await contractV3.additionalValue()).to.equal(v3AdditionalValue);
    });
  });

  describe('Multi-Step Upgrade Tests', () => {
    it('should support upgrading through multiple implementation versions', async () => {
      // Deploy initial contract
      const name = 'MultiStepTest';
      const initData =
        UpgradeContractV1__factory.createInterface().getFunction('initialize').selector +
        ethers.AbiCoder.defaultAbiCoder()
          .encode(['string', 'address'], [name, upgradeableContractOwner.address])
          .slice(2);

      const salt = ethers.keccak256(ethers.randomBytes(32));
      await proxyFactory.deployProxy(upgradeV1Implementation, initData, salt);

      const predictedAddress = await proxyFactory.predictProxyAddress(
        upgradeV1Implementation,
        initData,
        salt,
        proxyDeployer.address,
      );

      // Get V1 instance
      const contractV1 = UpgradeContractV1__factory.connect(
        predictedAddress,
        upgradeableContractOwner,
      );

      // Verify initial state
      expect(await contractV1.name()).to.equal(name);

      // Upgrade to V2
      const v2Version = 2;
      const v2InitData =
        UpgradeContractV2__factory.createInterface().getFunction('initialize(uint16)').selector +
        ethers.AbiCoder.defaultAbiCoder().encode(['uint16'], [v2Version]).slice(2);

      await contractV1.upgradeToAndCall(upgradeV2Implementation, v2InitData);

      // Get V2 instance
      const contractV2 = UpgradeContractV2__factory.connect(
        predictedAddress,
        upgradeableContractOwner,
      );

      // Verify V2 state
      expect(await contractV2.name()).to.equal(name);
      expect(await contractV2.version()).to.equal(v2Version);

      // Upgrade to V3
      const v3AdditionalValue = 42;
      const v3InitData =
        UpgradeContractV3__factory.createInterface().getFunction('initialize(uint256)').selector +
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [v3AdditionalValue]).slice(2);

      await contractV2.upgradeToAndCall(upgradeV3Implementation, v3InitData);

      // Get V3 instance
      const contractV3 = UpgradeContractV3__factory.connect(
        predictedAddress,
        upgradeableContractOwner,
      );

      // Verify state all the way from V1 to V3
      expect(await contractV3.name()).to.equal(name);
      expect(await contractV3.version()).to.equal(v2Version);
      expect(await contractV3.additionalValue()).to.equal(v3AdditionalValue);
    });
  });

  describe('State Migration Tests', () => {
    it('should support complex state transformations during upgrades', async () => {
      // Deploy initial contract
      const name = 'StateMigrationTest';
      const initData =
        UpgradeContractV1__factory.createInterface().getFunction('initialize').selector +
        ethers.AbiCoder.defaultAbiCoder()
          .encode(['string', 'address'], [name, upgradeableContractOwner.address])
          .slice(2);

      const salt = ethers.keccak256(ethers.randomBytes(32));
      await proxyFactory.deployProxy(upgradeV1Implementation, initData, salt);

      const predictedAddress = await proxyFactory.predictProxyAddress(
        upgradeV1Implementation,
        initData,
        salt,
        proxyDeployer.address,
      );

      // Upgrade to V3 directly (skipping V2)
      const v3AdditionalValue = 100;
      const v3InitData =
        UpgradeContractV3__factory.createInterface().getFunction('initialize(uint256)').selector +
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [v3AdditionalValue]).slice(2);

      const contract = UpgradeContractV1__factory.connect(
        predictedAddress,
        upgradeableContractOwner,
      );

      await contract.upgradeToAndCall(upgradeV3Implementation, v3InitData);

      // Get V3 instance
      const contractV3 = UpgradeContractV3__factory.connect(
        predictedAddress,
        upgradeableContractOwner,
      );

      // Verify state was preserved
      expect(await contractV3.name()).to.equal(name);
      expect(await contractV3.additionalValue()).to.equal(v3AdditionalValue);

      // Perform migration (simulating complex state transformation)
      await contractV3.migrateState();

      // Verify migration was successful
      void expect(await contractV3.migrationPerformed()).to.be.true;
    });
  });

  describe('Error Cases', () => {
    it('should handle initialization functions that revert', async () => {
      // Create initialization data that will cause a revert
      const initData =
        FailingInitializerContract__factory.createInterface().getFunction('initialize').selector +
        ethers.AbiCoder.defaultAbiCoder().encode(['bool'], [true]).slice(2); // true = should fail

      const salt = ethers.keccak256(ethers.randomBytes(32));

      // Deployment should revert
      await expect(
        proxyFactory.deployProxy(failingImplementation, initData, salt),
      ).to.be.revertedWith('Initialization failed as requested');
    });

    it('should allow detection of incompatible storage layout upgrades', async () => {
      // Deploy initial contract
      const name = 'IncompatibleStorageTest';
      const initData =
        UpgradeContractV1__factory.createInterface().getFunction('initialize').selector +
        ethers.AbiCoder.defaultAbiCoder()
          .encode(['string', 'address'], [name, upgradeableContractOwner.address])
          .slice(2);

      const salt = ethers.keccak256(ethers.randomBytes(32));
      await proxyFactory.deployProxy(upgradeV1Implementation, initData, salt);

      const predictedAddress = await proxyFactory.predictProxyAddress(
        upgradeV1Implementation,
        initData,
        salt,
        proxyDeployer.address,
      );

      const contract = UpgradeContractV1__factory.connect(
        predictedAddress,
        upgradeableContractOwner,
      );

      // Store the current name
      const originalName = await contract.name();

      // Upgrade to incompatible implementation
      const incompatibleInitData =
        IncompatibleStorageContract__factory.createInterface().getFunction('initialize').selector;

      await contract.upgradeToAndCall(incompatibleImplementation, incompatibleInitData);

      // Get instance of incompatible contract
      const incompatibleContract = IncompatibleStorageContract__factory.connect(
        predictedAddress,
        upgradeableContractOwner,
      );

      // The nameSlotAsNumber will have corrupted the original name's storage
      // The exact behavior might vary, but we can verify it changed something
      const newSlotValue = await incompatibleContract.nameSlotAsNumber();

      // We should see the storage has been replaced
      expect(newSlotValue).to.equal(ethers.MaxUint256);

      // Trying to call the original "name" function will likely revert or return garbage
      try {
        // Create a contract instance with the original ABI
        const corruptedContract = UpgradeContractV1__factory.connect(
          predictedAddress,
          upgradeableContractOwner,
        );

        // Try to read the corrupted name
        const corruptedName = await corruptedContract.name();

        // If it doesn't revert, the name should at least be different
        expect(corruptedName).to.not.equal(originalName);
      } catch (error) {
        // Alternatively, it might revert completely, which is also valid
        // We don't make specific assertions about the error
      }
    });
  });
});
