import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  IDeploymentBlock,
  IDeploymentBlock__factory,
  IERC165__factory,
  IModuleFractalV1__factory,
  IVersion__factory,
  MockAvatar,
  MockAvatar__factory,
  MockERC20Votes,
  MockERC20Votes__factory,
  ModuleFractalV1,
  ModuleFractalV1__factory,
  UUPSUpgradeable,
} from '../../../../typechain-types';
import { runDeploymentBlockTests } from '../../shared/deploymentBlockTests';
import { runSupportsInterfaceTests } from '../../shared/supportsInterfaceTests';
import { runUUPSUpgradeabilityTests } from '../../shared/uupsUpgradeabilityTests';

// Helper functions for deploying FractalModuleV1 instances using ERC1967Proxy
async function deployFractalModuleProxy(
  proxyDeployer: SignerWithAddress,
  implementation: string,
  owner: SignerWithAddress,
  avatar: string,
  target: string,
): Promise<ModuleFractalV1> {
  // Combine selector and encoded params
  const fullInitData = ModuleFractalV1__factory.createInterface().encodeFunctionData('initialize', [
    owner.address,
    avatar,
    target,
  ]);

  // Deploy the proxy with the implementation
  const proxy = await new ERC1967Proxy__factory(proxyDeployer).deploy(implementation, fullInitData);

  // Return a contract instance connected to the proxy
  return ModuleFractalV1__factory.connect(await proxy.getAddress(), owner);
}

// Helper function for deploying using setUp instead of initialize
async function deployFractalModuleProxyWithSetUp(
  proxyDeployer: SignerWithAddress,
  implementation: string,
  owner: SignerWithAddress,
  avatar: string,
  target: string,
): Promise<ModuleFractalV1> {
  // Create the call to setUp with the encoded parameters
  const fullInitData = ModuleFractalV1__factory.createInterface().encodeFunctionData('setUp', [
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'address'],
      [owner.address, avatar, target],
    ),
  ]);

  // Deploy the proxy with the implementation
  const proxy = await new ERC1967Proxy__factory(proxyDeployer).deploy(implementation, fullInitData);

  // Return a contract instance connected to the proxy
  return ModuleFractalV1__factory.connect(await proxy.getAddress(), owner);
}

