import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  IDeploymentBlock__factory,
  IKeyValuePairsV1__factory,
  IVersion__factory,
  KeyValuePairsV1,
  KeyValuePairsV1__factory,
} from '../../../typechain-types';
import { runDeploymentBlockTests } from '../shared/deploymentBlockTests';
import { runSupportsInterfaceTests } from '../shared/supportsInterfaceTests';

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
      expect(await keyValuePairs.version()).to.equal(1);
    });
  });

  describe('ERC165 supportsInterface', function () {
    runSupportsInterfaceTests({
      getContract: () => keyValuePairs,
      supportedInterfaceFactories: [
        IKeyValuePairsV1__factory,
        IVersion__factory,
        IDeploymentBlock__factory,
      ],
    });
  });

  describe('Deployment Block', () => {
    runDeploymentBlockTests({
      getContract: () => keyValuePairs,
      isNonUpgradeable: true,
    });
  });
});
