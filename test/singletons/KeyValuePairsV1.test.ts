import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  IDeploymentBlockV1__factory,
  IKeyValuePairsV1__factory,
  IVersion__factory,
  KeyValuePairsV1,
  KeyValuePairsV1__factory,
} from '../../typechain-types';
import { runDeploymentBlockTests } from '../helpers/deploymentBlockTests';
import { calculateInterfaceId } from '../helpers/utils';

describe('KeyValuePairsV1', function () {
  let keyValuePairs: KeyValuePairsV1;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;

  beforeEach(async function () {
    [deployer, user] = await ethers.getSigners();
    keyValuePairs = await new KeyValuePairsV1__factory(deployer).deploy();
  });

  describe('updateValues', function () {
    it('should emit ValueUpdated events for each key-value pair', async function () {
      const keyValuePairsData = [
        { key: 'name', value: 'Alice' },
        { key: 'age', value: '25' },
        { key: 'city', value: 'New York' },
      ];

      await expect(keyValuePairs.connect(user).updateValues(keyValuePairsData))
        .to.emit(keyValuePairs, 'ValueUpdated')
        .withArgs(user.address, 'name', 'Alice')
        .to.emit(keyValuePairs, 'ValueUpdated')
        .withArgs(user.address, 'age', '25')
        .to.emit(keyValuePairs, 'ValueUpdated')
        .withArgs(user.address, 'city', 'New York');
    });

    it('should work with a single key-value pair', async function () {
      const keyValuePairsData = [{ key: 'single', value: 'value' }];

      await expect(keyValuePairs.connect(user).updateValues(keyValuePairsData))
        .to.emit(keyValuePairs, 'ValueUpdated')
        .withArgs(user.address, 'single', 'value');
    });

    it('should work with empty arrays', async function () {
      const keyValuePairsData: { key: string; value: string }[] = [];

      await expect(keyValuePairs.connect(user).updateValues(keyValuePairsData)).to.not.be.reverted;
    });
  });

  describe('version', function () {
    it('should return the correct version', async function () {
      void expect(await keyValuePairs.version()).to.equal(1);
    });
  });

  describe('ERC165 supportsInterface', function () {
    it('should support IKeyValuePairs interface', async function () {
      void expect(
        await keyValuePairs.supportsInterface(
          calculateInterfaceId(IKeyValuePairsV1__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('should support IVersion interface', async function () {
      void expect(
        await keyValuePairs.supportsInterface(
          calculateInterfaceId(IVersion__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('should support IDeploymentBlockV1 interface', async function () {
      void expect(
        await keyValuePairs.supportsInterface(
          calculateInterfaceId(IDeploymentBlockV1__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('should not support a random interfaceId', async function () {
      void expect(await keyValuePairs.supportsInterface('0x12345678')).to.be.false;
    });
  });

  describe('Deployment Block', () => {
    runDeploymentBlockTests({
      getContract: () => keyValuePairs,
      isNonUpgradeable: true,
    });
  });
});
