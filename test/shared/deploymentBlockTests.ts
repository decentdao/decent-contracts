import { mine } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { IDeploymentBlockV1 } from '../../typechain-types';

/**
 * Shared test utilities for testing the DeploymentBlock functionality
 * Used by all contracts that implement IDeploymentBlockV1
 */

/**
 * Parameters for running the DeploymentBlock tests
 */
interface DeploymentBlockTestParams {
  /**
   * Gets the current contract instance implementing IDeploymentBlockV1
   */
  getContract: () => IDeploymentBlockV1;

  /**
   * Expected deployment block number
   * If not provided, will be determined automatically during test setup
   */
  expectedBlockNumber?: bigint;

  /**
   * Whether this is a non-upgradeable contract (using immutable storage)
   * Default is false (assumes upgradeable contract)
   */
  isNonUpgradeable?: boolean;
}

/**
 * Run all the deployment block tests on the given contract
 * @param params The test parameters
 */
export function runDeploymentBlockTests(params: DeploymentBlockTestParams): void {
  it('should have deployment block set', async () => {
    const contract = params.getContract();
    const deploymentBlock = await contract.deploymentBlock();

    // Check that deployment block is not zero
    // Zero would indicate that __DeploymentBlockV1_init() was not called
    expect(deploymentBlock).to.be.gt(
      0,
      'Deployment block should not be zero - was __DeploymentBlockV1_init() called?',
    );
  });

  it('should return a reasonable deployment block number', async () => {
    const contract = params.getContract();
    const deploymentBlock = await contract.deploymentBlock();
    const currentBlock = await ethers.provider.getBlockNumber();

    // Deployment block should be:
    // 1. Greater than 0
    // 2. Less than or equal to current block number
    expect(deploymentBlock).to.be.gt(0, 'Deployment block should be greater than 0');
    expect(deploymentBlock).to.be.lte(currentBlock, 'Deployment block should not be in the future');

    // If expectedBlockNumber was provided, check it matches exactly
    if (params.expectedBlockNumber !== undefined) {
      expect(deploymentBlock).to.equal(
        params.expectedBlockNumber,
        'Deployment block should match expected value',
      );
    }
  });

  it('should not change after mining additional blocks', async () => {
    const contract = params.getContract();
    const initialDeploymentBlock = await contract.deploymentBlock();

    // Mine several blocks
    await mine(10);

    const afterMiningDeploymentBlock = await contract.deploymentBlock();

    // The deployment block should remain the same
    expect(afterMiningDeploymentBlock).to.equal(
      initialDeploymentBlock,
      'Deployment block should not change after mining blocks',
    );
  });

  if (params.isNonUpgradeable) {
    it('should use immutable storage (non-upgradeable contracts)', async () => {
      // This test is specific to non-upgradeable contracts that use the `immutable` keyword
      // For upgradeable contracts, the deployment block is stored in proxy storage and
      // will NOT change during upgrades - the proxy's storage persists across upgrades
      const contract = params.getContract();

      const calls = await Promise.all([
        contract.deploymentBlock(),
        contract.deploymentBlock(),
        contract.deploymentBlock(),
      ]);

      // All calls should return the same value
      expect(calls[0]).to.equal(calls[1]);
      expect(calls[1]).to.equal(calls[2]);
      expect(calls[0]).to.be.gt(0);
    });
  }
}
