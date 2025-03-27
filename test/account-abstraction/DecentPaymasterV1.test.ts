import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  DecentPaymasterV1,
  DecentPaymasterV1__factory,
  ERC1967Proxy__factory,
  IDecentPaymasterV1__factory,
  IERC165__factory,
  IPaymaster__factory,
  IVersion__factory,
  MockEntryPoint,
  MockEntryPoint__factory,
} from '../../typechain-types';
import { calculateInterfaceId } from '../helpers/utils';
import { runUUPSUpgradeabilityTests } from '../helpers/uupsUpgradeabilityTests';

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

// Helper function for deploying DecentPaymasterV1 instances using ERC1967Proxy
async function deployDecentPaymasterProxy(
  proxyDeployer: SignerWithAddress,
  implementation: string,
  owner: SignerWithAddress,
  entryPoint: string,
): Promise<DecentPaymasterV1> {
  // Encode initialization parameters
  const initializeParams = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'address'],
    [owner.address, entryPoint],
  );

  // Create full initialization data with function selector
  const fullInitData =
    DecentPaymasterV1__factory.createInterface().getFunction('initialize').selector +
    initializeParams.slice(2);

  // Deploy the proxy with the implementation
  const proxy = await new ERC1967Proxy__factory(proxyDeployer).deploy(implementation, fullInitData);

  // Return a contract instance connected to the proxy
  return DecentPaymasterV1__factory.connect(await proxy.getAddress(), owner);
}

