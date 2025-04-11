import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import type { ContractTransactionResponse } from 'ethers';
import { ethers } from 'hardhat';
import {
  IERC165__factory,
  IERC20Upgradeable__factory,
  ILockableV1__factory,
  IVersion__factory,
  VotesERC20LockableV1,
  VotesERC20LockableV1__factory,
} from '../typechain-types';
import { getModuleProxyFactory } from './GlobalSafeDeployments.test';
import { calculateProxyAddress } from './helpers';
import { calculateInterfaceId } from './helpers/utils';

async function deployVotesERC20Lockable(
  deployer: SignerWithAddress,
  implementation: VotesERC20LockableV1,
  owner: SignerWithAddress,
  locked: boolean,
  name: string,
  symbol: string,
  allocationAddresses: string[],
  allocationAmounts: bigint[],
): Promise<VotesERC20LockableV1> {
  const initializationCalldata = implementation.interface.encodeFunctionData('initialize', [
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'bool', 'string', 'string', 'address[]', 'uint256[]'],
      [owner.address, locked, name, symbol, allocationAddresses, allocationAmounts],
    ),
  ]);

  const moduleProxyFactory = getModuleProxyFactory();
  const salt = ethers.keccak256(ethers.randomBytes(32));

  await moduleProxyFactory.deployModule(
    await implementation.getAddress(),
    initializationCalldata,
    salt,
  );

  const proxyAddress = await calculateProxyAddress(
    moduleProxyFactory,
    await implementation.getAddress(),
    initializationCalldata,
    salt,
  );

  return VotesERC20LockableV1__factory.connect(proxyAddress, deployer);
}

