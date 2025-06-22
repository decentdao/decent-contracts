import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ConcreteLightAccountValidator,
  ConcreteLightAccountValidator__factory,
  ERC1967Proxy__factory,
  MockGaslessTarget,
  MockGaslessTarget__factory,
  MockInvalidLightAccount,
  MockInvalidLightAccount__factory,
  MockLightAccount,
  MockLightAccount__factory,
  MockLightAccountFactory,
  MockLightAccountFactory__factory,
} from '../../../../typechain-types';

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

async function deployLightAccountValidator(
  deployer: SignerWithAddress,
  implementation: ConcreteLightAccountValidator,
  mockLightAccountFactoryAddress: string,
) {
  // Create full initialization data with function selector
  const fullInitData = ConcreteLightAccountValidator__factory.createInterface().encodeFunctionData(
    'initialize',
    [mockLightAccountFactoryAddress],
  );

  // Deploy the proxy with the implementation
  const proxy = await new ERC1967Proxy__factory(deployer).deploy(implementation, fullInitData);

  return ConcreteLightAccountValidator__factory.connect(await proxy.getAddress(), deployer);
}

describe('LightAccountValidator', function () {
  // contracts
  let concreteLightAccountValidator: ConcreteLightAccountValidator;
  let mockLightAccount: MockLightAccount;
  let mockInvalidLightAccount: MockInvalidLightAccount;
  let mockLightAccountFactory: MockLightAccountFactory;

  // signers
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;

  beforeEach(async function () {
    // Get signers
    [deployer, owner, user] = await ethers.getSigners();

    // Deploy MockLightAccount
    mockLightAccount = await new MockLightAccount__factory(deployer).deploy(owner.address);

    // Deploy MockInvalidLightAccount
    mockInvalidLightAccount = await new MockInvalidLightAccount__factory(deployer).deploy();

    // Deploy MockLightAccountFactory
    mockLightAccountFactory = await new MockLightAccountFactory__factory(deployer).deploy();

    // Deploy ConcreteSmartAccountValidation
    const concreteValidationImplementation = await new ConcreteLightAccountValidator__factory(
      deployer,
    ).deploy();

    concreteLightAccountValidator = await deployLightAccountValidator(
      deployer,
      concreteValidationImplementation,
      mockLightAccountFactory.target.toString(),
    );
  });

  describe('validateLightAccount', function () {
    describe('When the light account is valid', function () {
      it('should return true and the owner address', async function () {
        // set up the mock factory contract to return the correct address to `validateSmartAccount`
        await mockLightAccountFactory.setAccountAddress(
          await mockLightAccount.owner(),
          0n,
          await mockLightAccount.getAddress(),
        );

        const [isValid, lightAccountOwner] =
          await concreteLightAccountValidator.validateLightAccountPublic(
            await mockLightAccount.getAddress(),
            0n,
          );
        expect(isValid).to.be.true;
        expect(lightAccountOwner).to.equal(await mockLightAccount.owner());
      });
    });

    describe('When the light account is invalid', function () {
      describe('When the address is not a contract', function () {
        it('should return false and the zero address', async function () {
          const randomAddress = ethers.Wallet.createRandom().address;

          // Should return false since the address won't have the owner() function
          const [isValid, lightAccountOwner] =
            await concreteLightAccountValidator.validateLightAccountPublic(randomAddress, 0n);
          expect(isValid).to.be.false;
          expect(lightAccountOwner).to.equal(ethers.ZeroAddress);
        });
      });

      describe('When the address is a contract', function () {
        it('should return false when factory check fails', async function () {
          // not calling "setAccountAddress", so the LightAccountFactory will always
          // return the zero address when calling `getAddress` for a given owner and salt
          // (which is implemented in the SmartAccountValidation validateSmartAccount function).
          const [isValid, lightAccountOwner] =
            await concreteLightAccountValidator.validateLightAccountPublic(
              await mockLightAccount.getAddress(),
              0n,
            );
          expect(isValid).to.be.false;
          expect(lightAccountOwner).to.equal(await mockLightAccount.owner());
        });

        it('should return false when owner() call reverts', async function () {
          // Hits the "catch" block in the `validateSmartAccount` function
          const [isValid, lightAccountOwner] =
            await concreteLightAccountValidator.validateLightAccountPublic(
              await mockInvalidLightAccount.getAddress(),
              0n,
            );
          expect(isValid).to.be.false;
          expect(lightAccountOwner).to.equal(ethers.ZeroAddress);
        });
      });
    });
  });

  describe('validateUserOp', function () {
    let mockUserOp: PackedUserOperation;
    let mockTarget: MockGaslessTarget;
    let FOO_SELECTOR: string;
    let expectedInnerCallData: string;

    beforeEach(async function () {
      // Deploy MockGaslessTarget
      mockTarget = await new MockGaslessTarget__factory(deployer).deploy();

      // Get the foo function selector
      FOO_SELECTOR = mockTarget.interface.getFunction('foo').selector;

      // Create mock UserOperation with properly encoded calldata
      expectedInnerCallData = mockTarget.interface.encodeFunctionData('foo', [
        123, // uint32 someNumber
        1, // uint8 someFlag
      ]);

      const executeCalldata = mockLightAccount.interface.encodeFunctionData('execute', [
        await mockTarget.getAddress(),
        0n, // value
        expectedInnerCallData,
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

    it('should return owner, target, and selector for valid UserOps', async function () {
      // Set up the mock factory contract to return the correct address
      await mockLightAccountFactory.setAccountAddress(
        await mockLightAccount.owner(),
        0n,
        await mockLightAccount.getAddress(),
      );

      const [lightAccountOwner, target, returnedInnerCallData] =
        await concreteLightAccountValidator.validateUserOpPublic(mockUserOp);
      expect(lightAccountOwner).to.equal(await mockLightAccount.owner());
      expect(target).to.equal(await mockTarget.getAddress());
      expect(returnedInnerCallData.slice(0, 10)).to.equal(FOO_SELECTOR);
      expect(returnedInnerCallData).to.equal(expectedInnerCallData);
    });

    it('should revert when the sender is not a valid light account', async function () {
      // Not setting up the mock factory to return the correct address
      // This will make validateSmartAccount return false, triggering InvalidSmartAccount

      await expect(
        concreteLightAccountValidator.validateUserOpPublic(mockUserOp),
      ).to.be.revertedWithCustomError(concreteLightAccountValidator, 'InvalidLightAccount');
    });

    it('should revert when calldata length is invalid', async function () {
      // Set up the mock factory contract to return the correct address
      await mockLightAccountFactory.setAccountAddress(
        await mockLightAccount.owner(),
        0n,
        await mockLightAccount.getAddress(),
      );

      const invalidCallData = '0x1234'; // Too short
      const invalidUserOp = { ...mockUserOp, callData: invalidCallData };

      await expect(
        concreteLightAccountValidator.validateUserOpPublic(invalidUserOp),
      ).to.be.revertedWithCustomError(concreteLightAccountValidator, 'InvalidUserOpCallDataLength');
    });

    it('should revert when the calldata function selector is not authorized', async function () {
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
        concreteLightAccountValidator.validateUserOpPublic(unauthorizedUserOp),
      ).to.be.revertedWithCustomError(concreteLightAccountValidator, 'InvalidCallData');
    });

    it('should revert when inner calldata length is invalid', async function () {
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
        concreteLightAccountValidator.validateUserOpPublic(userOp),
      ).to.be.revertedWithCustomError(concreteLightAccountValidator, 'InvalidInnerCallDataLength');
    });
  });

  describe('lightAccountOwner', () => {
    // Set up the mock light account factory to return our mock account
    beforeEach(async function () {
      await mockLightAccountFactory.setAccountAddress(
        await mockLightAccount.owner(),
        0n,
        await mockLightAccount.getAddress(),
      );
    });

    describe('light accounts', function () {
      it('should return the owner of the light account', async () => {
        // Test with our mock ownership contract
        const lightAccountOwner =
          await concreteLightAccountValidator.potentialLightAccountResolvedOwner(
            await mockLightAccount.getAddress(),
            0n,
          );
        expect(lightAccountOwner).to.equal(owner.address);
      });
    });

    describe('non-light accounts', function () {
      describe('when the msgSender is an EOA', () => {
        it('should return the msgSender', async () => {
          // For EOAs, the voter function should just return the address itself
          const eoaAddress = user.address;
          const voter = await concreteLightAccountValidator.potentialLightAccountResolvedOwner(
            eoaAddress,
            0n,
          );
          expect(voter).to.equal(eoaAddress);
        });
      });

      describe('when the msgSender is a contract that does not implement IOwnership', () => {
        it('should return the contract address', async () => {
          // Use the ConcreteLightAccountValidator contract itself as a contract that doesn't implement IOwnership
          const contractAddress = await concreteLightAccountValidator.getAddress();
          const voter = await concreteLightAccountValidator.potentialLightAccountResolvedOwner(
            contractAddress,
            0n,
          );
          expect(voter).to.equal(contractAddress);
        });
      });
    });
  });

  describe('Multiple Light Account Indices', () => {
    let mockLightAccount2: MockLightAccount;
    let mockLightAccount3: MockLightAccount;

    beforeEach(async function () {
      // Deploy additional mock light accounts
      mockLightAccount2 = await new MockLightAccount__factory(deployer).deploy(owner.address);
      mockLightAccount3 = await new MockLightAccount__factory(deployer).deploy(owner.address);
    });

    describe('potentialLightAccountResolvedOwner with different indices', () => {
      it('should return the correct owner for different light account indices', async () => {
        // Set up the mock factory to return different addresses for different indices
        await mockLightAccountFactory.setAccountAddress(
          owner.address,
          0n,
          await mockLightAccount.getAddress(),
        );
        await mockLightAccountFactory.setAccountAddress(
          owner.address,
          1n,
          await mockLightAccount2.getAddress(),
        );
        await mockLightAccountFactory.setAccountAddress(
          owner.address,
          2n,
          await mockLightAccount3.getAddress(),
        );

        // Test index 0
        const owner0 = await concreteLightAccountValidator.potentialLightAccountResolvedOwner(
          await mockLightAccount.getAddress(),
          0n,
        );
        expect(owner0).to.equal(owner.address);

        // Test index 1
        const owner1 = await concreteLightAccountValidator.potentialLightAccountResolvedOwner(
          await mockLightAccount2.getAddress(),
          1n,
        );
        expect(owner1).to.equal(owner.address);

        // Test index 2
        const owner2 = await concreteLightAccountValidator.potentialLightAccountResolvedOwner(
          await mockLightAccount3.getAddress(),
          2n,
        );
        expect(owner2).to.equal(owner.address);
      });

      it('should return different addresses for mismatched indices', async () => {
        // Set up factory with specific addresses for indices
        await mockLightAccountFactory.setAccountAddress(
          owner.address,
          0n,
          await mockLightAccount.getAddress(),
        );
        await mockLightAccountFactory.setAccountAddress(
          owner.address,
          1n,
          await mockLightAccount2.getAddress(),
        );

        // Query index 0 address with index 1 - should return the address itself (not validated)
        const result = await concreteLightAccountValidator.potentialLightAccountResolvedOwner(
          await mockLightAccount.getAddress(),
          1n,
        );
        // When validation fails, it returns the potential light account address itself
        expect(result).to.equal(await mockLightAccount.getAddress());
      });
    });

    describe('validateLightAccount with different indices', () => {
      it('should validate correctly for matching light account and index', async () => {
        // Set up factory for multiple indices
        await mockLightAccountFactory.setAccountAddress(
          owner.address,
          0n,
          await mockLightAccount.getAddress(),
        );
        await mockLightAccountFactory.setAccountAddress(
          owner.address,
          1n,
          await mockLightAccount2.getAddress(),
        );

        // Validate index 0
        const [isValid0, lightAccountOwner0] =
          await concreteLightAccountValidator.validateLightAccountPublic(
            await mockLightAccount.getAddress(),
            0n,
          );
        expect(isValid0).to.be.true;
        expect(lightAccountOwner0).to.equal(owner.address);

        // Validate index 1
        const [isValid1, lightAccountOwner1] =
          await concreteLightAccountValidator.validateLightAccountPublic(
            await mockLightAccount2.getAddress(),
            1n,
          );
        expect(isValid1).to.be.true;
        expect(lightAccountOwner1).to.equal(owner.address);
      });

      it('should fail validation for mismatched light account and index', async () => {
        // Set up factory
        await mockLightAccountFactory.setAccountAddress(
          owner.address,
          0n,
          await mockLightAccount.getAddress(),
        );
        await mockLightAccountFactory.setAccountAddress(
          owner.address,
          1n,
          await mockLightAccount2.getAddress(),
        );

        // Try to validate index 0 account with index 1
        const [isValid, lightAccountOwner] =
          await concreteLightAccountValidator.validateLightAccountPublic(
            await mockLightAccount.getAddress(),
            1n,
          );
        expect(isValid).to.be.false;
        expect(lightAccountOwner).to.equal(owner.address);
      });
    });

    describe('validateUserOp with paymaster data containing light account index', () => {
      let mockTarget: MockGaslessTarget;

      beforeEach(async function () {
        // Deploy MockGaslessTarget
        mockTarget = await new MockGaslessTarget__factory(deployer).deploy();

        // Set up factory for multiple accounts
        await mockLightAccountFactory.setAccountAddress(
          owner.address,
          0n,
          await mockLightAccount.getAddress(),
        );
        await mockLightAccountFactory.setAccountAddress(
          owner.address,
          1n,
          await mockLightAccount2.getAddress(),
        );
      });

      it('should extract and use light account index from paymaster data', async () => {
        // Create calldata
        const innerCallData = mockTarget.interface.encodeFunctionData('foo', [123, 1]);
        const executeCalldata = mockLightAccount2.interface.encodeFunctionData('execute', [
          await mockTarget.getAddress(),
          0n,
          innerCallData,
        ]);

        // Create paymaster data with index 1
        // Standard fields take up 52 bytes (20 + 16 + 16), then the index
        const paymasterDataWithIndex = ethers.concat([
          ethers.zeroPadValue('0x', 52), // Standard paymaster fields (52 bytes)
          ethers.zeroPadValue(ethers.toBeHex(1), 32), // lightAccountIndex = 1
        ]);

        const mockUserOp: PackedUserOperation = {
          sender: await mockLightAccount2.getAddress(),
          nonce: 0n,
          initCode: '0x',
          callData: executeCalldata,
          accountGasLimits: ethers.ZeroHash,
          preVerificationGas: 0n,
          gasFees: ethers.ZeroHash,
          paymasterAndData: paymasterDataWithIndex,
          signature: '0x',
        };

        // Should validate successfully with index from paymaster data
        const [lightAccountOwner, target, returnedInnerCallData] =
          await concreteLightAccountValidator.validateUserOpPublic(mockUserOp);
        expect(lightAccountOwner).to.equal(owner.address);
        expect(target).to.equal(await mockTarget.getAddress());
        expect(returnedInnerCallData).to.equal(innerCallData);
      });

      it('should default to index 0 when no paymaster data is provided', async () => {
        // Create calldata for index 0 account
        const innerCallData = mockTarget.interface.encodeFunctionData('foo', [123, 1]);
        const executeCalldata = mockLightAccount.interface.encodeFunctionData('execute', [
          await mockTarget.getAddress(),
          0n,
          innerCallData,
        ]);

        const mockUserOp: PackedUserOperation = {
          sender: await mockLightAccount.getAddress(),
          nonce: 0n,
          initCode: '0x',
          callData: executeCalldata,
          accountGasLimits: ethers.ZeroHash,
          preVerificationGas: 0n,
          gasFees: ethers.ZeroHash,
          paymasterAndData: '0x', // No paymaster data
          signature: '0x',
        };

        // Should validate successfully with default index 0
        const [lightAccountOwner, target, returnedInnerCallData] =
          await concreteLightAccountValidator.validateUserOpPublic(mockUserOp);
        expect(lightAccountOwner).to.equal(owner.address);
        expect(target).to.equal(await mockTarget.getAddress());
        expect(returnedInnerCallData).to.equal(innerCallData);
      });

      it('should fail validation when using wrong index in paymaster data', async () => {
        // Create calldata for index 0 account
        const innerCallData = mockTarget.interface.encodeFunctionData('foo', [123, 1]);
        const executeCalldata = mockLightAccount.interface.encodeFunctionData('execute', [
          await mockTarget.getAddress(),
          0n,
          innerCallData,
        ]);

        // Create paymaster data with wrong index (1 instead of 0)
        const paymasterDataWithWrongIndex = ethers.concat([
          ethers.zeroPadValue('0x', 52), // Standard paymaster fields (52 bytes)
          ethers.zeroPadValue(ethers.toBeHex(1), 32), // lightAccountIndex = 1 (wrong for index 0 account)
        ]);

        const mockUserOp: PackedUserOperation = {
          sender: await mockLightAccount.getAddress(), // This is the index 0 account
          nonce: 0n,
          initCode: '0x',
          callData: executeCalldata,
          accountGasLimits: ethers.ZeroHash,
          preVerificationGas: 0n,
          gasFees: ethers.ZeroHash,
          paymasterAndData: paymasterDataWithWrongIndex,
          signature: '0x',
        };

        // Should fail validation due to index mismatch
        await expect(
          concreteLightAccountValidator.validateUserOpPublic(mockUserOp),
        ).to.be.revertedWithCustomError(concreteLightAccountValidator, 'InvalidLightAccount');
      });

      it('should default to index 0 when paymaster data is less than 84 bytes', async () => {
        // Create calldata for index 0 account
        const innerCallData = mockTarget.interface.encodeFunctionData('foo', [123, 1]);
        const executeCalldata = mockLightAccount.interface.encodeFunctionData('execute', [
          await mockTarget.getAddress(),
          0n,
          innerCallData,
        ]);

        // Create paymaster data that's less than 84 bytes (so it doesn't contain an index)
        const shortPaymasterData = ethers.zeroPadValue('0x', 60); // Only 60 bytes, less than 84

        const mockUserOp: PackedUserOperation = {
          sender: await mockLightAccount.getAddress(),
          nonce: 0n,
          initCode: '0x',
          callData: executeCalldata,
          accountGasLimits: ethers.ZeroHash,
          preVerificationGas: 0n,
          gasFees: ethers.ZeroHash,
          paymasterAndData: shortPaymasterData,
          signature: '0x',
        };

        // Should validate successfully with default index 0
        const [lightAccountOwner, target, returnedInnerCallData] =
          await concreteLightAccountValidator.validateUserOpPublic(mockUserOp);
        expect(lightAccountOwner).to.equal(owner.address);
        expect(target).to.equal(await mockTarget.getAddress());
        expect(returnedInnerCallData).to.equal(innerCallData);
      });
    });
  });
});
