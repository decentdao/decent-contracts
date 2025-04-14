import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ConcreteSmartAccountValidation,
  ConcreteSmartAccountValidation__factory,
  MockGaslessTarget,
  MockGaslessTarget__factory,
  MockInvalidLightAccount,
  MockInvalidLightAccount__factory,
  MockLightAccount,
  MockLightAccount__factory,
  MockLightAccountFactory,
  MockLightAccountFactory__factory,
} from '../../typechain-types';
import { getModuleProxyFactory } from '../GlobalSafeDeployments.test';
import { calculateProxyAddress } from '../helpers';

interface PackedUserOperation {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  accountGasLimits: string;
  preVerificationGas: bigint;
  gasFees: string;
  paymasterAndData: string;
  signature: string;
}

async function deploySmartAccountValidation(
  deployer: SignerWithAddress,
  implementation: ConcreteSmartAccountValidation,
  mockLightAccountFactoryAddress: string,
) {
  const initializeCalldata =
    ConcreteSmartAccountValidation__factory.createInterface().encodeFunctionData('initialize', [
      mockLightAccountFactoryAddress,
    ]);

  const moduleProxyFactory = getModuleProxyFactory();
  const salt = ethers.keccak256(ethers.randomBytes(32));

  await moduleProxyFactory.deployModule(
    await implementation.getAddress(),
    initializeCalldata,
    salt,
  );

  const predictedSmartAccountValidationAddress = await calculateProxyAddress(
    moduleProxyFactory,
    await implementation.getAddress(),
    initializeCalldata,
    salt,
  );

  return ConcreteSmartAccountValidation__factory.connect(
    predictedSmartAccountValidationAddress,
    deployer,
  );
}

