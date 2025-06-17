import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  FreezeGuardAzoriusV1,
  FreezeGuardAzoriusV1__factory,
  IDeploymentBlockV1__factory,
  IERC165__factory,
  IFreezeGuardAzoriusV1__factory,
  IFreezeGuardBaseV1__factory,
  IGuard__factory,
  IVersion__factory,
  MockFreezeVoting,
  MockFreezeVoting__factory,
} from '../../../typechain-types';
import { runDeploymentBlockTests } from '../../helpers/deploymentBlockTests';
import { calculateInterfaceId } from '../../helpers/utils';
import { runUUPSUpgradeabilityTests } from '../../helpers/uupsUpgradeabilityTests';

// Helper function for deploying AzoriusFreezeGuardV1 instances using ERC1967Proxy
async function deployAzoriusFreezeGuardProxy(
  proxyDeployer: SignerWithAddress,
  implementation: string,
  owner: SignerWithAddress,
  freezeVoting: string,
): Promise<FreezeGuardAzoriusV1> {
  // Create initialization data with function selector
  const fullInitData = FreezeGuardAzoriusV1__factory.createInterface().encodeFunctionData(
    'initialize',
    [owner.address, freezeVoting],
  );

  // Deploy the proxy with the implementation
  const proxy = await new ERC1967Proxy__factory(proxyDeployer).deploy(implementation, fullInitData);

  // Return a contract instance connected to the proxy
  return FreezeGuardAzoriusV1__factory.connect(await proxy.getAddress(), owner);
}

