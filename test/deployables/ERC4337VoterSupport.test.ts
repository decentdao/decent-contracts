import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import hre from 'hardhat';
import {
  MockERC4337VoterSupport,
  MockERC4337VoterSupport__factory,
  MockSmartAccount,
  MockSmartAccount__factory,
  MockNonOwnership,
  MockNonOwnership__factory,
} from '../../typechain-types';

describe('ERC4337VoterSupport', () => {
  let smartAccount: MockSmartAccount;
  let erc4337VoterSupport: MockERC4337VoterSupport;
  let nonOwnershipContract: MockNonOwnership;
  let zeroOwnerSmartAccount: MockSmartAccount;

  let deployer: SignerWithAddress;
  let smartAccountOwner: SignerWithAddress;
  let eoa: SignerWithAddress;

  beforeEach(async () => {
    const signers = await hre.ethers.getSigners();
    [deployer, smartAccountOwner, eoa] = signers;

    // Deploy mock contracts
    smartAccount = await new MockSmartAccount__factory(deployer).deploy(smartAccountOwner.address);
    zeroOwnerSmartAccount = await new MockSmartAccount__factory(deployer).deploy(
      hre.ethers.ZeroAddress,
    );
    erc4337VoterSupport = await new MockERC4337VoterSupport__factory(deployer).deploy();
    nonOwnershipContract = await new MockNonOwnership__factory(deployer).deploy();
  });

  describe('voter', () => {
    describe('when the msgSender is a smart account', () => {
      it('should return the owner of the smart account', async () => {
        expect(await erc4337VoterSupport.voter(await smartAccount.getAddress())).to.equal(
          smartAccountOwner.address,
        );
      });

      it('should return address(0) when smart account owner is zero address', async () => {
        expect(await erc4337VoterSupport.voter(await zeroOwnerSmartAccount.getAddress())).to.equal(
          hre.ethers.ZeroAddress,
        );
      });
    });

    describe('when the msgSender is an EOA', () => {
      it('should return the msgSender', async () => {
        expect(await erc4337VoterSupport.voter(eoa.address)).to.equal(eoa.address);
      });
    });

    describe('when the msgSender is a contract that does not implement IOwnership', () => {
      it('should return the contract address', async () => {
        const contractAddress = await nonOwnershipContract.getAddress();
        expect(await erc4337VoterSupport.voter(contractAddress)).to.equal(contractAddress);
      });
    });
  });

  describe('Version', function () {
    it('ERC4337 voter support should have a version', async function () {
      const version = await erc4337VoterSupport.getVersion();
      void expect(version).to.equal(1);
    });
  });
});
