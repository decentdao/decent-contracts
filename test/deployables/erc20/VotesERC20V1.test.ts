import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { mine, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import type { ContractTransactionResponse } from 'ethers';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  IAccessControl__factory,
  IDeploymentBlockV1__factory,
  IERC165__factory,
  IERC20__factory,
  IERC20Permit__factory,
  IVersion__factory,
  IVotes__factory,
  IVotesERC20V1__factory,
  VotesERC20V1,
  VotesERC20V1__factory,
} from '../../../typechain-types';
import { runDeploymentBlockTests } from '../../shared/deploymentBlockTests';
import { runSupportsInterfaceTests } from '../../shared/supportsInterfaceTests';
import { runUUPSUpgradeabilityTests } from '../../shared/uupsUpgradeabilityTests';

// Helper function for deploying VotesERC20V1 instances using ERC1967Proxy
async function deployVotesERC20Proxy(
  proxyDeployer: SignerWithAddress,
  owner: SignerWithAddress,
  locked: boolean,
  maxTotalSupply: bigint,
  name: string,
  symbol: string,
  allocationAddresses: string[],
  allocationAmounts: bigint[],
): Promise<VotesERC20V1> {
  // Create initialization data with function selector

  const allocations = allocationAddresses.map((address, index) => ({
    to: address,
    amount: allocationAmounts[index],
  }));

  const metadata = {
    name,
    symbol,
  };

  const fullInitData = VotesERC20V1__factory.createInterface().encodeFunctionData('initialize', [
    metadata,
    allocations,
    owner.address,
    locked,
    maxTotalSupply,
  ]);

  const implementation = await new VotesERC20V1__factory(proxyDeployer).deploy();

  // Deploy the proxy with the implementation
  const proxy = await new ERC1967Proxy__factory(proxyDeployer).deploy(implementation, fullInitData);

  // Return a contract instance connected to the proxy
  return VotesERC20V1__factory.connect(await proxy.getAddress(), owner);
}

