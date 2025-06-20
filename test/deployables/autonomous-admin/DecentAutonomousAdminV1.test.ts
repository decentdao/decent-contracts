import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  DecentAutonomousAdminV1,
  DecentAutonomousAdminV1__factory,
  ERC1967Proxy__factory,
  IDecentAutonomousAdminV1__factory,
  IDeploymentBlockV1__factory,
  IERC165__factory,
  IVersion__factory,
} from '../../../typechain-types';
import { runDeploymentBlockTests } from '../../shared/deploymentBlockTests';
import { runSupportsInterfaceTests } from '../../shared/supportsInterfaceTests';

// Helper function for deploying DecentAutonomousAdminV1 instances using ERC1967Proxy
async function deployDecentAutonomousAdminProxy(
  proxyDeployer: SignerWithAddress,
  implementation: DecentAutonomousAdminV1,
): Promise<DecentAutonomousAdminV1> {
  const initializeCalldata = implementation.interface.encodeFunctionData('initialize');

  // Deploy the proxy with the implementation
  const proxy = await new ERC1967Proxy__factory(proxyDeployer).deploy(
    implementation,
    initializeCalldata,
  );

  // Return a contract instance connected to the proxy
  return DecentAutonomousAdminV1__factory.connect(await proxy.getAddress(), proxyDeployer);
}

describe('DecentAutonomousAdminV1', function () {
  // Signer accounts
  let proxyDeployer: SignerWithAddress;

  // Contract instances
  let decentAutonomousAdmin: DecentAutonomousAdminV1;

  beforeEach(async function () {
    // Get signers
    [proxyDeployer] = await ethers.getSigners();

    // Deploy DecentAutonomousAdminV1 implementation
    const masterCopy = await new DecentAutonomousAdminV1__factory(proxyDeployer).deploy();

    // Deploy DecentAutonomousAdminV1 via proxy
    decentAutonomousAdmin = await deployDecentAutonomousAdminProxy(proxyDeployer, masterCopy);
  });

  describe('ERC165 supportsInterface', function () {
    runSupportsInterfaceTests({
      getContract: () => decentAutonomousAdmin,
      supportedInterfaceFactories: [
        IERC165__factory,
        IDecentAutonomousAdminV1__factory,
        IVersion__factory,
        IDeploymentBlockV1__factory,
      ],
    });
  });

  describe('Version', () => {
    it('should return the correct version number', async () => {
      expect(await decentAutonomousAdmin.version()).to.equal(1);
    });
  });

  describe('Deployment Block', () => {
    runDeploymentBlockTests({
      getContract: () => decentAutonomousAdmin,
    });
  });
});
