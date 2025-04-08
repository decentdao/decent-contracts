import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ConcreteERC4337VoterSupportV1,
  ConcreteERC4337VoterSupportV1__factory,
  MockLightAccount,
  MockLightAccount__factory,
} from '../typechain-types';

describe('ERC4337VoterSupportV1', () => {
  // Signers
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;

  // Contracts
  let concreteERC4337VoterSupport: ConcreteERC4337VoterSupportV1;
  let mockLightAccount: MockLightAccount;

  beforeEach(async () => {
    [deployer, owner, user] = await ethers.getSigners();

    // Deploy the ERC4337VoterSupport concrete
    concreteERC4337VoterSupport = await new ConcreteERC4337VoterSupportV1__factory(
      deployer,
    ).deploy();

    // Deploy a mock ownership contract with the owner address
    mockLightAccount = await new MockLightAccount__factory(deployer).deploy(owner.address);
  });

  describe('voter', () => {
    describe('when the msgSender is a smart account', () => {
      it('should return the owner of the smart account', async () => {
        // Test with our mock ownership contract
        const voter = await concreteERC4337VoterSupport.voter(await mockLightAccount.getAddress());
        expect(voter).to.equal(owner.address);
      });

      it('should return address(0) when smart account owner is zero address', async () => {
        // Set the owner to the zero address
        await mockLightAccount.setOwner(ethers.ZeroAddress);

        const voter = await concreteERC4337VoterSupport.voter(await mockLightAccount.getAddress());
        expect(voter).to.equal(ethers.ZeroAddress);
      });
    });

    describe('when the msgSender is an EOA', () => {
      it('should return the msgSender', async () => {
        // For EOAs, the voter function should just return the address itself
        const eoaAddress = user.address;
        const voter = await concreteERC4337VoterSupport.voter(eoaAddress);
        expect(voter).to.equal(eoaAddress);
      });
    });

    describe('when the msgSender is a contract that does not implement IOwnership', () => {
      it('should return the contract address', async () => {
        // Use the ConcreteRC4337VoterSupport contract itself as a contract that doesn't implement IOwnership
        const contractAddress = await concreteERC4337VoterSupport.getAddress();
        const voter = await concreteERC4337VoterSupport.voter(contractAddress);
        expect(voter).to.equal(contractAddress);
      });
    });
  });
});
