import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC165__factory,
  ISystemDeployerEventEmitterV1__factory,
  IVersion__factory,
  SystemDeployerEventEmitterV1,
  SystemDeployerEventEmitterV1__factory,
} from '../../typechain-types';
import { calculateInterfaceId } from '../helpers/utils';

describe('SystemDeployerEventEmitterV1', function () {
  let systemDeployerEventEmitter: SystemDeployerEventEmitterV1;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let safeProxyFactory: SignerWithAddress;

  beforeEach(async function () {
    [deployer, user, safeProxyFactory] = await ethers.getSigners();
    systemDeployerEventEmitter = await new SystemDeployerEventEmitterV1__factory(deployer).deploy();
  });

  describe('emitSystemDeployed', function () {
    it('should emit SystemDeployed event with correct parameters', async function () {
      const salt = ethers.encodeBytes32String('test-salt');
      const initData = ethers.hexlify(ethers.toUtf8Bytes('test-init-data'));

      await expect(
        systemDeployerEventEmitter
          .connect(user)
          .emitSystemDeployed(safeProxyFactory.address, salt, initData),
      )
        .to.emit(systemDeployerEventEmitter, 'SystemDeployed')
        .withArgs(user.address, safeProxyFactory.address, salt, initData);
    });

    it('should work with empty init data', async function () {
      const salt = ethers.encodeBytes32String('empty-data-salt');
      const initData = '0x';

      await expect(
        systemDeployerEventEmitter
          .connect(user)
          .emitSystemDeployed(safeProxyFactory.address, salt, initData),
      )
        .to.emit(systemDeployerEventEmitter, 'SystemDeployed')
        .withArgs(user.address, safeProxyFactory.address, salt, initData);
    });

    it('should work with different callers', async function () {
      const salt = ethers.encodeBytes32String('different-caller');
      const initData = '0x1234';

      await expect(
        systemDeployerEventEmitter
          .connect(deployer)
          .emitSystemDeployed(safeProxyFactory.address, salt, initData),
      )
        .to.emit(systemDeployerEventEmitter, 'SystemDeployed')
        .withArgs(deployer.address, safeProxyFactory.address, salt, initData);
    });
  });

  describe('version', function () {
    it('should return version 1', async function () {
      expect(await systemDeployerEventEmitter.version()).to.equal(1);
    });
  });

  describe('ERC165 supportsInterface', function () {
    it('should support ISystemDeployerEventEmitterV1 interface', async function () {
      void expect(
        await systemDeployerEventEmitter.supportsInterface(
          calculateInterfaceId(ISystemDeployerEventEmitterV1__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('should support IVersion interface', async function () {
      void expect(
        await systemDeployerEventEmitter.supportsInterface(
          calculateInterfaceId(IVersion__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('should support ERC165 interface', async function () {
      void expect(
        await systemDeployerEventEmitter.supportsInterface(
          calculateInterfaceId(ERC165__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('should not support random interface', async function () {
      void expect(await systemDeployerEventEmitter.supportsInterface('0x12345678')).to.be.false;
    });
  });
});
