import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  DecentAutonomousAdminV1,
  DecentAutonomousAdminV1__factory,
  ERC1967Proxy__factory,
  IDecentAutonomousAdminV1__factory,
  IERC165__factory,
  IVersion__factory,
} from '../../../typechain-types';
import { calculateInterfaceId } from '../../helpers/utils';

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

  describe('ERC165', function () {
    let iDecentAutonomousAdminV1InterfaceId: string;
    let iVersionInterfaceId: string;
    let iERC165InterfaceId: string;

    beforeEach(async function () {
      // Dynamically calculate interface IDs
      const IDecentAutonomousAdminV1Interface = IDecentAutonomousAdminV1__factory.createInterface();
      iDecentAutonomousAdminV1InterfaceId = calculateInterfaceId(IDecentAutonomousAdminV1Interface);

      const IVersionInterface = IVersion__factory.createInterface();
      iVersionInterfaceId = calculateInterfaceId(IVersionInterface);

      const IERC165Interface = IERC165__factory.createInterface();
      iERC165InterfaceId = calculateInterfaceId(IERC165Interface);
    });

    it('Should support IERC165 interface', async function () {
      const supported = await decentAutonomousAdmin.supportsInterface(iERC165InterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IDecentAutonomousAdminV1 interface', async function () {
      const supported = await decentAutonomousAdmin.supportsInterface(
        iDecentAutonomousAdminV1InterfaceId,
      );
      void expect(supported).to.be.true;
    });

    it('Should support IVersion interface', async function () {
      const supported = await decentAutonomousAdmin.supportsInterface(iVersionInterfaceId);
      void expect(supported).to.be.true;
    });

    it('should not support random interface', async function () {
      // Random interface id
      const randomInterfaceId = '0x12345678';

      const supported = await decentAutonomousAdmin.supportsInterface(randomInterfaceId);
      void expect(supported).to.be.false;
    });
  });

  describe('Version', () => {
    it('should return the correct version number', async () => {
      expect(await decentAutonomousAdmin.version()).to.equal(1);
    });
  });
});
