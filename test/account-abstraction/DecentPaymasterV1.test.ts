import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  DecentPaymasterV1,
  DecentPaymasterV1__factory,
  IDecentPaymasterV1__factory,
  IERC165__factory,
  IPaymaster__factory,
  IVersion__factory,
  MockEntryPoint,
  MockEntryPoint__factory,
  MockGaslessTarget,
  MockGaslessTarget__factory,
  MockLightAccount,
  MockLightAccount__factory,
  MockLightAccountFactory,
  MockLightAccountFactory__factory,
  MockValidator,
  MockValidator__factory,
} from '../../typechain-types';
import { getModuleProxyFactory } from '../GlobalSafeDeployments.test';
import { calculateProxyAddress } from '../helpers';
import { calculateInterfaceId } from '../helpers/utils';

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

// Helper function for deploying DecentPaymasterV1 instances
async function deployDecentPaymasterProxy(
  implementation: DecentPaymasterV1,
  owner: SignerWithAddress,
  entryPoint: string,
  lightAccountFactory: string,
): Promise<DecentPaymasterV1> {
  const initializeCalldata = implementation.interface.encodeFunctionData('initialize', [
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'address'],
      [owner.address, entryPoint, lightAccountFactory],
    ),
  ]);

  const moduleProxyFactory = getModuleProxyFactory();
  const salt = ethers.keccak256(ethers.randomBytes(32));

  // Deploy the proxy with owner as the deployer
  await moduleProxyFactory.deployModule(
    await implementation.getAddress(),
    initializeCalldata,
    salt,
  );

  const predictedAddress = await calculateProxyAddress(
    moduleProxyFactory,
    await implementation.getAddress(),
    initializeCalldata,
    salt,
  );

  // Return a contract instance connected to the proxy
  return DecentPaymasterV1__factory.connect(predictedAddress, owner);
}

