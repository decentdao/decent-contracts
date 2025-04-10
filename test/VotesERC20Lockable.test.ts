import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import type { ContractTransactionResponse } from 'ethers';
import { ethers } from 'hardhat';
import { VotesERC20Lockable, VotesERC20Lockable__factory } from '../typechain-types';
import { getModuleProxyFactory } from './GlobalSafeDeployments.test';
import { calculateProxyAddress } from './helpers';

async function deployVotesERC20Lockable(
  deployer: SignerWithAddress,
  implementation: VotesERC20Lockable,
  owner: SignerWithAddress,
  locked: boolean,
  name: string,
  symbol: string,
  allocationAddresses: string[],
  allocationAmounts: bigint[],
): Promise<VotesERC20Lockable> {
  const initializationCalldata = implementation.interface.encodeFunctionData('setUp', [
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

  return VotesERC20Lockable__factory.connect(proxyAddress, deployer);
}

describe('VotesERC20Lockable', () => {
  let implementation: VotesERC20Lockable;
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let nonOwner: SignerWithAddress;
  let whitelistMember: SignerWithAddress;
  let tokenHolder: SignerWithAddress;
  let tokenRecipient: SignerWithAddress;

  beforeEach(async () => {
    [deployer, owner, nonOwner, whitelistMember, tokenHolder, tokenRecipient] =
      await ethers.getSigners();

    implementation = await new VotesERC20Lockable__factory(owner).deploy();
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
  });

  describe('Lock function', () => {
    describe('When locked at deployment', () => {
      const locked = true;
      let proxy: VotesERC20Lockable;

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
            'Token is already locked',
          );
        });
      });
    });

    describe('When unlocked at deployment', () => {
      const locked = false;
      let proxy: VotesERC20Lockable;

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
          await expect(proxy.connect(owner).lock(false)).to.be.revertedWith('Token is not locked');
        });
      });
    });
  });

  describe('Whitelist function', () => {
    let proxy: VotesERC20Lockable;

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

  describe('Transfer function', () => {
    let proxy: VotesERC20Lockable;
    let tokenHolderAddresses: string[];
    let tokenHolderAmounts: bigint[];

    beforeEach(async () => {
      tokenHolderAddresses = [tokenHolder.address, owner.address];
      tokenHolderAmounts = [ethers.parseEther('100'), ethers.parseEther('100')];
    });

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
          await proxy.connect(tokenHolder).transfer(tokenRecipient.address, ethers.parseEther('1'));
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
          ).to.be.revertedWith('Token is locked');
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
          await proxy.connect(tokenHolder).transfer(tokenRecipient.address, ethers.parseEther('1'));
        });

        it('should transfer tokens', async () => {
          expect(await proxy.balanceOf(tokenRecipient.address)).to.equal(ethers.parseEther('1'));
          expect(await proxy.balanceOf(tokenHolder.address)).to.equal(ethers.parseEther('99'));
        });
      });

      describe('when caller is not owner or whitelisted', () => {
        beforeEach(async () => {
          await proxy.connect(tokenHolder).transfer(tokenRecipient.address, ethers.parseEther('1'));
        });

        it('should transfer tokens', async () => {
          expect(await proxy.balanceOf(tokenRecipient.address)).to.equal(ethers.parseEther('1'));
          expect(await proxy.balanceOf(tokenHolder.address)).to.equal(ethers.parseEther('99'));
        });
      });
    });
  });
});