describe('ModuleFractalV1', () => {
  // eoas
  let proxyDeployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let nonOwner: SignerWithAddress;
  let user: SignerWithAddress;

  // mocks and mastercopies
  let masterCopy: string;
  let mockToken: MockERC20Votes;

  // Shared fractalModule instance for deployment block tests
  let sharedFractalModule: ModuleFractalV1;

  beforeEach(async () => {
    // Get signers
    [proxyDeployer, owner, nonOwner, user] = await ethers.getSigners();

    // Deploy implementation contract
    const implementation = await new ModuleFractalV1__factory(proxyDeployer).deploy();
    masterCopy = await implementation.getAddress();
    mockToken = await new MockERC20Votes__factory(proxyDeployer).deploy();
  });

  describe('Initialization', () => {
    let fractalModule: ModuleFractalV1;
    let avatar: MockAvatar;

    beforeEach(async () => {
      avatar = await new MockAvatar__factory(proxyDeployer).deploy();
    });

    describe('Owner parameter', () => {
      it('should set correct owner', async () => {
        fractalModule = await deployFractalModuleProxy(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          await avatar.getAddress(),
        );

        expect(await fractalModule.owner()).to.equal(owner.address);
      });
    });

    describe('Avatar and Target parameters', () => {
      it('should initialize with same avatar and target', async () => {
        fractalModule = await deployFractalModuleProxy(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          await avatar.getAddress(),
        );

        expect(await fractalModule.avatar()).to.equal(await avatar.getAddress());
        expect(await fractalModule.getFunction('target')()).to.equal(await avatar.getAddress());
      });

      it('should initialize with different target than avatar', async () => {
        fractalModule = await deployFractalModuleProxy(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          user.address, // Different from avatar
        );

        expect(await fractalModule.avatar()).to.equal(await avatar.getAddress());
        expect(await fractalModule.getFunction('target')()).to.equal(user.address);
      });

      it('should allow zero address avatar', async () => {
        fractalModule = await deployFractalModuleProxy(
          proxyDeployer,
          masterCopy,
          owner,
          ethers.ZeroAddress,
          await avatar.getAddress(),
        );

        expect(await fractalModule.avatar()).to.equal(ethers.ZeroAddress);
        expect(await fractalModule.getFunction('target')()).to.equal(await avatar.getAddress());
      });

      it('should allow zero address target', async () => {
        fractalModule = await deployFractalModuleProxy(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          ethers.ZeroAddress,
        );

        expect(await fractalModule.avatar()).to.equal(await avatar.getAddress());
        expect(await fractalModule.getFunction('target')()).to.equal(ethers.ZeroAddress);
      });

      it('should allow both avatar and target to be zero address', async () => {
        fractalModule = await deployFractalModuleProxy(
          proxyDeployer,
          masterCopy,
          owner,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
        );

        expect(await fractalModule.avatar()).to.equal(ethers.ZeroAddress);
        expect(await fractalModule.getFunction('target')()).to.equal(ethers.ZeroAddress);
      });
    });

    describe('setUp function', () => {
      it('should correctly initialize contract when using setUp', async () => {
        fractalModule = await deployFractalModuleProxyWithSetUp(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          await avatar.getAddress(),
        );

        // Verify initialization was successful
        expect(await fractalModule.owner()).to.equal(owner.address);
        expect(await fractalModule.avatar()).to.equal(await avatar.getAddress());
        expect(await fractalModule.getFunction('target')()).to.equal(await avatar.getAddress());
      });

      it('should not allow setUp to be called again after initialization', async () => {
        fractalModule = await deployFractalModuleProxyWithSetUp(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          await avatar.getAddress(),
        );

        // Encode parameters correctly for setUp
        const innerParams = ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'address', 'address'],
          [owner.address, await avatar.getAddress(), await avatar.getAddress()],
        );

        // Attempt to call setUp again - should revert
        await expect(fractalModule.setUp(innerParams)).to.be.revertedWithCustomError(
          fractalModule,
          'InvalidInitialization',
        );
      });
    });

    describe('Reinitialization prevention', () => {
      it('should not allow reinitialization', async () => {
        fractalModule = await deployFractalModuleProxy(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          await avatar.getAddress(),
        );

        await expect(
          fractalModule.initialize(owner.address, ethers.ZeroAddress, ethers.ZeroAddress),
        ).to.be.revertedWithCustomError(fractalModule, 'InvalidInitialization');
      });
    });
  });

  describe('Transaction Execution', () => {
    let fractalModule: ModuleFractalV1;
    let avatar: MockAvatar;

    beforeEach(async () => {
      avatar = await new MockAvatar__factory(proxyDeployer).deploy();
      fractalModule = await deployFractalModuleProxy(
        proxyDeployer,
        masterCopy,
        owner,
        await avatar.getAddress(),
        await avatar.getAddress(),
      );
      await avatar.enableModule(await fractalModule.getAddress());
    });

    describe('Authorization', () => {
      let tx: {
        to: string;
        value: bigint;
        data: string;
        operation: number;
      };

      beforeEach(async () => {
        await mockToken.mint(await avatar.getAddress(), 1000); // Mint tokens for these tests

        tx = {
          to: await mockToken.getAddress(),
          value: 0n,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
          operation: 0,
        };
      });

      it('should allow owner to execute transactions', async () => {
        await mockToken.mint(await avatar.getAddress(), 1000);
        await fractalModule.execTx(tx);
        expect(await mockToken.balanceOf(user.address)).to.equal(100);
      });

      it('should revert with OwnableUnauthorizedAccount for non-owner', async () => {
        await expect(fractalModule.connect(user).execTx(tx)).to.be.revertedWithCustomError(
          fractalModule,
          'OwnableUnauthorizedAccount',
        );
      });
    });

    describe('Transaction Success/Failure', () => {
      let tx: {
        to: string;
        value: bigint;
        data: string;
        operation: number;
      };

      beforeEach(async () => {
        tx = {
          to: await mockToken.getAddress(),
          value: 0n,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
          operation: 0,
        };
      });

      it('should execute successful transactions', async () => {
        await mockToken.mint(await avatar.getAddress(), 1000);
        await fractalModule.execTx(tx);
        expect(await mockToken.balanceOf(user.address)).to.equal(100);
      });

      it('should revert with TxFailed on failed transactions', async () => {
        // No tokens minted to avatar, so transfer should fail
        tx = {
          to: await mockToken.getAddress(),
          value: 0n,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
          operation: 0,
        };

        await expect(fractalModule.execTx(tx)).to.be.revertedWithCustomError(
          fractalModule,
          'TxFailed',
        );
      });
    });

    describe('Transaction Data Handling', () => {
      it('should handle transactions with value', async () => {
        // Fund the avatar with ETH
        await owner.sendTransaction({
          to: await avatar.getAddress(),
          value: ethers.parseEther('1.0'),
        });

        const tx = {
          to: user.address,
          value: ethers.parseEther('0.5'),
          data: '0x',
          operation: 0,
        };

        const initialBalance = await ethers.provider.getBalance(user.address);
        await fractalModule.execTx(tx);
        const finalBalance = await ethers.provider.getBalance(user.address);

        expect(finalBalance - initialBalance).to.equal(ethers.parseEther('0.5'));
      });

      it('should handle transactions with empty data', async () => {
        const tx = {
          to: user.address,
          value: 0n,
          data: '0x',
          operation: 0,
        };

        await fractalModule.execTx(tx);
      });

      it('should handle transactions with both value and data', async () => {
        // Fund the avatar with ETH and tokens
        await owner.sendTransaction({
          to: await avatar.getAddress(),
          value: ethers.parseEther('1.0'),
        });
        await mockToken.mint(await avatar.getAddress(), 1000);

        // First send ETH to user
        const ethTx = {
          to: user.address,
          value: ethers.parseEther('0.5'),
          data: '0x',
          operation: 0,
        };

        // Then do token transfer
        const tokenTx = {
          to: await mockToken.getAddress(),
          value: 0n,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
          operation: 0,
        };

        const initialEthBalance = await ethers.provider.getBalance(user.address);

        // Execute both transactions
        await fractalModule.execTx(ethTx);
        await fractalModule.execTx(tokenTx);

        const finalEthBalance = await ethers.provider.getBalance(user.address);

        // Verify both the ETH transfer and token transfer worked
        expect(finalEthBalance - initialEthBalance).to.equal(ethers.parseEther('0.5'));
        expect(await mockToken.balanceOf(user.address)).to.equal(100);
      });
    });
  });

  describe('Version', () => {
    let fractalModule: ModuleFractalV1;

    beforeEach(async () => {
      fractalModule = await deployFractalModuleProxy(
        proxyDeployer,
        masterCopy,
        owner,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
      );
    });

    // Use the shared version test utility
    it('should return the correct version number', async () => {
      expect(await fractalModule.version()).to.equal(1);
    });
  });

  describe('ERC165 supportsInterface', function () {
    let fractalModuleInstance: ModuleFractalV1;

    beforeEach(async function () {
      // Deploy a new instance for testing
      fractalModuleInstance = await deployFractalModuleProxy(
        proxyDeployer,
        masterCopy,
        owner,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
      );
    });

    runSupportsInterfaceTests({
      getContract: () => fractalModuleInstance,
      supportedInterfaceFactories: [
        IERC165__factory,
        IModuleFractalV1__factory,
        IVersion__factory,
        IDeploymentBlock__factory,
      ],
    });
  });

  describe('UUPS Upgradeability', function () {
    let fractalModule: ModuleFractalV1;

    beforeEach(async function () {
      // Deploy fractal module proxy
      fractalModule = await deployFractalModuleProxy(
        proxyDeployer,
        masterCopy,
        owner,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
      );

      // Set shared instance for deployment block tests
      sharedFractalModule = fractalModule;
    });

    // Run UUPS upgradeability tests
    runUUPSUpgradeabilityTests({
      getContract: () => fractalModule as unknown as UUPSUpgradeable,
      createNewImplementation: async () => {
        const newImplementation = await new ModuleFractalV1__factory(owner).deploy();
        return newImplementation as unknown as UUPSUpgradeable;
      },
      owner: () => owner,
      nonOwner: () => nonOwner,
    });
  });

  describe('Deployment Block', () => {
    runDeploymentBlockTests({
      getContract: () => sharedFractalModule as unknown as IDeploymentBlock,
    });
  });
});
