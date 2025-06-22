import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  IDeploymentBlock__factory,
  IERC165__factory,
  IKYCVerifierV1__factory,
  IVersion__factory,
  KYCVerifierV1,
  KYCVerifierV1__factory,
} from '../../../../typechain-types';
import { runDeploymentBlockTests } from '../../shared/deploymentBlockTests';
import { runSupportsInterfaceTests } from '../../shared/supportsInterfaceTests';

// Helper function for deploying Countersign instances using ERC1967Proxy
async function deployKYCVerifierProxy(
  proxyDeployer: SignerWithAddress,
  implementation: string,
): Promise<KYCVerifierV1> {
  // Create initialization data with function selector
  const fullInitData = KYCVerifierV1__factory.createInterface().encodeFunctionData('initialize');

  // Deploy the proxy with the implementation
  const proxy = await new ERC1967Proxy__factory(proxyDeployer).deploy(implementation, fullInitData);

  // Return a contract instance connected to the proxy
  return KYCVerifierV1__factory.connect(await proxy.getAddress(), proxyDeployer);
}

describe('KYCVerifierV1', () => {
  // signers
  let investorAlice: SignerWithAddress;
  let deployer: SignerWithAddress;

  // contracts
  let kycVerifier: KYCVerifierV1;

  beforeEach(async () => {
    // Get signers
    [investorAlice, deployer] = await ethers.getSigners();

    // deploy KYC verifier
    const implementation = await new KYCVerifierV1__factory(deployer).deploy();
    kycVerifier = await deployKYCVerifierProxy(deployer, await implementation.getAddress());
  });

  describe('Initialization', () => {
    it('should not allow reinitialization', async () => {
      await expect(kycVerifier.initialize()).to.be.revertedWithCustomError(
        kycVerifier,
        'InvalidInitialization',
      );
    });
  });

  describe('Version', () => {
    it('should return the correct version number', async () => {
      expect(await kycVerifier.version()).to.equal(1);
    });
  });

  describe('ERC165 supportsInterface', function () {
    runSupportsInterfaceTests({
      getContract: () => kycVerifier,
      supportedInterfaceFactories: [
        IERC165__factory,
        IKYCVerifierV1__factory,
        IVersion__factory,
        IDeploymentBlock__factory,
      ],
    });
  });

  describe('Verifications', () => {
    it('should verify', async () => {
      expect(await kycVerifier.verify(investorAlice.address)).to.be.true;
    });
  });

  describe('Deployment Block', () => {
    runDeploymentBlockTests({
      getContract: () => kycVerifier,
    });
  });
});