describe.only('VotesERC20Lockable', () => {
  let implementation: VotesERC20LockableV1;
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let nonOwner: SignerWithAddress;
  let whitelistMember: SignerWithAddress;
  let tokenHolder: SignerWithAddress;
  let tokenRecipient: SignerWithAddress;
  let spender: SignerWithAddress;

  beforeEach(async () => {
    [deployer, owner, nonOwner, whitelistMember, tokenHolder, tokenRecipient, spender] =
      await ethers.getSigners();

    implementation = await new VotesERC20LockableV1__factory(owner).deploy();
  });

  describe('Initialization', () => {
    describe('Locked Behavior', () => {
      it('should be be locked on deployment', async () => {
        const proxy = await deployVotesERC20Lockable(
          deployer,
          implementation,
          owner,
          true,
          'Test',
          'TEST',
          [],
          [],
        );
        expect(await proxy.locked()).to.equal(true);
      });

      it('should be unlocked on deployment', async () => {
        const proxy = await deployVotesERC20Lockable(
          deployer,
          implementation,
          owner,
          false,
          'Test',
          'TEST',
          [],
          [],
        );
        expect(await proxy.locked()).to.equal(false);
      });
    });

    describe('Setup safety', () => {
      let proxy: VotesERC20LockableV1;

      beforeEach(async () => {
        proxy = await deployVotesERC20Lockable(
          deployer,
          implementation,
          owner,
          false,
          'Test',
          'TEST',
          [],
          [],
        );
      });

      it('should revert if initializer is called after deployment', async () => {
        await expect(
          proxy.initialize(
            ethers.AbiCoder.defaultAbiCoder().encode(
              ['address', 'bool', 'string', 'string', 'address[]', 'uint256[]'],
              [owner.address, false, 'Test', 'TEST', [], []],
            ),
          ),
        ).to.be.revertedWith('Initializable: contract is already initialized');
      });
    });
  });

  describe('Lock function', () => {
    describe('When locked at deployment', () => {
      const locked = true;
      let proxy: VotesERC20LockableV1;

      beforeEach(async () => {
        proxy = await deployVotesERC20Lockable(
          deployer,
          implementation,
          owner,
          locked,
          'Test',
          'TEST',
          [],
          [],
        );
      });

      describe('Unlocking by the owner should succeed', () => {
        let unlockTx: ContractTransactionResponse;

        beforeEach(async () => {
          unlockTx = await proxy.connect(owner).lock(false);
        });

        it('should be unlocked', async () => {
          expect(await proxy.locked()).to.equal(false);
        });

        it('should emit an event', async () => {
          expect(unlockTx).to.emit(proxy, 'Locked').withArgs(false);
        });
      });

      describe('Unlocking by a non-owner should fail', () => {
        it('should revert', async () => {
          await expect(proxy.connect(nonOwner).lock(false)).to.be.revertedWith(
            'Ownable: caller is not the owner',
          );
        });
      });

      describe('Trying to lock should fail', () => {
        it('should revert', async () => {
          await expect(proxy.connect(owner).lock(true)).to.be.revertedWith(
            'VotesERC20LockableV1: Token is already locked',
          );
        });
      });
    });

    describe('When unlocked at deployment', () => {
      const locked = false;
      let proxy: VotesERC20LockableV1;

      beforeEach(async () => {
        proxy = await deployVotesERC20Lockable(
          deployer,
          implementation,
          owner,
          locked,
          'Test',
          'TEST',
          [],
          [],
        );
      });

      describe('Locking by the owner should succeed', () => {
        let lockTx: ContractTransactionResponse;

        beforeEach(async () => {
          lockTx = await proxy.connect(owner).lock(true);
        });

        it('should be locked', async () => {
          expect(await proxy.locked()).to.equal(true);
        });

        it('should emit an event', async () => {
          expect(lockTx).to.emit(proxy, 'Locked').withArgs(true);
        });
      });

      describe('Locking by a non-owner should fail', () => {
        it('should revert', async () => {
          await expect(proxy.connect(nonOwner).lock(true)).to.be.revertedWith(
            'Ownable: caller is not the owner',
          );
        });
      });

      describe('Trying to unlock should fail', () => {
        it('should revert', async () => {
          await expect(proxy.connect(owner).lock(false)).to.be.revertedWith(
            'VotesERC20LockableV1: Token is not locked',
          );
        });
      });
    });
  });

  describe('Whitelist function', () => {
    let proxy: VotesERC20LockableV1;

    beforeEach(async () => {
      proxy = await deployVotesERC20Lockable(
        deployer,
        implementation,
        owner,
        false,
        'Test',
        'TEST',
        [],
        [],
      );
    });

    describe('Adding to whitelist', () => {
      describe('When caller is owner', () => {
        let addTx: ContractTransactionResponse;

        beforeEach(async () => {
          addTx = await proxy.connect(owner).whitelist(whitelistMember.address, true);
        });

        it('should add to whitelist', async () => {
          expect(await proxy.whitelisted(whitelistMember.address)).to.equal(true);
        });

        it('should emit an event', async () => {
          await expect(addTx).to.emit(proxy, 'Whitelisted').withArgs(whitelistMember.address, true);
        });

        describe('When adding the same address again', () => {
          beforeEach(async () => {
            addTx = await proxy.connect(owner).whitelist(whitelistMember.address, true);
          });

          it('should not emit an event', async () => {
            await expect(addTx).to.not.emit(proxy, 'Whitelisted');
          });
        });
      });

      describe('When caller is not owner', () => {
        it('should revert', async () => {
          await expect(
            proxy.connect(nonOwner).whitelist(whitelistMember.address, true),
          ).to.be.revertedWith('Ownable: caller is not the owner');
        });
      });
    });

    describe('Removing from whitelist', () => {
      beforeEach(async () => {
        await proxy.connect(owner).whitelist(whitelistMember.address, true);
      });

      describe('When caller is owner', () => {
        let removeTx: ContractTransactionResponse;

        beforeEach(async () => {
          removeTx = await proxy.connect(owner).whitelist(whitelistMember.address, false);
        });

        it('should remove from whitelist', async () => {
          expect(await proxy.whitelisted(whitelistMember.address)).to.equal(false);
        });

        it('should emit an event', async () => {
          expect(removeTx).to.emit(proxy, 'Whitelisted').withArgs(whitelistMember.address, false);
        });

        describe('When removing the same address again', () => {
          beforeEach(async () => {
            removeTx = await proxy.connect(owner).whitelist(whitelistMember.address, false);
          });

          it('should not emit an event', async () => {
            await expect(removeTx).to.not.emit(proxy, 'Whitelisted');
          });
        });
      });

      describe('When caller is not owner', () => {
        it('should revert', async () => {
          await expect(
            proxy.connect(nonOwner).whitelist(whitelistMember.address, false),
          ).to.be.revertedWith('Ownable: caller is not the owner');
        });
      });
    });
  });

  describe('Transferring Tokens', () => {
    let tokenHolderAddresses: string[];
    let tokenHolderAmounts: bigint[];

    beforeEach(async () => {
      tokenHolderAddresses = [tokenHolder.address, owner.address];
      tokenHolderAmounts = [ethers.parseEther('100'), ethers.parseEther('100')];
    });

    describe('Transfer function', () => {
      let proxy: VotesERC20LockableV1;

      describe('when token is locked', () => {
        const locked = true;

        beforeEach(async () => {
          proxy = await deployVotesERC20Lockable(
            deployer,
            implementation,
            owner,
            locked,
            'Test',
            'TEST',
            tokenHolderAddresses,
            tokenHolderAmounts,
          );
        });

        describe('when caller is owner', () => {
          beforeEach(async () => {
            await proxy.connect(owner).transfer(tokenRecipient.address, ethers.parseEther('1'));
          });

          it('should transfer tokens', async () => {
            expect(await proxy.balanceOf(tokenRecipient.address)).to.equal(ethers.parseEther('1'));
            expect(await proxy.balanceOf(owner.address)).to.equal(ethers.parseEther('99'));
          });
        });

        describe('when caller is whitelisted', () => {
          beforeEach(async () => {
            await proxy.connect(owner).whitelist(tokenHolder.address, true);
            await proxy
              .connect(tokenHolder)
              .transfer(tokenRecipient.address, ethers.parseEther('1'));
          });

          it('should transfer tokens', async () => {
            expect(await proxy.balanceOf(tokenRecipient.address)).to.equal(ethers.parseEther('1'));
            expect(await proxy.balanceOf(tokenHolder.address)).to.equal(ethers.parseEther('99'));
          });
        });

        describe('when caller is not owner or whitelisted', () => {
          it('should revert', async () => {
            await expect(
              proxy.connect(tokenHolder).transfer(tokenRecipient.address, ethers.parseEther('1')),
            ).to.be.revertedWith('VotesERC20LockableV1: Token is locked');
          });
        });
      });

      describe('when token is not locked', () => {
        const locked = false;

        beforeEach(async () => {
          proxy = await deployVotesERC20Lockable(
            deployer,
            implementation,
            owner,
            locked,
            'Test',
            'TEST',
            tokenHolderAddresses,
            tokenHolderAmounts,
          );
        });

        describe('when caller is owner', () => {
          beforeEach(async () => {
            await proxy.connect(owner).transfer(tokenRecipient.address, ethers.parseEther('1'));
          });

          it('should transfer tokens', async () => {
            expect(await proxy.balanceOf(tokenRecipient.address)).to.equal(ethers.parseEther('1'));
            expect(await proxy.balanceOf(owner.address)).to.equal(ethers.parseEther('99'));
          });
        });

        describe('when caller is whitelisted', () => {
          beforeEach(async () => {
            await proxy.connect(owner).whitelist(tokenHolder.address, true);
            await proxy
              .connect(tokenHolder)
              .transfer(tokenRecipient.address, ethers.parseEther('1'));
          });

          it('should transfer tokens', async () => {
            expect(await proxy.balanceOf(tokenRecipient.address)).to.equal(ethers.parseEther('1'));
            expect(await proxy.balanceOf(tokenHolder.address)).to.equal(ethers.parseEther('99'));
          });
        });

        describe('when caller is not owner or whitelisted', () => {
          beforeEach(async () => {
            await proxy
              .connect(tokenHolder)
              .transfer(tokenRecipient.address, ethers.parseEther('1'));
          });

          it('should transfer tokens', async () => {
            expect(await proxy.balanceOf(tokenRecipient.address)).to.equal(ethers.parseEther('1'));
            expect(await proxy.balanceOf(tokenHolder.address)).to.equal(ethers.parseEther('99'));
          });
        });
      });
    });

    describe('TransferFrom function', () => {
      let proxy: VotesERC20LockableV1;

      describe('when token is locked', () => {
        const locked = true;

        beforeEach(async () => {
          proxy = await deployVotesERC20Lockable(
            deployer,
            implementation,
            owner,
            locked,
            'Test',
            'TEST',
            tokenHolderAddresses,
            tokenHolderAmounts,
          );
        });

        describe('when token holder is owner', () => {
          beforeEach(async () => {
            await proxy.connect(owner).approve(spender.address, ethers.parseEther('10'));
            await proxy
              .connect(spender)
              .transferFrom(owner.address, tokenRecipient.address, ethers.parseEther('1'));
          });

          it('should transfer tokens', async () => {
            expect(await proxy.balanceOf(tokenRecipient.address)).to.equal(ethers.parseEther('1'));
            expect(await proxy.balanceOf(owner.address)).to.equal(ethers.parseEther('99'));
          });

          it('should decrease allowance', async () => {
            expect(await proxy.allowance(owner.address, spender.address)).to.equal(
              ethers.parseEther('9'),
            );
          });
        });

        describe('when token holder is whitelisted', () => {
          beforeEach(async () => {
            await proxy.connect(owner).whitelist(tokenHolder.address, true);
            await proxy.connect(tokenHolder).approve(spender.address, ethers.parseEther('10'));
            await proxy
              .connect(spender)
              .transferFrom(tokenHolder.address, tokenRecipient.address, ethers.parseEther('1'));
          });

          it('should transfer tokens', async () => {
            expect(await proxy.balanceOf(tokenRecipient.address)).to.equal(ethers.parseEther('1'));
            expect(await proxy.balanceOf(tokenHolder.address)).to.equal(ethers.parseEther('99'));
          });

          it('should decrease allowance', async () => {
            expect(await proxy.allowance(tokenHolder.address, spender.address)).to.equal(
              ethers.parseEther('9'),
            );
          });
        });

        describe('when token holder is not owner or whitelisted', () => {
          beforeEach(async () => {
            await proxy.connect(tokenHolder).approve(spender.address, ethers.parseEther('10'));
          });

          it('should revert', async () => {
            await expect(
              proxy
                .connect(spender)
                .transferFrom(tokenHolder.address, tokenRecipient.address, ethers.parseEther('1')),
            ).to.be.revertedWith('VotesERC20LockableV1: Token is locked');
          });
        });
      });

      describe('when token is not locked', () => {
        const locked = false;

        beforeEach(async () => {
          proxy = await deployVotesERC20Lockable(
            deployer,
            implementation,
            owner,
            locked,
            'Test',
            'TEST',
            tokenHolderAddresses,
            tokenHolderAmounts,
          );
        });

        describe('when token holder is owner', () => {
          beforeEach(async () => {
            await proxy.connect(owner).approve(spender.address, ethers.parseEther('10'));
            await proxy
              .connect(spender)
              .transferFrom(owner.address, tokenRecipient.address, ethers.parseEther('1'));
          });

          it('should transfer tokens', async () => {
            expect(await proxy.balanceOf(tokenRecipient.address)).to.equal(ethers.parseEther('1'));
            expect(await proxy.balanceOf(owner.address)).to.equal(ethers.parseEther('99'));
          });

          it('should decrease allowance', async () => {
            expect(await proxy.allowance(owner.address, spender.address)).to.equal(
              ethers.parseEther('9'),
            );
          });
        });

        describe('when token holder is whitelisted', () => {
          beforeEach(async () => {
            await proxy.connect(owner).whitelist(tokenHolder.address, true);
            await proxy.connect(tokenHolder).approve(spender.address, ethers.parseEther('10'));
            await proxy
              .connect(spender)
              .transferFrom(tokenHolder.address, tokenRecipient.address, ethers.parseEther('1'));
          });

          it('should transfer tokens', async () => {
            expect(await proxy.balanceOf(tokenRecipient.address)).to.equal(ethers.parseEther('1'));
            expect(await proxy.balanceOf(tokenHolder.address)).to.equal(ethers.parseEther('99'));
          });

          it('should decrease allowance', async () => {
            expect(await proxy.allowance(tokenHolder.address, spender.address)).to.equal(
              ethers.parseEther('9'),
            );
          });
        });

        describe('when token holder is not owner or whitelisted', () => {
          beforeEach(async () => {
            await proxy.connect(tokenHolder).approve(spender.address, ethers.parseEther('10'));
            await proxy
              .connect(spender)
              .transferFrom(tokenHolder.address, tokenRecipient.address, ethers.parseEther('1'));
          });

          it('should transfer tokens', async () => {
            expect(await proxy.balanceOf(tokenRecipient.address)).to.equal(ethers.parseEther('1'));
            expect(await proxy.balanceOf(tokenHolder.address)).to.equal(ethers.parseEther('99'));
          });

          it('should decrease allowance', async () => {
            expect(await proxy.allowance(tokenHolder.address, spender.address)).to.equal(
              ethers.parseEther('9'),
            );
          });
        });

        describe('when spender has insufficient allowance', () => {
          beforeEach(async () => {
            await proxy.connect(tokenHolder).approve(spender.address, ethers.parseEther('0.5'));
          });

          it('should revert', async () => {
            await expect(
              proxy
                .connect(spender)
                .transferFrom(tokenHolder.address, tokenRecipient.address, ethers.parseEther('1')),
            ).to.be.revertedWith('ERC20: insufficient allowance');
          });
        });
      });
    });
  });

  describe('Version', () => {
    it('should return the correct version', async () => {
      const proxy = await deployVotesERC20Lockable(
        deployer,
        implementation,
        owner,
        false,
        'Test',
        'TEST',
        [],
        [],
      );
      expect(await proxy.getVersion()).to.equal(1);
    });
  });

  describe('ERC165', function () {
    let proxy: VotesERC20LockableV1;
    let iVersionInterfaceId: string;
    let iERC165InterfaceId: string;
    let iLockableV1InterfaceId: string;
    let iERC20UpgradeableInterfaceId: string;

    beforeEach(async function () {
      proxy = await deployVotesERC20Lockable(
        deployer,
        implementation,
        owner,
        false,
        'Test',
        'TEST',
        [],
        [],
      );

      // Dynamically calculate interface IDs
      const IVersionInterface = IVersion__factory.createInterface();
      iVersionInterfaceId = calculateInterfaceId(IVersionInterface);

      const IERC165Interface = IERC165__factory.createInterface();
      iERC165InterfaceId = calculateInterfaceId(IERC165Interface);

      const ILockableV1Interface = ILockableV1__factory.createInterface();
      iLockableV1InterfaceId = calculateInterfaceId(ILockableV1Interface);

      const IERC20UpgradeableInterface = IERC20Upgradeable__factory.createInterface();
      iERC20UpgradeableInterfaceId = calculateInterfaceId(IERC20UpgradeableInterface);
    });

    it('Should support IERC165 interface', async function () {
      const supported = await proxy.supportsInterface(iERC165InterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IVersion interface', async function () {
      const supported = await proxy.supportsInterface(iVersionInterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support ILockableV1 interface', async function () {
      const supported = await proxy.supportsInterface(iLockableV1InterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IERC20Upgradeable interface', async function () {
      const supported = await proxy.supportsInterface(iERC20UpgradeableInterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should not support random interface', async function () {
      const randomInterfaceId = '0x12345678';
      const supported = await proxy.supportsInterface(randomInterfaceId);
      void expect(supported).to.be.false;
    });
  });
});
