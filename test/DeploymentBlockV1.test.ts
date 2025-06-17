import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { mine } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ConcreteDeploymentBlockV1,
  ConcreteDeploymentBlockV1__factory,
  ERC1967Proxy__factory,
} from '../typechain-types';

describe('DeploymentBlockV1', () => {
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;

  let concreteDeploymentBlock: ConcreteDeploymentBlockV1;
  let masterCopy: string;
  let deploymentBlockNumber: bigint;

  beforeEach(async () => {
    // Get signers
    [deployer, owner] = await ethers.getSigners();

    // Deploy master copy
    masterCopy = await (
      await new ConcreteDeploymentBlockV1__factory(deployer).deploy()
    ).getAddress();

    // Get the current block number before deployment
    const currentBlock = await ethers.provider.getBlockNumber();

    // Deploy proxy with initialization
    const initData =
      ConcreteDeploymentBlockV1__factory.createInterface().encodeFunctionData('initialize');
    const proxy = await new ERC1967Proxy__factory(deployer).deploy(masterCopy, initData);

    // Connect to the proxy
    concreteDeploymentBlock = ConcreteDeploymentBlockV1__factory.connect(
      await proxy.getAddress(),
      owner,
    );

    // Store the expected deployment block number (should be currentBlock + 1)
    deploymentBlockNumber = BigInt(currentBlock + 1);
  });

  describe('Initialization', () => {
    it('should set the deployment block correctly during initialization', async () => {
      expect(await concreteDeploymentBlock.deploymentBlock()).to.equal(deploymentBlockNumber);
    });

    it('should not allow reinitialization', async () => {
      await expect(concreteDeploymentBlock.initialize()).to.be.revertedWithCustomError(
        concreteDeploymentBlock,
        'InvalidInitialization',
      );
    });

    it('should have initialization disabled in the implementation', async () => {
      const implementationContract = ConcreteDeploymentBlockV1__factory.connect(
        masterCopy,
        deployer,
      );

      await expect(implementationContract.initialize()).to.be.revertedWithCustomError(
        implementationContract,
        'InvalidInitialization',
      );
    });
  });

  describe('deploymentBlock', () => {
    it('should return the correct deployment block number', async () => {
      const storedBlock = await concreteDeploymentBlock.deploymentBlock();
      expect(storedBlock).to.equal(deploymentBlockNumber);
    });

    it('should not change after mining additional blocks', async () => {
      // Mine some blocks
      await mine(10);

      // The deployment block should remain the same
      const storedBlock = await concreteDeploymentBlock.deploymentBlock();
      expect(storedBlock).to.equal(deploymentBlockNumber);
    });

    it('should be different for different contract instances', async () => {
      // Mine some blocks to ensure different deployment blocks
      await mine(5);

      // Deploy a second instance
      const initData =
        ConcreteDeploymentBlockV1__factory.createInterface().encodeFunctionData('initialize');
      const proxy2 = await new ERC1967Proxy__factory(deployer).deploy(masterCopy, initData);
      const concreteDeploymentBlock2 = ConcreteDeploymentBlockV1__factory.connect(
        await proxy2.getAddress(),
        owner,
      );

      // The deployment blocks should be different
      const block1 = await concreteDeploymentBlock.deploymentBlock();
      const block2 = await concreteDeploymentBlock2.deploymentBlock();

      expect(block2).to.be.gt(block1);
      expect(block2 - block1).to.be.gte(5);
    });
  });

  describe('Reinitializer Protection', () => {
    it('should prevent changing deployment block via reinitializer', async () => {
      // Deploy master copy
      masterCopy = await (
        await new ConcreteDeploymentBlockV1__factory(deployer).deploy()
      ).getAddress();

      // Deploy proxy with initialization
      const initData =
        ConcreteDeploymentBlockV1__factory.createInterface().encodeFunctionData('initialize');
      const proxy = await new ERC1967Proxy__factory(deployer).deploy(masterCopy, initData);

      // Connect to the proxy
      const contract = ConcreteDeploymentBlockV1__factory.connect(await proxy.getAddress(), owner);

      // Get the initial deployment block
      const initialDeploymentBlock = await contract.deploymentBlock();
      expect(initialDeploymentBlock).to.be.gt(0);

      // Try to reinitialize - this should fail with our new protection
      await expect(contract.reinitialize()).to.be.revertedWithCustomError(
        contract,
        'DeploymentBlockAlreadySet',
      );

      // Verify deployment block hasn't changed
      const currentDeploymentBlock = await contract.deploymentBlock();
      expect(currentDeploymentBlock).to.equal(initialDeploymentBlock);
    });
  });
});