describe('VotesERC20V1', () => {
  // signers
  let proxyDeployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  let nonOwner: SignerWithAddress;
  let tokenHolder: SignerWithAddress;
  let tokenRecipient: SignerWithAddress;
  let spender: SignerWithAddress;

  const TRANSFER_FROM_ROLE = ethers.id('TRANSFER_FROM_ROLE');
  const TRANSFER_TO_ROLE = ethers.id('TRANSFER_TO_ROLE');
  const MINTER_ROLE = ethers.id('MINTER_ROLE');

  // contracts
  let votesERC20: VotesERC20V1;

  beforeEach(async () => {
    // Get signers
    [proxyDeployer, owner, alice, bob, carol, nonOwner, tokenHolder, tokenRecipient, spender] =
      await ethers.getSigners();
  });

  describe('Initialization', () => {
    it('should initialize with correct name and symbol', async () => {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        owner,
        false,
        ethers.parseEther('2100'),
        'Test Voting Token',
        'TVT',
        [],
        [],
      );

      expect(await votesERC20.name()).to.equal('Test Voting Token');
      expect(await votesERC20.symbol()).to.equal('TVT');
    });

    it('should mint initial tokens according to allocations', async () => {
      const allocationAddresses = [alice.address, bob.address, carol.address];
      const allocationAmounts = [
        ethers.parseEther('100'),
        ethers.parseEther('200'),
        ethers.parseEther('300'),
      ];

      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        owner,
        false,
        ethers.parseEther('2100'),
        'Test Voting Token',
        'TVT',
        allocationAddresses,
        allocationAmounts,
      );

      expect(await votesERC20.balanceOf(alice.address)).to.equal(allocationAmounts[0]);
      expect(await votesERC20.balanceOf(bob.address)).to.equal(allocationAmounts[1]);
      expect(await votesERC20.balanceOf(carol.address)).to.equal(allocationAmounts[2]);
      expect(await votesERC20.totalSupply()).to.equal(
        allocationAmounts[0] + allocationAmounts[1] + allocationAmounts[2],
      );
    });

    it('should handle empty allocation arrays', async () => {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        owner,
        false,
        ethers.parseEther('2100'),
        'Test Voting Token',
        'TVT',
        [],
        [],
      );

      expect(await votesERC20.totalSupply()).to.equal(0);
    });

    it('should initialize with locked set to false', async () => {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        owner,
        false,
        ethers.parseEther('2100'),
        'Test Voting Token',
        'TVT',
        [],
        [],
      );

      expect(await votesERC20.locked()).to.equal(false);
    });

    it('should initialize with locked set to true', async () => {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        owner,
        true,
        ethers.parseEther('2100'),
        'Test Voting Token',
        'TVT',
        [],
        [],
      );

      expect(await votesERC20.locked()).to.equal(true);
    });

    it('should initialize with maxTotalSupply set to 2100', async () => {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        owner,
        false,
        ethers.parseEther('2100'),
        'Test Voting Token',
        'TVT',
        [],
        [],
      );

      expect(await votesERC20.maxTotalSupply()).to.equal(ethers.parseEther('2100'));
    });

    it('should initialize with DEFAULT_ADMIN_ROLE, MINTER_ROLE, TRANSFER_FROM_ROLE set to owner', async () => {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        owner,
        false,
        ethers.parseEther('2100'),
        'Test Voting Token',
        'TVT',
        [],
        [],
      );

      expect(await votesERC20.hasRole(ethers.ZeroHash, owner.address)).to.equal(true);
      expect(await votesERC20.hasRole(MINTER_ROLE, owner.address)).to.equal(true);
      expect(await votesERC20.hasRole(TRANSFER_FROM_ROLE, owner.address)).to.equal(true);
    });

    it('should not allow reinitialization', async () => {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        owner,
        false,
        ethers.parseEther('2100'),
        'Test Voting Token',
        'TVT',
        [],
        [],
      );

      await expect(
        votesERC20.initialize({ name: 'New Name', symbol: 'NEW' }, [], owner.address, false, 0),
      ).to.be.revertedWithCustomError(votesERC20, 'InvalidInitialization');
    });

    it('Should have initialization disabled in the implementation', async function () {
      const masterCopy = await new VotesERC20V1__factory(owner).deploy();
      const implementationContract = VotesERC20V1__factory.connect(
        await masterCopy.getAddress(),
        proxyDeployer,
      );

      await expect(
        implementationContract.initialize(
          { name: 'New Name', symbol: 'NEW' },
          [],
          owner.address,
          false,
          0,
        ),
      ).to.be.revertedWithCustomError(implementationContract, 'InvalidInitialization');
    });
  });

  describe('Lock function', () => {
    describe('When locked at deployment', () => {
      const locked = true;
      let proxy: VotesERC20V1;

      beforeEach(async () => {
        proxy = await deployVotesERC20Proxy(
          proxyDeployer,
          owner,
          locked,
          ethers.parseEther('2100'),
          'Test',
          'TEST',
          [],
          [],
        );
      });

      describe('Unlocking by the owner should succeed', () => {
        let unlockTx: ContractTransactionResponse;

        beforeEach(async () => {
          await mine(1);
          unlockTx = await proxy.connect(owner).lock(false);
        });

        it('should be unlocked', async () => {
          expect(await proxy.locked()).to.equal(false);
        });

        it('should emit an event', async () => {
          await expect(unlockTx).to.emit(proxy, 'Locked').withArgs(false);
        });

        it('should update unlockTime', async () => {
          expect(await proxy.getUnlockTime()).to.equal(await time.latest());
        });
      });

      describe('Unlocking by a non-owner should fail', () => {
        it('should revert', async () => {
          await expect(proxy.connect(nonOwner).lock(false)).to.be.revertedWithCustomError(
            proxy,
            'AccessControlUnauthorizedAccount',
          );
        });
      });

      describe('Trying to lock (despite being locked) should succeed', () => {
        it('should succeed', async () => {
          await expect(proxy.connect(owner).lock(true)).to.not.be.reverted;
        });
      });
    });

    describe('When unlocked at deployment', () => {
      const locked = false;
      let proxy: VotesERC20V1;

      beforeEach(async () => {
        proxy = await deployVotesERC20Proxy(
          proxyDeployer,
          owner,
          locked,
          ethers.parseEther('2100'),
          'Test',
          'TEST',
          [],
          [],
        );
      });

      describe('Locking by the owner should succeed', () => {
        let unlockTime: bigint;
        let lockTx: ContractTransactionResponse;

        beforeEach(async () => {
          unlockTime = await proxy.getUnlockTime();
          await mine(1);
          lockTx = await proxy.connect(owner).lock(true);
        });

        it('should be locked', async () => {
          expect(await proxy.locked()).to.equal(true);
        });

        it('should emit an event', async () => {
          await expect(lockTx).to.emit(proxy, 'Locked').withArgs(true);
        });

        it('should not update unlockTime', async () => {
          expect(await proxy.getUnlockTime()).to.equal(unlockTime);
        });
      });

      describe('Locking by a non-owner should fail', () => {
        it('should revert', async () => {
          await expect(proxy.connect(nonOwner).lock(true)).to.be.revertedWithCustomError(
            proxy,
            'AccessControlUnauthorizedAccount',
          );
        });
      });

      describe('Trying to unlock (despite being unlocked) should succeed', () => {
        it('should succeed', async () => {
          await expect(proxy.connect(owner).lock(false)).to.not.be.reverted;
        });
      });
    });
  });

  describe('SetMaxTotalSupply function', () => {
    const locked = false;
    const maxTotalSupply = ethers.parseEther('2');
    const newMaxTotalSupply = ethers.parseEther('20');
    let proxy: VotesERC20V1;

    beforeEach(async () => {
      proxy = await deployVotesERC20Proxy(
        proxyDeployer,
        owner,
        locked,
        maxTotalSupply,
        'Test',
        'TEST',
        [],
        [],
      );
    });

    describe('Updating by the owner should succeed', () => {
      let updateTx: ContractTransactionResponse;

      beforeEach(async () => {
        updateTx = await proxy.connect(owner).setMaxTotalSupply(newMaxTotalSupply);
      });

      it('should be updated', async () => {
        expect(await proxy.maxTotalSupply()).to.equal(newMaxTotalSupply);
      });

      it('should emit an event', async () => {
        await expect(updateTx).to.emit(proxy, 'MaxTotalSupplyUpdated').withArgs(newMaxTotalSupply);
      });
    });

    describe('Updating by a owner with maxTotalSupply lower than totalSupply', () => {
      it('should revert', async () => {
        const mintedAmount = maxTotalSupply - 1n;
        await proxy.connect(owner).mint(owner, mintedAmount);
        await expect(
          proxy.connect(owner).setMaxTotalSupply(mintedAmount - 1n),
        ).to.be.revertedWithCustomError(proxy, 'InvalidMaxTotalSupply');
      });
    });

    describe('Updating by a non-owner should fail', () => {
      it('should revert', async () => {
        await expect(
          proxy.connect(nonOwner).setMaxTotalSupply(newMaxTotalSupply),
        ).to.be.revertedWithCustomError(proxy, 'AccessControlUnauthorizedAccount');
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
      let proxy: VotesERC20V1;

      describe('when token is locked', () => {
        const locked = true;

        beforeEach(async () => {
          proxy = await deployVotesERC20Proxy(
            proxyDeployer,
            owner,
            locked,
            ethers.parseEther('2100'),
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
            await proxy.connect(owner).grantRole(TRANSFER_FROM_ROLE, tokenHolder.address);
            await proxy
              .connect(tokenHolder)
              .transfer(tokenRecipient.address, ethers.parseEther('1'));
          });

          it('should transfer tokens', async () => {
            expect(await proxy.balanceOf(tokenRecipient.address)).to.equal(ethers.parseEther('1'));
            expect(await proxy.balanceOf(tokenHolder.address)).to.equal(ethers.parseEther('99'));
          });
        });

        describe('when recipient is whitelisted', () => {
          beforeEach(async () => {
            await proxy.connect(owner).grantRole(TRANSFER_TO_ROLE, tokenRecipient.address);
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
            ).to.be.revertedWithCustomError(proxy, 'IsLocked');
          });
        });
      });

      describe('when token is not locked', () => {
        const locked = false;

        beforeEach(async () => {
          proxy = await deployVotesERC20Proxy(
            proxyDeployer,
            owner,
            locked,
            ethers.parseEther('2100'),
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
            await proxy.connect(owner).grantRole(TRANSFER_FROM_ROLE, tokenHolder.address);
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
      let proxy: VotesERC20V1;

      describe('when token is locked', () => {
        const locked = true;

        beforeEach(async () => {
          proxy = await deployVotesERC20Proxy(
            proxyDeployer,
            owner,
            locked,
            ethers.parseEther('2100'),
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
            await proxy.connect(owner).grantRole(TRANSFER_FROM_ROLE, tokenHolder.address);
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
            ).to.be.revertedWithCustomError(proxy, 'IsLocked');
          });
        });
      });

      describe('when token is not locked', () => {
        const locked = false;

        beforeEach(async () => {
          proxy = await deployVotesERC20Proxy(
            proxyDeployer,
            owner,
            locked,
            ethers.parseEther('2100'),
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
            await proxy.connect(owner).grantRole(TRANSFER_FROM_ROLE, tokenHolder.address);
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
            ).to.be.revertedWithCustomError(proxy, 'ERC20InsufficientAllowance');
          });
        });
      });
    });
  });

  describe('Minting Tokens', () => {
    const maxTotalSupply = ethers.parseEther('1');
    let proxy: VotesERC20V1;

    describe('when token is locked', () => {
      const locked = true;

      beforeEach(async () => {
        proxy = await deployVotesERC20Proxy(
          proxyDeployer,
          owner,
          locked,
          maxTotalSupply,
          'Test',
          'TEST',
          [],
          [],
        );
      });

      describe('when caller is owner', () => {
        beforeEach(async () => {
          await proxy.connect(owner).mint(owner.address, maxTotalSupply);
        });

        it('should mint tokens', async () => {
          expect(await proxy.balanceOf(owner.address)).to.equal(maxTotalSupply);
        });

        it('should revert when mint more than maxTotalSupply', async () => {
          await expect(proxy.connect(owner).mint(owner.address, 1n)).to.be.revertedWithCustomError(
            proxy,
            'ExceedMaxTotalSupply',
          );
        });
      });

      describe('when caller is has the minter role', () => {
        beforeEach(async () => {
          await proxy.connect(owner).grantRole(MINTER_ROLE, tokenHolder.address);
          await proxy.connect(tokenHolder).mint(tokenHolder.address, maxTotalSupply);
        });

        it('should mint tokens', async () => {
          expect(await proxy.hasRole(MINTER_ROLE, tokenHolder.address)).to.equal(true);
          expect(await proxy.balanceOf(tokenHolder.address)).to.equal(maxTotalSupply);
        });
      });

      describe('when caller has the transfer role', () => {
        beforeEach(async () => {
          await proxy.connect(owner).grantRole(TRANSFER_FROM_ROLE, tokenHolder.address);
        });

        it('should revert', async () => {
          expect(await proxy.hasRole(TRANSFER_FROM_ROLE, tokenHolder.address)).to.equal(true);
          await expect(
            proxy.connect(tokenHolder).mint(tokenHolder.address, maxTotalSupply),
          ).to.be.revertedWithCustomError(proxy, 'AccessControlUnauthorizedAccount');
        });
      });

      describe('when caller is not owner or whitelisted', () => {
        it('should revert', async () => {
          expect(await proxy.hasRole(MINTER_ROLE, tokenHolder.address)).to.equal(false);
          await expect(
            proxy.connect(tokenHolder).mint(tokenHolder.address, ethers.parseEther('1')),
          ).to.be.revertedWithCustomError(proxy, 'AccessControlUnauthorizedAccount');
        });
      });
    });

    describe('when token is not locked', () => {
      const locked = false;

      beforeEach(async () => {
        proxy = await deployVotesERC20Proxy(
          proxyDeployer,
          owner,
          locked,
          ethers.parseEther('2100'),
          'Test',
          'TEST',
          [],
          [],
        );
      });

      describe('when caller is owner', () => {
        beforeEach(async () => {
          await proxy.connect(owner).mint(owner.address, ethers.parseEther('1'));
        });

        it('should mint tokens', async () => {
          expect(await proxy.balanceOf(owner.address)).to.equal(ethers.parseEther('1'));
        });
      });

      describe('when caller is whitelisted', () => {
        beforeEach(async () => {
          await proxy.connect(owner).grantRole(TRANSFER_FROM_ROLE, tokenHolder.address);
        });

        it('should revert', async () => {
          expect(await proxy.hasRole(TRANSFER_FROM_ROLE, tokenHolder.address)).to.equal(true);
          await expect(
            proxy.connect(tokenHolder).mint(tokenHolder.address, ethers.parseEther('1')),
          ).to.be.revertedWithCustomError(proxy, 'AccessControlUnauthorizedAccount');
        });
      });

      describe('when caller is not owner or whitelisted', () => {
        it('should revert', async () => {
          await expect(
            proxy.connect(tokenHolder).mint(tokenHolder.address, ethers.parseEther('1')),
          ).to.be.revertedWithCustomError(proxy, 'AccessControlUnauthorizedAccount');
        });
      });
    });
  });

  describe('Burning Tokens', () => {
    let tokenHolderAddresses: string[];
    let tokenHolderAmounts: bigint[];
    let proxy: VotesERC20V1;

    beforeEach(async () => {
      tokenHolderAddresses = [tokenHolder.address, owner.address];
      tokenHolderAmounts = [ethers.parseEther('100'), ethers.parseEther('100')];
    });

    describe('when token is locked', () => {
      const locked = true;

      beforeEach(async () => {
        proxy = await deployVotesERC20Proxy(
          proxyDeployer,
          owner,
          locked,
          ethers.parseEther('2100'),
          'Test',
          'TEST',
          tokenHolderAddresses,
          tokenHolderAmounts,
        );
      });

      describe('when caller is owner', () => {
        beforeEach(async () => {
          await proxy.connect(owner).burn(ethers.parseEther('1'));
        });

        it('should burn tokens', async () => {
          expect(await proxy.balanceOf(owner.address)).to.equal(ethers.parseEther('99'));
        });
      });

      describe('when caller is whitelisted', () => {
        beforeEach(async () => {
          await proxy.connect(owner).grantRole(TRANSFER_FROM_ROLE, tokenHolder.address);
          await proxy.connect(tokenHolder).burn(ethers.parseEther('1'));
        });

        it('should transfer tokens', async () => {
          expect(await proxy.balanceOf(tokenHolder.address)).to.equal(ethers.parseEther('99'));
        });
      });

      describe('when caller is not owner or whitelisted', () => {
        it('should not revert', async () => {
          await proxy.connect(tokenHolder).burn(ethers.parseEther('1'));
          expect(await proxy.balanceOf(tokenHolder.address)).to.equal(ethers.parseEther('99'));
        });
      });
    });

    describe('when token is not locked', () => {
      const locked = false;

      beforeEach(async () => {
        proxy = await deployVotesERC20Proxy(
          proxyDeployer,
          owner,
          locked,
          ethers.parseEther('2100'),
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
          await proxy.connect(owner).grantRole(TRANSFER_FROM_ROLE, tokenHolder.address);
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

  describe('Version', () => {
    beforeEach(async () => {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        owner,
        false,
        ethers.parseEther('2100'),
        'Test Voting Token',
        'TVT',
        [],
        [],
      );
    });

    it('should return the correct version number', async () => {
      expect(await votesERC20.version()).to.equal(1);
    });
  });

  describe('ERC165 supportsInterface', function () {
    beforeEach(async function () {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        owner,
        false,
        ethers.parseEther('2100'),
        'Test Voting Token',
        'TVT',
        [],
        [],
      );
    });

    runSupportsInterfaceTests({
      getContract: () => votesERC20,
      supportedInterfaceFactories: [
        IERC165__factory,
        IVersion__factory,
        IERC20__factory,
        IVotesERC20V1__factory,
        IERC20Permit__factory,
        IVotes__factory,
        IDeploymentBlockV1__factory,
        IAccessControl__factory,
      ],
    });
  });

  describe('Timestamp-based clock functions', () => {
    beforeEach(async () => {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        owner,
        false,
        ethers.parseEther('2100'),
        'Test Voting Token',
        'TVT',
        [],
        [],
      );
    });

    it('should return current timestamp from clock()', async () => {
      const currentTime = await ethers.provider.getBlock('latest').then(b => b!.timestamp);
      const clockTime = await votesERC20.clock();

      // Allow small variance due to block mining time
      expect(Number(clockTime)).to.be.closeTo(currentTime, 5);
    });

    it("should return 'mode=timestamp' from CLOCK_MODE()", async () => {
      expect(await votesERC20.CLOCK_MODE()).to.equal('mode=timestamp');
    });

    it('should use timestamp for vote checkpoints', async () => {
      // Delegate to another address
      await votesERC20.connect(owner).delegate(alice.address);

      // Mine a block to move forward in time
      await mine(1);

      // Get current timestamp which is now > the delegation timestamp
      const currentTime = await time.latest();

      // The voting power at the previous timestamp should be available
      const votingPower = await votesERC20.getPastVotes(alice.address, currentTime - 1);

      // Should match the owner's balance since we just delegated
      expect(votingPower).to.equal(await votesERC20.balanceOf(owner.address));
    });
  });

  describe('VotesERC20V1 UUPS Upgradeability', function () {
    beforeEach(async function () {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        owner,
        false,
        ethers.parseEther('2100'),
        'Test Voting Token',
        'TVT',
        [],
        [],
      );
    });

    // Run UUPS upgradeability tests
    runUUPSUpgradeabilityTests({
      getContract: () => votesERC20,
      createNewImplementation: async () => {
        const newImplementation = await new VotesERC20V1__factory(owner).deploy();
        return newImplementation;
      },
      owner: () => owner,
      nonOwner: () => nonOwner,
    });
  });

  describe('Deployment Block', () => {
    beforeEach(async function () {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        owner,
        false,
        ethers.parseEther('2100'),
        'Test Voting Token',
        'TVT',
        [],
        [],
      );
    });

    runDeploymentBlockTests({
      getContract: () => votesERC20,
    });
  });
});