describe('DecentPaymasterV1', function () {
  // contracts
  let decentPaymaster: DecentPaymasterV1;
  let masterCopy: string;
  let entryPoint: MockEntryPoint;

  // signers
  let owner: SignerWithAddress;
  let proxyDeployer: SignerWithAddress;
  let strategy: SignerWithAddress;
  let nonOwner: SignerWithAddress;

  // test data
  let mockUserOp: PackedUserOperation;
  const MOCK_FUNCTION_SELECTOR = '0x12345678';
  const MOCK_FUNCTION_SELECTOR_2 = '0x87654321';
  const MOCK_FUNCTION_SELECTOR_3 = '0x11223344';
  const MOCK_INVALID_SELECTOR = '0x99999999';

  beforeEach(async function () {
    // Get signers
    [proxyDeployer, owner, strategy, nonOwner] = await ethers.getSigners();

    // Deploy mock EntryPoint
    entryPoint = await new MockEntryPoint__factory(owner).deploy();

    // Deploy DecentPaymaster implementation
    masterCopy = await (await new DecentPaymasterV1__factory(owner).deploy()).getAddress();

    // Deploy DecentPaymaster proxy
    decentPaymaster = await deployDecentPaymasterProxy(
      proxyDeployer,
      masterCopy,
      owner,
      await entryPoint.getAddress(),
    );

    // Create mock UserOperation
    const mockCallData = ethers.concat([
      MOCK_FUNCTION_SELECTOR,
      strategy.address,
      '0x', // empty data
    ]);

    mockUserOp = {
      sender: ethers.ZeroAddress,
      nonce: 0n,
      initCode: '0x',
      callData: mockCallData,
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

    it('Should not allow reinitialization', async function () {
      await expect(
        decentPaymaster.initialize(owner.address, await entryPoint.getAddress()),
      ).to.be.revertedWith('Initializable: contract is already initialized');
    });

    it('Should have a version', async function () {
      const version = await decentPaymaster.getVersion();
      void expect(version).to.equal(1);
    });
  });

  describe('Function Approval', function () {
    it('Should allow owner to approve functions', async function () {
      const selectors = [MOCK_FUNCTION_SELECTOR];
      const approved = [true];

      await expect(decentPaymaster.whitelistFunctions(strategy.address, selectors, approved))
        .to.emit(decentPaymaster, 'FunctionApproved')
        .withArgs(strategy.address, MOCK_FUNCTION_SELECTOR, true);

      const isApproved = await decentPaymaster.isFunctionWhitelisted(
        strategy.address,
        MOCK_FUNCTION_SELECTOR,
      );
      void expect(isApproved).to.be.true;
    });

    it('Should allow owner to revoke function approval', async function () {
      const selectors = [MOCK_FUNCTION_SELECTOR];
      const approved = [true];

      await decentPaymaster.whitelistFunctions(strategy.address, selectors, approved);

      await decentPaymaster.whitelistFunctions(strategy.address, selectors, [false]);
      const isApproved = await decentPaymaster.isFunctionWhitelisted(
        strategy.address,
        MOCK_FUNCTION_SELECTOR,
      );
      void expect(isApproved).to.be.false;
    });

    it('Should revert when non-owner tries to set approval', async function () {
      const selectors = [MOCK_FUNCTION_SELECTOR];
      const approved = [true];

      await expect(
        decentPaymaster.connect(nonOwner).whitelistFunctions(strategy.address, selectors, approved),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should revert when arrays have different lengths', async function () {
      const selectors = [MOCK_FUNCTION_SELECTOR];
      const approved: boolean[] = [];

      await expect(
        decentPaymaster.whitelistFunctions(strategy.address, selectors, approved),
      ).to.be.revertedWithCustomError(decentPaymaster, 'InvalidArrayLength');
    });

    it('Should approve multiple functions in a single call', async function () {
      const selectors = [
        MOCK_FUNCTION_SELECTOR,
        MOCK_FUNCTION_SELECTOR_2,
        MOCK_FUNCTION_SELECTOR_3,
      ];
      const approved = [true, true, true];

      await decentPaymaster.whitelistFunctions(strategy.address, selectors, approved);

      for (const selector of selectors) {
        const isApproved = await decentPaymaster.isFunctionWhitelisted(strategy.address, selector);
        void expect(isApproved).to.be.true;
      }
    });

    it('Should handle empty arrays', async function () {
      const selectors: string[] = [];
      const approved: boolean[] = [];

      await decentPaymaster.whitelistFunctions(strategy.address, selectors, approved);
      // Should not revert and should not modify any state
    });

    it('Should revert when using zero address as strategy', async function () {
      const selectors = [MOCK_FUNCTION_SELECTOR];
      const approved = [true];

      await expect(
        decentPaymaster.whitelistFunctions(ethers.ZeroAddress, selectors, approved),
      ).to.be.revertedWithCustomError(decentPaymaster, 'ZeroAddressStrategy');
    });
  });

  describe('Validation', function () {
    beforeEach(async function () {
      // Approve the function for the strategy
      const selectors = [MOCK_FUNCTION_SELECTOR];
      const approved = [true];
      await decentPaymaster.whitelistFunctions(strategy.address, selectors, approved);

      // Fund the impersonated signer
      const entryPointSigner = await ethers.getImpersonatedSigner(await entryPoint.getAddress());
      await owner.sendTransaction({
        to: await entryPointSigner.getAddress(),
        value: ethers.parseEther('1'),
      });
    });

    it('Should validate approved function calls', async function () {
      const entryPointSigner = await ethers.getImpersonatedSigner(await entryPoint.getAddress());
      const result = await decentPaymaster
        .connect(entryPointSigner)
        .validatePaymasterUserOp.staticCall(mockUserOp, ethers.ZeroHash, 0);

      expect(result[1]).to.equal(0n); // validationData
      expect(result[0]).to.equal('0x'); // context
    });

    it('Should revert on unauthorized function calls', async function () {
      const unauthorizedCallData = ethers.concat([
        MOCK_INVALID_SELECTOR,
        ethers.zeroPadValue(strategy.address, 20),
        '0x',
      ]);

      const unauthorizedUserOp = { ...mockUserOp, callData: unauthorizedCallData };

      await expect(
        decentPaymaster
          .connect(await ethers.getImpersonatedSigner(await entryPoint.getAddress()))
          .validatePaymasterUserOp.staticCall(unauthorizedUserOp, ethers.ZeroHash, 0),
      ).to.be.revertedWithCustomError(decentPaymaster, 'UnauthorizedStrategy');
    });

    it('Should revert on invalid calldata length', async function () {
      const invalidCallData = '0x1234'; // Too short
      const invalidUserOp = { ...mockUserOp, callData: invalidCallData };

      await expect(
        decentPaymaster
          .connect(await ethers.getImpersonatedSigner(await entryPoint.getAddress()))
          .validatePaymasterUserOp.staticCall(invalidUserOp, ethers.ZeroHash, 0),
      ).to.be.revertedWithCustomError(decentPaymaster, 'InvalidCallDataLength');
    });

    it('Should validate with exactly 24 bytes of calldata', async function () {
      const exactCallData = ethers.concat([
        MOCK_FUNCTION_SELECTOR,
        ethers.zeroPadValue(strategy.address, 20),
      ]);

      const userOp = { ...mockUserOp, callData: exactCallData };
      const entryPointSigner = await ethers.getImpersonatedSigner(await entryPoint.getAddress());

      const result = await decentPaymaster
        .connect(entryPointSigner)
        .validatePaymasterUserOp.staticCall(userOp, ethers.ZeroHash, 0);

      expect(result[1]).to.equal(0n);
      expect(result[0]).to.equal('0x');
    });

    it('Should validate with more than 24 bytes of calldata', async function () {
      const longCallData = ethers.concat([
        MOCK_FUNCTION_SELECTOR,
        ethers.zeroPadValue(strategy.address, 20),
        '0x1234567890', // additional data
      ]);

      const userOp = { ...mockUserOp, callData: longCallData };
      const entryPointSigner = await ethers.getImpersonatedSigner(await entryPoint.getAddress());

      const result = await decentPaymaster
        .connect(entryPointSigner)
        .validatePaymasterUserOp.staticCall(userOp, ethers.ZeroHash, 0);

      expect(result[1]).to.equal(0n);
      expect(result[0]).to.equal('0x');
    });

    it('Should validate with non-contract address as target', async function () {
      const randomAddress = ethers.Wallet.createRandom().address;
      const callData = ethers.concat([
        MOCK_FUNCTION_SELECTOR,
        ethers.zeroPadValue(randomAddress, 20),
      ]);

      const userOp = { ...mockUserOp, callData: callData };

      await decentPaymaster.whitelistFunctions(randomAddress, [MOCK_FUNCTION_SELECTOR], [true]);
      const entryPointSigner = await ethers.getImpersonatedSigner(await entryPoint.getAddress());

      const result = await decentPaymaster
        .connect(entryPointSigner)
        .validatePaymasterUserOp.staticCall(userOp, ethers.ZeroHash, 0);

      expect(result[1]).to.equal(0n);
      expect(result[0]).to.equal('0x');
    });

    it('Should revert with malformed calldata', async function () {
      const malformedCallData = '0x1234'; // Less than 4 bytes for selector
      const userOp = { ...mockUserOp, callData: malformedCallData };

      await expect(
        decentPaymaster
          .connect(await ethers.getImpersonatedSigner(await entryPoint.getAddress()))
          .validatePaymasterUserOp.staticCall(userOp, ethers.ZeroHash, 0),
      ).to.be.revertedWithCustomError(decentPaymaster, 'InvalidCallDataLength');
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

  describe('UUPS Upgradeability', function () {
    // Run UUPS upgradeability tests
    runUUPSUpgradeabilityTests({
      getContract: () => decentPaymaster,
      createNewImplementation: async () => {
        const newImplementation = await new DecentPaymasterV1__factory(owner).deploy();
        return newImplementation;
      },
      owner: () => owner,
      nonOwner: () => nonOwner,
    });
  });
});
