import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  MockERC20Votes,
  MockERC20Votes__factory,
  MockMaliciousERC20Votes__factory,
  VotingVault,
  VotingVault__factory,
} from '../../../typechain-types';

describe('VotingVault', function () {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let delegatee: SignerWithAddress;
  let other: SignerWithAddress;

  let votingVault: VotingVault;
  let token: MockERC20Votes;

  beforeEach(async function () {
    [deployer, user, delegatee, other] = await ethers.getSigners();

    token = await new MockERC20Votes__factory(deployer).deploy();
    await token.waitForDeployment();

    votingVault = await new VotingVault__factory(deployer).deploy(token, user);
    await votingVault.waitForDeployment();
  });

  describe('Initialization', () => {
    it('should initialize with correct token and controller', async () => {
      expect(await votingVault.token()).to.equal(token);
      expect(await votingVault.controller()).to.equal(deployer);
    });

    it('should delegate to beneficiary if it has no delegate', async () => {
      expect(await token.delegates(votingVault)).to.equal(user);
    });

    it('should delegate to existed delegate of token', async () => {
      await token.connect(user).delegate(delegatee);
      const newVotingVault = await new VotingVault__factory(deployer).deploy(token, user);
      await newVotingVault.waitForDeployment();

      expect(await token.delegates(newVotingVault)).to.equal(delegatee);
    });
  });

  describe('DelegateTokens Function', () => {
    it('should delegate tokens to the specified address', async () => {
      await votingVault.connect(deployer).delegateTokens(delegatee);
      expect(await token.delegates(votingVault)).to.equal(delegatee);
    });

    it('should revert if balance changes after delegateTokens', async () => {
      const maliciousToken = await new MockMaliciousERC20Votes__factory(deployer).deploy();
      await maliciousToken.waitForDeployment();
      const newVotingVault = await new VotingVault__factory(deployer).deploy(maliciousToken, user);
      await newVotingVault.waitForDeployment();
      await maliciousToken.connect(deployer).mint(newVotingVault, 100n);

      await expect(newVotingVault.connect(deployer).delegateTokens(delegatee)).to.be.revertedWith(
        'balance error',
      );
    });

    it('should revert if the caller is not the controller', async () => {
      await expect(votingVault.connect(other).delegateTokens(delegatee)).to.be.revertedWith(
        'not controller',
      );
    });
  });

  describe('WithdrawTokens Function', () => {
    const balance = 100n;

    beforeEach(async function () {
      await token.connect(deployer).mint(votingVault, balance);
    });

    it('should withdraw tokens from the vault', async () => {
      await votingVault.connect(deployer).withdrawTokens(user, balance);

      expect(await token.balanceOf(votingVault)).to.equal(0n);
      expect(await token.balanceOf(user)).to.equal(balance);
    });

    it('should revert if withdraw too many tokens from the vault', async () => {
      await expect(
        votingVault.connect(deployer).withdrawTokens(user, balance + 1n),
      ).to.be.revertedWithCustomError(token, 'ERC20InsufficientBalance');
    });

    it('should revert if the caller is not the controller', async () => {
      await expect(votingVault.connect(other).withdrawTokens(other, 1n)).to.be.revertedWith(
        'not controller',
      );
    });
  });
});
