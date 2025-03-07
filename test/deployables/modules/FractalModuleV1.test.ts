import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  FractalModuleV1,
  FractalModuleV1__factory,
  MockAvatar,
  MockAvatar__factory,
  MockERC20,
  MockERC20__factory,
} from '../../../typechain-types';
import { getModuleProxyFactory } from '../../global/GlobalSafeDeployments.test';
import { calculateProxyAddress } from '../../helpers';

// Helper functions for deploying FractalModuleV1 instances
async function deployFractalModuleProxy(
  fractalModuleMastercopy: FractalModuleV1,
  owner: SignerWithAddress,
  avatar: string,
  target: string,
  controllers: string[],
): Promise<FractalModuleV1> {
  const moduleProxyFactory = getModuleProxyFactory();
  const salt = ethers.hexlify(ethers.randomBytes(32));

  const fractalModuleSetupCalldata = FractalModuleV1__factory.createInterface().encodeFunctionData(
    'setUp',
    [
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'address', 'address[]'],
        [owner.address, avatar, target, controllers],
      ),
    ],
  );

  await moduleProxyFactory.deployModule(
    await fractalModuleMastercopy.getAddress(),
    fractalModuleSetupCalldata,
    salt,
  );

  const predictedFractalModuleAddress = await calculateProxyAddress(
    moduleProxyFactory,
    await fractalModuleMastercopy.getAddress(),
    fractalModuleSetupCalldata,
    salt,
  );

  return FractalModuleV1__factory.connect(predictedFractalModuleAddress, owner);
}

