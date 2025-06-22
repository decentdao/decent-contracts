import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { mine } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ConcreteDeploymentBlockNonUpgradeable,
  ConcreteDeploymentBlockNonUpgradeable__factory,
} from '../../typechain-types';

describe('DeploymentBlockNonUpgradeable', () => {
  let deployer: SignerWithAddress;

  let concreteDeploymentBlock: ConcreteDeploymentBlockNonUpgradeable;
  let deploymentBlockNumber: bigint;

  beforeEach(async () => {
    // Get signers
    [deployer] = await ethers.getSigners();

    // Get the current block number before deployment
    const currentBlock = await ethers.provider.getBlockNumber();

    // Deploy the contract directly (no proxy needed for non-upgradeable)
    concreteDeploymentBlock = await new ConcreteDeploymentBlockNonUpgradeable__factory(
      deployer,
    ).deploy();

    // Store the expected deployment block number (should be currentBlock + 1)
    deploymentBlockNumber = BigInt(currentBlock + 1);
  });

  describe('Constructor', () => {
    it('should set the deployment block correctly during construction', async () => {
      expect(await concreteDeploymentBlock.deploymentBlock()).to.equal(deploymentBlockNumber);
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
      const concreteDeploymentBlock2 = await new ConcreteDeploymentBlockNonUpgradeable__factory(
        deployer,
      ).deploy();

      // The deployment blocks should be different
      const block1 = await concreteDeploymentBlock.deploymentBlock();
      const block2 = await concreteDeploymentBlock2.deploymentBlock();

      expect(block2).to.be.gt(block1);
      expect(block2 - block1).to.be.gte(5);
    });
  });
});
