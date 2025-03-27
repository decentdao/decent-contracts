import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ConcreteVersion,
  ConcreteVersion__factory,
  IERC165__factory,
  IVersion__factory,
} from '../typechain-types';
import { calculateInterfaceId } from './helpers/utils';

describe('Version', () => {
  // Signers
  let deployer: SignerWithAddress;

  // Contracts
  let concreteVersion: ConcreteVersion;

  beforeEach(async () => {
    [deployer] = await ethers.getSigners();

    // Deploy the concrete version implementation
    concreteVersion = await new ConcreteVersion__factory(deployer).deploy();
  });

  describe('Version Identification', () => {
    it('should return version value that matches what was set', async () => {
      const version = 123;

      await concreteVersion.setVersion(version);

      expect(await concreteVersion.getVersion()).to.equal(version);
    });

    it('should update version when setter is called', async () => {
      const oldVersion = 1;
      const newVersion = 2;

      await concreteVersion.setVersion(oldVersion);
      expect(await concreteVersion.getVersion()).to.equal(oldVersion);

      await concreteVersion.setVersion(newVersion);
      expect(await concreteVersion.getVersion()).to.equal(newVersion);
    });
  });

  describe('ERC165', () => {
    let iVersionInterfaceId: string;
    let iERC165InterfaceId: string;

    beforeEach(async () => {
      // Dynamically calculate interface IDs
      const IVersionInterface = IVersion__factory.createInterface();
      iVersionInterfaceId = calculateInterfaceId(IVersionInterface);

      const IERC165Interface = IERC165__factory.createInterface();
      iERC165InterfaceId = calculateInterfaceId(IERC165Interface);
    });

    it('should support IERC165 interface', async () => {
      const supported = await concreteVersion.supportsInterface(iERC165InterfaceId);
      void expect(supported).to.be.true;
    });

    it('should support IVersion interface', async () => {
      const supported = await concreteVersion.supportsInterface(iVersionInterfaceId);
      void expect(supported).to.be.true;
    });

    it('should not support random interface', async () => {
      const randomInterfaceId = '0x12345678';
      const supported = await concreteVersion.supportsInterface(randomInterfaceId);
      void expect(supported).to.be.false;
    });
  });
});