describe('SmartAccountValidationV1', function () {
  // contracts
  let concreteSmartAccountValidation: ConcreteSmartAccountValidation;
  let mockLightAccount: MockLightAccount;
  let mockInvalidLightAccount: MockInvalidLightAccount;
  let mockLightAccountFactory: MockLightAccountFactory;

  // signers
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;

  beforeEach(async function () {
    // Get signers
    [deployer, owner] = await ethers.getSigners();

    // Deploy MockLightAccount
    mockLightAccount = await new MockLightAccount__factory(deployer).deploy(owner.address);

    // Deploy MockInvalidLightAccount
    mockInvalidLightAccount = await new MockInvalidLightAccount__factory(deployer).deploy();

    // Deploy MockLightAccountFactory
    mockLightAccountFactory = await new MockLightAccountFactory__factory(deployer).deploy();

    // Deploy ConcreteSmartAccountValidation
    const concreteValidationImplementation = await new ConcreteSmartAccountValidation__factory(
      deployer,
    ).deploy();

    concreteSmartAccountValidation = await deploySmartAccountValidation(
      deployer,
      concreteValidationImplementation,
      mockLightAccountFactory.target.toString(),
    );
  });

  describe('validateSmartAccount', function () {
    describe('valid smart accounts', function () {
      it('should validate valid smart accounts', async function () {
        // set up the mock factory contract to return the correct address to `validateSmartAccount`
        await mockLightAccountFactory.setAccountAddress(
          await mockLightAccount.owner(),
          0n,
          await mockLightAccount.getAddress(),
        );

        const [isValid, lightAccountOwner] =
          await concreteSmartAccountValidation.validateSmartAccountPublic(
            await mockLightAccount.getAddress(),
          );
        void expect(isValid).to.be.true;
        expect(lightAccountOwner).to.equal(await mockLightAccount.owner());
      });
    });

    describe('invalid light accounts', function () {
      describe('non-contracts', function () {
        it('should return false for non-contract addresses', async function () {
          const randomAddress = ethers.Wallet.createRandom().address;

          // Should return false since the address won't have the owner() function
          const [isValid, lightAccountOwner] =
            await concreteSmartAccountValidation.validateSmartAccountPublic(randomAddress);
          void expect(isValid).to.be.false;
          expect(lightAccountOwner).to.equal(ethers.ZeroAddress);
        });
      });

      describe('contracts', function () {
        it('should return false for invalid light accounts that do implement the ILightAccount interface (owner())', async function () {
          // not calling "setAccountAddress", so the LightAccountFactory will always
          // return the zero address when calling `getAddress` for a given owner and salt
          // (which is implemented in the SmartAccountValidation validateSmartAccount function).
          const [isValid, lightAccountOwner] =
            await concreteSmartAccountValidation.validateSmartAccountPublic(
              await mockLightAccount.getAddress(),
            );
          void expect(isValid).to.be.false;
          expect(lightAccountOwner).to.equal(await mockLightAccount.owner());
        });

        it('should return false for invalid light accounts that do not implement the ILightAccount interface (owner())', async function () {
          // Hits the "catch" block in the `validateSmartAccount` function
          const [isValid, lightAccountOwner] =
            await concreteSmartAccountValidation.validateSmartAccountPublic(
              await mockInvalidLightAccount.getAddress(),
            );
          void expect(isValid).to.be.false;
          expect(lightAccountOwner).to.equal(ethers.ZeroAddress);
        });
      });
    });
  });

  describe('validateUserOp', function () {
    let mockUserOp: PackedUserOperation;
    let mockTarget: MockGaslessTarget;
    let FOO_SELECTOR: string;

    beforeEach(async function () {
      // Deploy MockGaslessTarget
      mockTarget = await new MockGaslessTarget__factory(deployer).deploy();

      // Get the foo function selector
      FOO_SELECTOR = mockTarget.interface.getFunction('foo').selector;

      // Create mock UserOperation with properly encoded calldata
      const innerCalldata = mockTarget.interface.encodeFunctionData('foo', [
        123, // uint32 someNumber
        1, // uint8 someFlag
      ]);

      const executeCalldata = mockLightAccount.interface.encodeFunctionData('execute', [
        await mockTarget.getAddress(),
        0n, // value
        innerCalldata,
      ]);

      mockUserOp = {
        sender: await mockLightAccount.getAddress(),
        nonce: 0n,
        initCode: '0x',
        callData: executeCalldata,
        accountGasLimits: ethers.ZeroHash,
        preVerificationGas: 0n,
        gasFees: ethers.ZeroHash,
        paymasterAndData: '0x',
        signature: '0x',
      };
    });

    it('should validate valid calldata from valid light accounts', async function () {
      // Set up the mock factory contract to return the correct address
      await mockLightAccountFactory.setAccountAddress(
        await mockLightAccount.owner(),
        0n,
        await mockLightAccount.getAddress(),
      );

      const [lightAccountOwner, target, selector] =
        await concreteSmartAccountValidation.validateUserOpPublic(mockUserOp);
      expect(lightAccountOwner).to.equal(await mockLightAccount.owner());
      expect(target).to.equal(await mockTarget.getAddress());
      expect(selector).to.equal(FOO_SELECTOR);
    });

    it('should revert with InvalidSmartAccount when sender is not a valid light account', async function () {
      // Not setting up the mock factory to return the correct address
      // This will make validateSmartAccount return false, triggering InvalidSmartAccount

      await expect(
        concreteSmartAccountValidation.validateUserOpPublic(mockUserOp),
      ).to.be.revertedWithCustomError(concreteSmartAccountValidation, 'InvalidSmartAccount');
    });

    it('should revert on invalid calldata length', async function () {
      // Set up the mock factory contract to return the correct address
      await mockLightAccountFactory.setAccountAddress(
        await mockLightAccount.owner(),
        0n,
        await mockLightAccount.getAddress(),
      );

      const invalidCallData = '0x1234'; // Too short
      const invalidUserOp = { ...mockUserOp, callData: invalidCallData };

      await expect(
        concreteSmartAccountValidation.validateUserOpPublic(invalidUserOp),
      ).to.be.revertedWithCustomError(
        concreteSmartAccountValidation,
        'InvalidUserOpCallDataLength',
      );
    });

    it('should revert on unauthorized function calls', async function () {
      // Set up the mock factory contract to return the correct address
      await mockLightAccountFactory.setAccountAddress(
        await mockLightAccount.owner(),
        0n,
        await mockLightAccount.getAddress(),
      );

      const unauthorizedCallData = ethers.concat([
        '0x99999999',
        ethers.zeroPadValue(await mockTarget.getAddress(), 20),
        '0x',
      ]);

      const unauthorizedUserOp = { ...mockUserOp, callData: unauthorizedCallData };

      await expect(
        concreteSmartAccountValidation.validateUserOpPublic(unauthorizedUserOp),
      ).to.be.revertedWithCustomError(concreteSmartAccountValidation, 'InvalidCallData');
    });

    it('should revert with InvalidInnerCallDataLength when inner calldata is too short', async function () {
      // Set up the mock factory contract to return the correct address
      await mockLightAccountFactory.setAccountAddress(
        await mockLightAccount.owner(),
        0n,
        await mockLightAccount.getAddress(),
      );

      // Create execute calldata with too short inner calldata
      const executeCalldata = mockLightAccount.interface.encodeFunctionData('execute', [
        await mockTarget.getAddress(),
        0n, // value
        '0x12', // inner calldata less than 4 bytes
      ]);

      const userOp = { ...mockUserOp, callData: executeCalldata };

      await expect(
        concreteSmartAccountValidation.validateUserOpPublic(userOp),
      ).to.be.revertedWithCustomError(concreteSmartAccountValidation, 'InvalidInnerCallDataLength');
    });
  });
});
