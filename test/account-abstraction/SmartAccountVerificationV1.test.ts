import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ConcreteSmartAccountVerification,
  ConcreteSmartAccountVerification__factory,
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

async function deploySmartAccountVerification(
  deployer: SignerWithAddress,
  implementation: ConcreteSmartAccountVerification,
  mockLightAccountFactoryAddress: string,
) {
  const initializeCalldata =
    ConcreteSmartAccountVerification__factory.createInterface().encodeFunctionData('initialize', [
      mockLightAccountFactoryAddress,
    ]);

  const moduleProxyFactory = getModuleProxyFactory();
  const salt = ethers.keccak256(ethers.randomBytes(32));

  await moduleProxyFactory.deployModule(
    await implementation.getAddress(),
    initializeCalldata,
    salt,
  );

  const predictedSmartAccountVerificationAddress = await calculateProxyAddress(
    moduleProxyFactory,
    await implementation.getAddress(),
    initializeCalldata,
    salt,
  );

  return ConcreteSmartAccountVerification__factory.connect(
    predictedSmartAccountVerificationAddress,
    deployer,
  );
}

describe('LightAccountVerificationV1', function () {
  // contracts
  let concreteVerification: ConcreteSmartAccountVerification;
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

    // Deploy MockLightAccountVerification
    const concreteVerificationImplementation = await new ConcreteSmartAccountVerification__factory(
      deployer,
    ).deploy();

    concreteVerification = await deploySmartAccountVerification(
      deployer,
      concreteVerificationImplementation,
      mockLightAccountFactory.target.toString(),
    );
  });

  describe('verifySmartAccount', function () {
    describe('valid smart accounts', function () {
      it('should verify valid smart accounts', async function () {
        // set up the mock factory contract to return the correct address to `verifySmartAccount`
        await mockLightAccountFactory.setAccountAddress(
          await mockLightAccount.owner(),
          0n,
          await mockLightAccount.getAddress(),
        );

        void expect(
          await concreteVerification.verifySmartAccountPublic(await mockLightAccount.getAddress()),
        ).to.be.true;
      });
    });

    describe('invalid light accounts', function () {
      describe('non-contracts', function () {
        it('should return false for non-contract addresses', async function () {
          const randomAddress = ethers.Wallet.createRandom().address;

          // Should return false since the address won't have the owner() function
          void expect(await concreteVerification.verifySmartAccountPublic(randomAddress)).to.be
            .false;
        });
      });

      describe('contracts', function () {
        it('should return false for invalid light accounts that do implement the ILightAccount interface (owner())', async function () {
          // not calling "setAccountAddress", so the LightAccountFactory will always
          // return the zero address when calling `getAddress` for a given owner and salt
          // (which is implemented in the LightAccountVerification verifySmartAccount function).
          void expect(
            await concreteVerification.verifySmartAccountPublic(
              await mockLightAccount.getAddress(),
            ),
          ).to.be.false;
        });

        it('should return false for invalid light accounts that do not implement the ILightAccount interface (owner())', async function () {
          // Hits the "catch" block in the `verifySmartAccount` function
          void expect(
            await concreteVerification.verifySmartAccountPublic(
              await mockInvalidLightAccount.getAddress(),
            ),
          ).to.be.false;
        });
      });
    });
  });

  describe('verifySmartAccountAndCallData', function () {
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

      const [target, selector] = await concreteVerification.verifyUserOpPublic(mockUserOp);
      expect(target).to.equal(await mockTarget.getAddress());
      expect(selector).to.equal(FOO_SELECTOR);
    });

    it('should revert with InvalidSmartAccount when sender is not a valid light account', async function () {
      // Not setting up the mock factory to return the correct address
      // This will make verifySmartAccount return false, triggering InvalidSmartAccount

      await expect(
        concreteVerification.verifyUserOpPublic(mockUserOp),
      ).to.be.revertedWithCustomError(concreteVerification, 'InvalidSmartAccount');
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
        concreteVerification.verifyUserOpPublic(invalidUserOp),
      ).to.be.revertedWithCustomError(concreteVerification, 'InvalidUserOpCallDataLength');
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
        concreteVerification.verifyUserOpPublic(unauthorizedUserOp),
      ).to.be.revertedWithCustomError(concreteVerification, 'InvalidCallData');
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

      await expect(concreteVerification.verifyUserOpPublic(userOp)).to.be.revertedWithCustomError(
        concreteVerification,
        'InvalidInnerCallDataLength',
      );
    });
  });
});