describe('DecentPaymasterV1', function () {
  // contracts
  let decentPaymaster: DecentPaymasterV1;
  let masterCopy: DecentPaymasterV1;
  let entryPoint: MockEntryPoint;
  let mockLightAccount: MockLightAccount;
  let mockTarget: MockGaslessTarget;
  let mockLightAccountFactory: MockLightAccountFactory;
  let mockValidator: MockValidator;
  let mockLightAccountFactoryAddress: string;

  // signers
  let owner: SignerWithAddress;
  let nonOwner: SignerWithAddress;

  // test data
  let mockUserOp: PackedUserOperation;
  let FOO_SELECTOR: string;

  beforeEach(async function () {
    // Get signers
    [owner, nonOwner] = await ethers.getSigners();

    // Deploy mock EntryPoint
    entryPoint = await new MockEntryPoint__factory(owner).deploy();

    // Deploy MockLightAccount
    mockLightAccount = await new MockLightAccount__factory(owner).deploy(owner.address);

    // Deploy MockGaslessTarget
    mockTarget = await new MockGaslessTarget__factory(owner).deploy();

    // Deploy MockValidator
    mockValidator = await new MockValidator__factory(owner).deploy();

    // Deploy MockLightAccountFactory
    mockLightAccountFactory = await new MockLightAccountFactory__factory(owner).deploy();
    mockLightAccountFactoryAddress = mockLightAccountFactory.target.toString();

    // Set up the mock light account factory to return our mock account
    await mockLightAccountFactory.setAccountAddress(
      await mockLightAccount.owner(),
      0n,
      await mockLightAccount.getAddress(),
    );

    // Get the foo function selector
    FOO_SELECTOR = mockTarget.interface.getFunction('foo').selector;

    // Deploy DecentPaymaster implementation
    masterCopy = await new DecentPaymasterV1__factory(owner).deploy();

    // Deploy DecentPaymaster proxy
    decentPaymaster = await deployDecentPaymasterProxy(
      masterCopy,
      owner,
      await entryPoint.getAddress(),
      mockLightAccountFactoryAddress,
    );

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

  describe('Initialization', function () {
    it('Should set the entry point address', async function () {
      expect(await decentPaymaster.entryPoint()).to.equal(await entryPoint.getAddress());
    });

    it('Should set the owner', async function () {
      expect(await decentPaymaster.owner()).to.equal(owner.address);
    });

    it('Should set the light account factory', async function () {
      expect(await decentPaymaster.lightAccountFactory()).to.equal(mockLightAccountFactoryAddress);
    });

    it('Should not allow reinitialization', async function () {
      await expect(
        decentPaymaster.initialize(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'address', 'address'],
            [owner.address, await entryPoint.getAddress(), mockLightAccountFactoryAddress],
          ),
        ),
      ).to.be.revertedWith('Initializable: contract is already initialized');
    });

    it('Should have a version', async function () {
      const version = await decentPaymaster.getVersion();
      expect(version).to.equal(1);
    });
  });

  describe('Validator Management', function () {
    it('Should allow owner to set validator for target', async function () {
      await expect(
        decentPaymaster.setFunctionValidator(
          await mockTarget.getAddress(),
          FOO_SELECTOR,
          await mockValidator.getAddress(),
        ),
      )
        .to.emit(decentPaymaster, 'FunctionValidatorSet')
        .withArgs(await mockTarget.getAddress(), FOO_SELECTOR, await mockValidator.getAddress());

      void expect(
        await decentPaymaster.hasFunctionValidator(await mockTarget.getAddress(), FOO_SELECTOR),
      ).to.be.true;
    });

    it('Should allow owner to remove validator for target', async function () {
      await decentPaymaster.setFunctionValidator(
        await mockTarget.getAddress(),
        FOO_SELECTOR,
        await mockValidator.getAddress(),
      );
      void expect(
        await decentPaymaster.hasFunctionValidator(await mockTarget.getAddress(), FOO_SELECTOR),
      ).to.be.true;

      await expect(
        decentPaymaster.removeFunctionValidator(await mockTarget.getAddress(), FOO_SELECTOR),
      )
        .to.emit(decentPaymaster, 'FunctionValidatorRemoved')
        .withArgs(await mockTarget.getAddress(), FOO_SELECTOR);

      void expect(
        await decentPaymaster.hasFunctionValidator(await mockTarget.getAddress(), FOO_SELECTOR),
      ).to.be.false;
    });

    it('Should revert when non-owner tries to set validator', async function () {
      await expect(
        decentPaymaster
          .connect(nonOwner)
          .setFunctionValidator(
            await mockTarget.getAddress(),
            FOO_SELECTOR,
            await mockValidator.getAddress(),
          ),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should revert when setting invalid validator address', async function () {
      await expect(
        decentPaymaster.setFunctionValidator(
          await mockTarget.getAddress(),
          FOO_SELECTOR,
          ethers.ZeroAddress,
        ),
      ).to.be.revertedWithCustomError(decentPaymaster, 'InvalidValidator');
    });
  });

  describe('Validation', function () {
    beforeEach(async function () {
      // Set up validator for mock target and FOO_SELECTOR
      await decentPaymaster.setFunctionValidator(
        await mockTarget.getAddress(),
        FOO_SELECTOR,
        await mockValidator.getAddress(),
      );
      // Configure validator to return true
      await mockValidator.setShouldValidate(true);
    });

    it('Should validate when validator approves', async function () {
      const entryPointSigner = await ethers.getImpersonatedSigner(await entryPoint.getAddress());
      const result = await decentPaymaster
        .connect(entryPointSigner)
        .validatePaymasterUserOp.staticCall(mockUserOp, ethers.ZeroHash, 0);

      expect(result[1]).to.equal(0n); // validationData
      expect(result[0]).to.equal('0x'); // context
    });

    it('Should revert when validator disapproves', async function () {
      // Configure validator to return false
      await mockValidator.setShouldValidate(false);

      await expect(
        decentPaymaster
          .connect(await ethers.getImpersonatedSigner(await entryPoint.getAddress()))
          .validatePaymasterUserOp.staticCall(mockUserOp, ethers.ZeroHash, 0),
      ).to.be.revertedWithCustomError(decentPaymaster, 'ValidationFailed');
    });

    it('Should revert when no validator is set', async function () {
      // Remove validator
      await decentPaymaster.removeFunctionValidator(await mockTarget.getAddress(), FOO_SELECTOR);

      await expect(
        decentPaymaster
          .connect(await ethers.getImpersonatedSigner(await entryPoint.getAddress()))
          .validatePaymasterUserOp.staticCall(mockUserOp, ethers.ZeroHash, 0),
      ).to.be.revertedWithCustomError(decentPaymaster, 'NotWhitelistedFunction');
    });

    it('Should revert for non-whitelisted function selectors', async function () {
      // Create a new function selector that isn't whitelisted
      const nonWhitelistedSelector = mockTarget.interface.getFunction('bar').selector;

      // Create inner calldata with non-whitelisted selector
      const innerCalldata = mockTarget.interface.encodeFunctionData('bar', [
        owner.address, // address someAddress
        ethers.parseEther('1'), // uint256 someAmount
      ]);

      // Create the execute calldata
      const executeCalldata = mockLightAccount.interface.encodeFunctionData('execute', [
        await mockTarget.getAddress(),
        0n, // value
        innerCalldata,
      ]);

      const userOp = { ...mockUserOp, callData: executeCalldata };

      await expect(
        decentPaymaster
          .connect(await ethers.getImpersonatedSigner(await entryPoint.getAddress()))
          .validatePaymasterUserOp.staticCall(userOp, ethers.ZeroHash, 0),
      )
        .to.be.revertedWithCustomError(decentPaymaster, 'NotWhitelistedFunction')
        .withArgs(await mockTarget.getAddress(), nonWhitelistedSelector);
    });
  });

  describe('Deposit handling', function () {
    it('Should accept deposits through deposit function', async function () {
      const depositAmount = ethers.parseEther('1');

      await expect(decentPaymaster.deposit({ value: depositAmount })).to.changeEtherBalance(
        entryPoint,
        depositAmount,
      );
    });

    it('Should reject direct ETH transfers', async function () {
      const depositAmount = ethers.parseEther('1');

      await expect(
        owner.sendTransaction({
          to: await decentPaymaster.getAddress(),
          value: depositAmount,
        }),
      ).to.be.reverted;
    });

    it('Should handle zero value deposits', async function () {
      const depositAmount = 0n;

      await expect(decentPaymaster.deposit({ value: depositAmount })).to.changeEtherBalance(
        entryPoint,
        depositAmount,
      );
    });

    it('Should handle large value deposits', async function () {
      const depositAmount = ethers.parseEther('1000');

      await expect(decentPaymaster.deposit({ value: depositAmount })).to.changeEtherBalance(
        entryPoint,
        depositAmount,
      );
    });

    it('Should handle multiple deposits', async function () {
      const deposit1 = ethers.parseEther('1');
      const deposit2 = ethers.parseEther('2');
      const deposit3 = ethers.parseEther('3');

      await decentPaymaster.deposit({ value: deposit1 });
      await decentPaymaster.deposit({ value: deposit2 });
      await decentPaymaster.deposit({ value: deposit3 });

      const totalDeposit = deposit1 + deposit2 + deposit3;
      const balance = await entryPoint.balanceOf(await decentPaymaster.getAddress());
      expect(balance).to.equal(totalDeposit);
    });
  });

  describe('ERC165', function () {
    // Interface IDs
    let iPaymasterInterfaceId: string;
    let iDecentPaymasterInterfaceId: string;
    let iVersionInterfaceId: string;
    let iERC165InterfaceId: string;

    beforeEach(async function () {
      // Calculate IPaymaster interface ID
      const IPaymasterInterface = IPaymaster__factory.createInterface();
      iPaymasterInterfaceId = calculateInterfaceId(IPaymasterInterface);

      // Calculate IDecentPaymaster interface ID
      const IDecentPaymasterInterface = IDecentPaymasterV1__factory.createInterface();
      iDecentPaymasterInterfaceId = calculateInterfaceId(IDecentPaymasterInterface);

      // Calculate IVersion interface ID
      const IVersionInterface = IVersion__factory.createInterface();
      iVersionInterfaceId = calculateInterfaceId(IVersionInterface);

      // Calculate IERC165 interface ID
      const IERC165Interface = IERC165__factory.createInterface();
      iERC165InterfaceId = calculateInterfaceId(IERC165Interface);
    });

    it('Should support IERC165 interface', async function () {
      const supported = await decentPaymaster.supportsInterface(iERC165InterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IPaymaster interface', async function () {
      const supported = await decentPaymaster.supportsInterface(iPaymasterInterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IDecentPaymaster interface', async function () {
      const supported = await decentPaymaster.supportsInterface(iDecentPaymasterInterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IVersion interface', async function () {
      const supported = await decentPaymaster.supportsInterface(iVersionInterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should not support random interface', async function () {
      const randomInterfaceId = '0x12345678';
      const supported = await decentPaymaster.supportsInterface(randomInterfaceId);
      void expect(supported).to.be.false;
    });
  });

  describe('Version', () => {
    it('should return the correct version number', async () => {
      expect(await decentPaymaster.getVersion()).to.equal(1);
    });
  });
});
