import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { UUPSUpgradeable, UUPSUpgradeable__factory } from '../../typechain-types';

/**
 * Shared test utilities for testing the UUPS upgradeability functionality
 * Used by all contracts that implement UUPSUpgradeable
 */

/**
 * Parameters for running the UUPS Upgradeability tests
 */
interface UUPSUpgradeabilityTestParams {
  /**
   * Gets the current contract instance implementing UUPSUpgradeable
   */
  getContract: () => UUPSUpgradeable;

  /**
   * Creates a new implementation of the contract
   */
  createNewImplementation: () => Promise<UUPSUpgradeable>;

  /**
   * Owner account that should be allowed to upgrade
   */
  owner: () => SignerWithAddress;

  /**
   * Non-owner account that should not be allowed to upgrade
   */
  nonOwner: () => SignerWithAddress;

  /**
   * Error message to expect when a non-owner tries to upgrade
   * Default is 'OwnableUnauthorizedAccount'
   */
  unauthorizedErrorMessage?: string;
}

/**
 * Run all the UUPS upgradeability tests on the given contract
 * @param params The test parameters
 */
export function runUUPSUpgradeabilityTests(params: UUPSUpgradeabilityTestParams): void {
  it('should allow the owner to authorize an upgrade', async () => {
    // Deploy a new implementation
    const newImplementation = await params.createNewImplementation();
    const newImplAddress = await newImplementation.getAddress();

    // Get contract and connect owner
    const contract = params.getContract();
    const contractAddress = await contract.getAddress();
    const upgradeableContract = UUPSUpgradeable__factory.connect(contractAddress, params.owner());

    // Call with empty bytes for the second parameter
    // We don't check for a specific event since some implementations might emit different events,
    // but we do check that it doesn't revert
    await expect(upgradeableContract.upgradeToAndCall(newImplAddress, '0x')).to.not.be.reverted;
  });

  it('should not allow non-owners to authorize an upgrade', async () => {
    // Deploy a new implementation
    const newImplementation = await params.createNewImplementation();
    const newImplAddress = await newImplementation.getAddress();

    // Get contract and connect non-owner
    const contract = params.getContract();
    const contractAddress = await contract.getAddress();
    const upgradeableContract = UUPSUpgradeable__factory.connect(
      contractAddress,
      params.nonOwner(),
    );

    // Call upgradeToAndCall as a non-owner - should be reverted
    await expect(upgradeableContract.upgradeToAndCall(newImplAddress, '0x')).to.be.reverted;
  });
}