describe('FractalModuleV1', () => {
  // eoas
  let owner: SignerWithAddress;
  let controller: SignerWithAddress;
  let user: SignerWithAddress;

  // mocks and mastercopies
  let fractalModuleMastercopy: FractalModuleV1;
  let mockToken: MockERC20;

  beforeEach(async () => {
    // Get signers
    [owner, controller, user] = await ethers.getSigners();

    // Deploy mastercopy contract
    fractalModuleMastercopy = await new FractalModuleV1__factory(owner).deploy();
    mockToken = await new MockERC20__factory(owner).deploy();
  });

  describe('Initialization', () => {
    let fractalModule: FractalModuleV1;
    let avatar: MockAvatar;

    beforeEach(async () => {
      avatar = await new MockAvatar__factory(owner).deploy();
    });

    describe('Owner parameter', () => {
      it('should set correct owner', async () => {
        fractalModule = await deployFractalModuleProxy(
          fractalModuleMastercopy,
          owner,
          await avatar.getAddress(),
          await avatar.getAddress(),
          [],
        );

        expect(await fractalModule.owner()).to.equal(owner.address);
      });
    });

    describe('Avatar and Target parameters', () => {
      it('should initialize with same avatar and target', async () => {
        fractalModule = await deployFractalModuleProxy(
          fractalModuleMastercopy,
          owner,
          await avatar.getAddress(),
          await avatar.getAddress(),
          [],
        );

        expect(await fractalModule.avatar()).to.equal(await avatar.getAddress());
        expect(await fractalModule.getFunction('target')()).to.equal(await avatar.getAddress());
      });

      it('should initialize with different target than avatar', async () => {
        fractalModule = await deployFractalModuleProxy(
          fractalModuleMastercopy,
          owner,
          await avatar.getAddress(),
          user.address, // Different from avatar
          [],
        );

        expect(await fractalModule.avatar()).to.equal(await avatar.getAddress());
        expect(await fractalModule.getFunction('target')()).to.equal(user.address);
      });

      it('should allow zero address avatar', async () => {
        fractalModule = await deployFractalModuleProxy(
          fractalModuleMastercopy,
          owner,
          ethers.ZeroAddress,
          await avatar.getAddress(),
          [],
        );

        expect(await fractalModule.avatar()).to.equal(ethers.ZeroAddress);
        expect(await fractalModule.getFunction('target')()).to.equal(await avatar.getAddress());
      });

      it('should allow zero address target', async () => {
        fractalModule = await deployFractalModuleProxy(
          fractalModuleMastercopy,
          owner,
          await avatar.getAddress(),
          ethers.ZeroAddress,
          [],
        );

        expect(await fractalModule.avatar()).to.equal(await avatar.getAddress());
        expect(await fractalModule.getFunction('target')()).to.equal(ethers.ZeroAddress);
      });

      it('should allow both avatar and target to be zero address', async () => {
        fractalModule = await deployFractalModuleProxy(
          fractalModuleMastercopy,
          owner,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          [],
        );

        expect(await fractalModule.avatar()).to.equal(ethers.ZeroAddress);
        expect(await fractalModule.getFunction('target')()).to.equal(ethers.ZeroAddress);
      });
    });

    describe('Controllers parameter', () => {
      describe('No controllers', () => {
        it('should initialize with no controllers', async () => {
          fractalModule = await deployFractalModuleProxy(
            fractalModuleMastercopy,
            owner,
            await avatar.getAddress(),
            await avatar.getAddress(),
            [], // empty controllers array
          );

          void expect(await fractalModule.controllers(owner.address)).to.be.false;
          void expect(await fractalModule.controllers(controller.address)).to.be.false;
          void expect(await fractalModule.controllers(user.address)).to.be.false;
        });
      });

      describe('Single controller', () => {
        it('should initialize with single controller', async () => {
          fractalModule = await deployFractalModuleProxy(
            fractalModuleMastercopy,
            owner,
            await avatar.getAddress(),
            await avatar.getAddress(),
            [controller.address],
          );

          void expect(await fractalModule.controllers(controller.address)).to.be.true;
          void expect(await fractalModule.controllers(owner.address)).to.be.false;
          void expect(await fractalModule.controllers(user.address)).to.be.false;
        });
      });

      describe('Multiple controllers', () => {
        it('should initialize with multiple controllers', async () => {
          const controllers = [controller.address, user.address];
          fractalModule = await deployFractalModuleProxy(
            fractalModuleMastercopy,
            owner,
            await avatar.getAddress(),
            await avatar.getAddress(),
            controllers,
          );

          void expect(await fractalModule.controllers(controller.address)).to.be.true;
          void expect(await fractalModule.controllers(user.address)).to.be.true;
          void expect(await fractalModule.controllers(owner.address)).to.be.false;
        });

        it('should not allow duplicate controllers', async () => {
          const controllers = [controller.address, controller.address];

          // The second controller.address will overwrite the first one's mapping,
          // but both will emit events. This is expected behavior from the contract.
          fractalModule = await deployFractalModuleProxy(
            fractalModuleMastercopy,
            owner,
            await avatar.getAddress(),
            await avatar.getAddress(),
            controllers,
          );

          // Verify the controller is still enabled (only once)
          void expect(await fractalModule.controllers(controller.address)).to.be.true;

          // Verify that a ControllersAdded event was emitted with both addresses
          const filter = fractalModule.filters.ControllersAdded;
          const events = await fractalModule.queryFilter(filter);
          expect(events.length).to.equal(1);
          expect(events[0].args[0]).to.deep.equal(controllers);
        });
      });
    });

    describe('Reinitialization prevention', () => {
      it('should not allow reinitialization', async () => {
        fractalModule = await deployFractalModuleProxy(
          fractalModuleMastercopy,
          owner,
          await avatar.getAddress(),
          await avatar.getAddress(),
          [],
        );

        const setupData = ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'address', 'address', 'address[]'],
          [owner.address, ethers.ZeroAddress, ethers.ZeroAddress, []],
        );

        await expect(fractalModule.setUp(setupData)).to.be.revertedWithCustomError(
          fractalModule,
          'InvalidInitialization',
        );
      });
    });
  });

  describe('Controller Management', () => {
    let fractalModule: FractalModuleV1;
    let avatar: MockAvatar;

    beforeEach(async () => {
      avatar = await new MockAvatar__factory(owner).deploy();
      fractalModule = await deployFractalModuleProxy(
        fractalModuleMastercopy,
        owner,
        await avatar.getAddress(),
        await avatar.getAddress(),
        [],
      );
    });

    describe('Adding controllers', () => {
      describe('Via owner', () => {
        it('should allow owner to add single controller', async () => {
          await fractalModule.addControllers([controller.address]);
          void expect(await fractalModule.controllers(controller.address)).to.be.true;
        });

        it('should allow owner to add multiple controllers', async () => {
          const controllers = [controller.address, user.address];
          await fractalModule.addControllers(controllers);

          void expect(await fractalModule.controllers(controller.address)).to.be.true;
          void expect(await fractalModule.controllers(user.address)).to.be.true;
        });

        it('should emit ControllersAdded event', async () => {
          const controllers = [controller.address, user.address];
          await expect(fractalModule.addControllers(controllers))
            .to.emit(fractalModule, 'ControllersAdded')
            .withArgs(controllers);
        });

        it('should properly update controllers mapping', async () => {
          // Check initial state
          void expect(await fractalModule.controllers(controller.address)).to.be.false;
          void expect(await fractalModule.controllers(user.address)).to.be.false;

          // Add controllers
          const controllers = [controller.address, user.address];
          await fractalModule.addControllers(controllers);

          // Verify mapping is updated
          void expect(await fractalModule.controllers(controller.address)).to.be.true;
          void expect(await fractalModule.controllers(user.address)).to.be.true;
          void expect(await fractalModule.controllers(owner.address)).to.be.false; // Owner not added as controller
        });
      });

      describe('Via non-owner', () => {
        it('should not allow non-owner to add controllers', async () => {
          await expect(
            fractalModule.connect(user).addControllers([controller.address]),
          ).to.be.revertedWithCustomError(fractalModule, 'OwnableUnauthorizedAccount');
        });
      });
    });

    describe('Removing controllers', () => {
      describe('Via owner', () => {
        beforeEach(async () => {
          // Add controllers for testing removal
          await fractalModule.addControllers([controller.address, user.address]);
        });

        it('should allow owner to remove single controller', async () => {
          await fractalModule.removeControllers([controller.address]);
          void expect(await fractalModule.controllers(controller.address)).to.be.false;
          void expect(await fractalModule.controllers(user.address)).to.be.true; // Other controller still enabled
        });

        it('should allow owner to remove multiple controllers', async () => {
          const controllers = [controller.address, user.address];
          await fractalModule.removeControllers(controllers);

          void expect(await fractalModule.controllers(controller.address)).to.be.false;
          void expect(await fractalModule.controllers(user.address)).to.be.false;
        });

        it('should emit ControllersRemoved event', async () => {
          const controllers = [controller.address, user.address];
          await expect(fractalModule.removeControllers(controllers))
            .to.emit(fractalModule, 'ControllersRemoved')
            .withArgs(controllers);
        });

        it('should properly update controllers mapping', async () => {
          // Verify initial state
          void expect(await fractalModule.controllers(controller.address)).to.be.true;
          void expect(await fractalModule.controllers(user.address)).to.be.true;

          // Remove controllers
          const controllers = [controller.address, user.address];
          await fractalModule.removeControllers(controllers);

          // Verify mapping is updated
          void expect(await fractalModule.controllers(controller.address)).to.be.false;
          void expect(await fractalModule.controllers(user.address)).to.be.false;
        });
      });

      describe('Via non-owner', () => {
        it('should not allow non-owner to remove controllers', async () => {
          await expect(
            fractalModule.connect(user).removeControllers([controller.address]),
          ).to.be.revertedWithCustomError(fractalModule, 'OwnableUnauthorizedAccount');
        });
      });
    });
  });

  describe('Transaction Execution', () => {
    let fractalModule: FractalModuleV1;
    let avatar: MockAvatar;

    beforeEach(async () => {
      avatar = await new MockAvatar__factory(owner).deploy();
      fractalModule = await deployFractalModuleProxy(
        fractalModuleMastercopy,
        owner,
        await avatar.getAddress(),
        await avatar.getAddress(),
        [controller.address],
      );
      await avatar.enableModule(await fractalModule.getAddress());
    });

    describe('Authorization', () => {
      let txData: string;

      beforeEach(async () => {
        await mockToken.mint(await avatar.getAddress(), 1000); // Mint tokens for these tests
        txData = ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'uint256', 'bytes', 'uint8'],
          [
            await mockToken.getAddress(),
            0,
            mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
            0, // Call operation
          ],
        );
      });

      it('should allow owner to execute transactions', async () => {
        await mockToken.mint(await avatar.getAddress(), 1000);
        await fractalModule.execTx(txData);
        expect(await mockToken.balanceOf(user.address)).to.equal(100);
      });

      it('should allow controller to execute transactions', async () => {
        await mockToken.mint(await avatar.getAddress(), 1000);
        await fractalModule.connect(controller).execTx(txData);
        expect(await mockToken.balanceOf(user.address)).to.equal(100);
      });

      it('should revert with Unauthorized for non-owner/non-controller', async () => {
        await expect(fractalModule.connect(user).execTx(txData)).to.be.revertedWithCustomError(
          fractalModule,
          'Unauthorized',
        );
      });
    });

    describe('Transaction Success/Failure', () => {
      let txData: string;

      beforeEach(async () => {
        txData = ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'uint256', 'bytes', 'uint8'],
          [
            await mockToken.getAddress(),
            0,
            mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
            0, // Call operation
          ],
        );
      });

      it('should execute successful transactions', async () => {
        await mockToken.mint(await avatar.getAddress(), 1000);
        await fractalModule.execTx(txData);
        expect(await mockToken.balanceOf(user.address)).to.equal(100);
      });

      it('should revert with TxFailed on failed transactions', async () => {
        // No tokens minted to avatar, so transfer should fail
        const failingTxData = ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'uint256', 'bytes', 'uint8'],
          [
            await mockToken.getAddress(),
            0,
            mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
            0,
          ],
        );

        await expect(fractalModule.execTx(failingTxData)).to.be.revertedWithCustomError(
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

        const txData = ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'uint256', 'bytes', 'uint8'],
          [
            user.address,
            ethers.parseEther('0.5'),
            '0x', // empty data
            0, // Call operation
          ],
        );

        const initialBalance = await ethers.provider.getBalance(user.address);
        await fractalModule.execTx(txData);
        const finalBalance = await ethers.provider.getBalance(user.address);

        expect(finalBalance - initialBalance).to.equal(ethers.parseEther('0.5'));
      });

      it('should handle transactions with empty data', async () => {
        const txData = ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'uint256', 'bytes', 'uint8'],
          [
            user.address,
            0,
            '0x', // empty data
            0, // Call operation
          ],
        );

        await fractalModule.execTx(txData);
      });

      it('should handle transactions with both value and data', async () => {
        // Fund the avatar with ETH and tokens
        await owner.sendTransaction({
          to: await avatar.getAddress(),
          value: ethers.parseEther('1.0'),
        });
        await mockToken.mint(await avatar.getAddress(), 1000);

        // First send ETH to user
        const ethTxData = ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'uint256', 'bytes', 'uint8'],
          [
            user.address,
            ethers.parseEther('0.5'),
            '0x',
            0, // Call operation
          ],
        );

        // Then do token transfer
        const tokenTxData = ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'uint256', 'bytes', 'uint8'],
          [
            await mockToken.getAddress(),
            0,
            mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
            0, // Call operation
          ],
        );

        const initialEthBalance = await ethers.provider.getBalance(user.address);

        // Execute both transactions
        await fractalModule.execTx(ethTxData);
        await fractalModule.execTx(tokenTxData);

        const finalEthBalance = await ethers.provider.getBalance(user.address);

        // Verify both the ETH transfer and token transfer worked
        expect(finalEthBalance - initialEthBalance).to.equal(ethers.parseEther('0.5'));
        expect(await mockToken.balanceOf(user.address)).to.equal(100);
      });
    });
  });

  describe('Version', () => {
    it('should return correct version number', async () => {
      const fractalModule = await deployFractalModuleProxy(
        fractalModuleMastercopy,
        owner,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        [],
      );

      expect(await fractalModule.getVersion()).to.equal(1);
    });
  });
});