describe('FreezeGuardAzoriusV1', () => {
  const Operation = {
    Call: 0,
    DelegateCall: 1,
  };

  // signers
  let proxyDeployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let nonOwner: SignerWithAddress;

  // contracts
  let masterCopy: string;
  let azoriusFreezeGuard: FreezeGuardAzoriusV1;
  let mockFreezeVoting: MockFreezeVoting;

  beforeEach(async () => {
    // Get signers
    [proxyDeployer, owner, user, nonOwner] = await ethers.getSigners();

    // Deploy implementation
    const implementation = await new FreezeGuardAzoriusV1__factory(proxyDeployer).deploy();
    masterCopy = await implementation.getAddress();

    // Deploy mock contracts
    mockFreezeVoting = await new MockFreezeVoting__factory(owner).deploy();
  });

  describe('Initialization', () => {
    it('should initialize with correct owner and freezeVoting address', async () => {
      azoriusFreezeGuard = await deployAzoriusFreezeGuardProxy(
        proxyDeployer,
        masterCopy,
        owner,
        await mockFreezeVoting.getAddress(),
      );

      expect(await azoriusFreezeGuard.owner()).to.equal(owner.address);
      expect(await azoriusFreezeGuard.freezeVoting()).to.equal(await mockFreezeVoting.getAddress());
    });

    it('should not allow reinitialization', async () => {
      azoriusFreezeGuard = await deployAzoriusFreezeGuardProxy(
        proxyDeployer,
        masterCopy,
        owner,
        await mockFreezeVoting.getAddress(),
      );

      await expect(
        azoriusFreezeGuard.initialize(user.address, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(azoriusFreezeGuard, 'InvalidInitialization');
    });

    it('Should have initialization disabled in the implementation', async function () {
      const implementationContract = FreezeGuardAzoriusV1__factory.connect(
        masterCopy,
        proxyDeployer,
      );

      await expect(
        implementationContract.initialize(owner.address, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(implementationContract, 'InvalidInitialization');
    });
  });

  describe('Ownership', function () {
    beforeEach(async () => {
      azoriusFreezeGuard = await deployAzoriusFreezeGuardProxy(
        proxyDeployer,
        masterCopy,
        owner,
        await mockFreezeVoting.getAddress(),
      );
    });

    it('Should allow owner to call owner-only functions', async function () {
      // The transfer ownership function is an example of an owner-only function
      await azoriusFreezeGuard.connect(owner).transferOwnership(user.address);
      await azoriusFreezeGuard.connect(user).acceptOwnership();
      expect(await azoriusFreezeGuard.owner()).to.equal(user.address);
    });

    it('Should prevent non-owners from calling owner-only functions', async function () {
      await expect(
        azoriusFreezeGuard.connect(user).transferOwnership(user.address),
      ).to.be.revertedWithCustomError(azoriusFreezeGuard, 'OwnableUnauthorizedAccount');
    });
  });

  describe('Transaction Checking', () => {
    beforeEach(async () => {
      // Deploy the guard with the mock freeze voting
      azoriusFreezeGuard = await deployAzoriusFreezeGuardProxy(
        proxyDeployer,
        masterCopy,
        owner,
        await mockFreezeVoting.getAddress(),
      );
    });

    it('should allow transactions when DAO is not frozen', async () => {
      // Set the mock to return false for isFrozen
      await mockFreezeVoting.setIsFrozen(false);

      // Should not revert when checking transaction
      await expect(
        azoriusFreezeGuard.checkTransaction(
          ethers.ZeroAddress, // to
          0, // value
          '0x', // data
          Operation.Call, // operation
          0, // safeTxGas
          0, // baseGas
          0, // gasPrice
          ethers.ZeroAddress, // gasToken
          ethers.ZeroAddress, // refundReceiver
          '0x', // signatures
          ethers.ZeroAddress, // msgSender
        ),
      ).not.to.be.reverted;
    });

    it('should revert transactions when DAO is frozen', async () => {
      // Set the mock to return true for isFrozen
      await mockFreezeVoting.setIsFrozen(true);

      // Should revert with DAOFrozen
      await expect(
        azoriusFreezeGuard.checkTransaction(
          ethers.ZeroAddress, // to
          0, // value
          '0x', // data
          Operation.Call, // operation
          0, // safeTxGas
          0, // baseGas
          0, // gasPrice
          ethers.ZeroAddress, // gasToken
          ethers.ZeroAddress, // refundReceiver
          '0x', // signatures
          ethers.ZeroAddress, // msgSender
        ),
      ).to.be.revertedWithCustomError(azoriusFreezeGuard, 'DAOFrozen');
    });

    it('should not perform any checks after execution', async () => {
      // checkAfterExecution should not revert or do anything
      await expect(azoriusFreezeGuard.checkAfterExecution(ethers.randomBytes(32), true)).not.to.be
        .reverted;
    });
  });

  describe('Version', () => {
    beforeEach(async () => {
      azoriusFreezeGuard = await deployAzoriusFreezeGuardProxy(
        proxyDeployer,
        masterCopy,
        owner,
        await mockFreezeVoting.getAddress(),
      );
    });

    // Use the shared version test utility
    it('should return the correct version number', async () => {
      expect(await azoriusFreezeGuard.version()).to.equal(1);
    });
  });

  describe('ERC165', function () {
    beforeEach(async function () {
      azoriusFreezeGuard = await deployAzoriusFreezeGuardProxy(
        proxyDeployer,
        masterCopy,
        owner,
        await mockFreezeVoting.getAddress(),
      );
    });

    it('Should support IERC165 interface', async function () {
      void expect(
        await azoriusFreezeGuard.supportsInterface(
          calculateInterfaceId(IERC165__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('Should support IVersion interface', async function () {
      void expect(
        await azoriusFreezeGuard.supportsInterface(
          calculateInterfaceId(IVersion__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('Should support IFreezeGuardAzoriusV1 interface', async function () {
      void expect(
        await azoriusFreezeGuard.supportsInterface(
          calculateInterfaceId(IFreezeGuardAzoriusV1__factory.createInterface(), [
            IFreezeGuardBaseV1__factory.createInterface(),
            IGuard__factory.createInterface(),
          ]),
        ),
      ).to.be.true;
    });

    it('Should support IFreezeGuardBaseV1 interface', async function () {
      void expect(
        await azoriusFreezeGuard.supportsInterface(
          calculateInterfaceId(IFreezeGuardBaseV1__factory.createInterface(), [
            IGuard__factory.createInterface(),
          ]),
        ),
      ).to.be.true;
    });

    it('Should support IGuard interface', async function () {
      void expect(
        await azoriusFreezeGuard.supportsInterface(
          calculateInterfaceId(IGuard__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('Should support IDeploymentBlockV1 interface', async function () {
      void expect(
        await azoriusFreezeGuard.supportsInterface(
          calculateInterfaceId(IDeploymentBlockV1__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('Should not support random interface', async function () {
      void expect(await azoriusFreezeGuard.supportsInterface('0x12345678')).to.be.false;
    });
  });

  describe('AzoriusFreezeGuardV1 UUPS Upgradeability', function () {
    beforeEach(async function () {
      // Deploy proxy
      azoriusFreezeGuard = await deployAzoriusFreezeGuardProxy(
        proxyDeployer,
        masterCopy,
        owner,
        await mockFreezeVoting.getAddress(),
      );
    });

    // Run UUPS upgradeability tests
    runUUPSUpgradeabilityTests({
      getContract: () => azoriusFreezeGuard,
      createNewImplementation: async () => {
        const newImplementation = await new FreezeGuardAzoriusV1__factory(owner).deploy();
        return newImplementation;
      },
      owner: () => owner,
      nonOwner: () => nonOwner,
    });
  });

  describe('Deployment Block', () => {
    beforeEach(async function () {
      azoriusFreezeGuard = await deployAzoriusFreezeGuardProxy(
        proxyDeployer,
        masterCopy,
        owner,
        await mockFreezeVoting.getAddress(),
      );
    });

    runDeploymentBlockTests({
      getContract: () => azoriusFreezeGuard,
    });
  });
});
