import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  IDeploymentBlockV1__factory,
  IERC165__factory,
  IKYCVerifierV1__factory,
  IVersion__factory,
  KYCVerifierV1,
  KYCVerifierV1__factory,
  MockZKMEVerify,
  MockZKMEVerify__factory,
} from '../../../typechain-types';
import { runDeploymentBlockTests } from '../../helpers/deploymentBlockTests';
import { calculateInterfaceId } from '../../helpers/utils';

// Helper function for deploying Countersign instances using ERC1967Proxy
async function deployKYCVerifierProxy(
  proxyDeployer: SignerWithAddress,
  implementation: string,
  zkMeVerify: string,
  cooperator: string,
): Promise<KYCVerifierV1> {
  // Create initialization data with function selector
  const fullInitData = KYCVerifierV1__factory.createInterface().encodeFunctionData('initialize', [
    zkMeVerify,
    cooperator,
  ]);

  // Deploy the proxy with the implementation
  const proxy = await new ERC1967Proxy__factory(proxyDeployer).deploy(implementation, fullInitData);

  // Return a contract instance connected to the proxy
  return KYCVerifierV1__factory.connect(await proxy.getAddress(), proxyDeployer);
}

describe('KYCVerifierV1', () => {
  // signers
  let investorAlice: SignerWithAddress;
  let cooperator: SignerWithAddress;
  let deployer: SignerWithAddress;

  // contracts
  let kycVerifier: KYCVerifierV1;
  let mockZKMEVerify: MockZKMEVerify;

  beforeEach(async () => {
    // Get signers
    [investorAlice, cooperator, deployer] = await ethers.getSigners();

    // deploy mock ZKMEVerify
    mockZKMEVerify = await new MockZKMEVerify__factory(deployer).deploy();

    // deploy KYC verifier
    const implementation = await new KYCVerifierV1__factory(deployer).deploy();
    kycVerifier = await deployKYCVerifierProxy(
      deployer,
      await implementation.getAddress(),
      await mockZKMEVerify.getAddress(),
      cooperator.address,
    );
  });

  describe('Initialization', () => {
    it('should not allow reinitialization', async () => {
      await expect(
        kycVerifier.initialize(await mockZKMEVerify.getAddress(), cooperator.address),
      ).to.be.revertedWithCustomError(kycVerifier, 'InvalidInitialization');
    });

    it('should return correct zkMeVerify', async () => {
      expect(await kycVerifier.zkMeVerify()).to.equal(await mockZKMEVerify.getAddress());
    });

    it('should return correct cooperator', async () => {
      expect(await kycVerifier.cooperator()).to.equal(cooperator.address);
    });
  });

  describe('Version', () => {
    it('should return the correct version number', async () => {
      expect(await kycVerifier.version()).to.equal(1);
    });
  });

  describe('ERC165', function () {
    // Interface IDs
    let iVersionInterfaceId: string;
    let iKYCVerifierV1InterfaceId: string;
    let iERC165InterfaceId: string;
    beforeEach(async function () {
      // Calculate interface IDs
      const IVersionInterface = IVersion__factory.createInterface();
      iVersionInterfaceId = calculateInterfaceId(IVersionInterface);

      const IKYCVerifierV1Interface = IKYCVerifierV1__factory.createInterface();
      iKYCVerifierV1InterfaceId = calculateInterfaceId(IKYCVerifierV1Interface);

      const IERC165Interface = IERC165__factory.createInterface();
      iERC165InterfaceId = calculateInterfaceId(IERC165Interface);
    });

    it('Should support IERC165 interface', async function () {
      const supported = await kycVerifier.supportsInterface(iERC165InterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IKYCVerifierV1 interface', async function () {
      const supported = await kycVerifier.supportsInterface(iKYCVerifierV1InterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IVersion interface', async function () {
      const supported = await kycVerifier.supportsInterface(iVersionInterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IDeploymentBlockV1 interface', async function () {
      void expect(
        await kycVerifier.supportsInterface(
          calculateInterfaceId(IDeploymentBlockV1__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('Should not support random interface', async function () {
      const randomInterfaceId = '0x12345678';
      const supported = await kycVerifier.supportsInterface(randomInterfaceId);
      void expect(supported).to.be.false;
    });
  });

  describe('Verifications', () => {
    it('should verify if zkMeVerify has approved', async () => {
      await mockZKMEVerify.setApproved(true);
      void expect(await kycVerifier.verify(investorAlice.address)).to.be.true;
    });

    it('should not verify if zkMeVerify has not approved', async () => {
      await mockZKMEVerify.setApproved(false);
      void expect(await kycVerifier.verify(investorAlice.address)).to.be.false;
    });
  });

  describe('Deployment Block', () => {
    runDeploymentBlockTests({
      getContract: () => kycVerifier,
    });
  });
});
