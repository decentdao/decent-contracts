import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ConcreteERC4337VoterSupportV1,
  ConcreteERC4337VoterSupportV1__factory,
  MockLightAccount,
  MockLightAccount__factory,
  MockLightAccountFactory,
  MockLightAccountFactory__factory,
} from '../typechain-types';
import { getModuleProxyFactory } from './GlobalSafeDeployments.test';
import { calculateProxyAddress } from './helpers';

async function deployConcreteERC4337VoterSupport(
  deployer: SignerWithAddress,
  implementation: ConcreteERC4337VoterSupportV1,
  lightAccountFactory: MockLightAccountFactory,
) {
  const initializeCalldata =
    ConcreteERC4337VoterSupportV1__factory.createInterface().encodeFunctionData('initialize', [
      lightAccountFactory.target,
    ]);

  const moduleProxyFactory = getModuleProxyFactory();
  const salt = ethers.keccak256(ethers.randomBytes(32));

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

  return ConcreteERC4337VoterSupportV1__factory.connect(predictedAddress, deployer);
}

describe('ERC4337VoterSupportV1', () => {
  // Signers
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;

  // Contracts
  let concreteERC4337VoterSupport: ConcreteERC4337VoterSupportV1;
  let mockLightAccount: MockLightAccount;
  let mockLightAccountFactory: MockLightAccountFactory;

  beforeEach(async () => {
    [deployer, owner, user] = await ethers.getSigners();

    // Deploy a mock ownership contract with the owner address
    mockLightAccount = await new MockLightAccount__factory(deployer).deploy(owner.address);

    // Deploy MockLightAccountFactory
    mockLightAccountFactory = await new MockLightAccountFactory__factory(deployer).deploy();

    // Deploy an implementation instance of the ConcreteERC4337VoterSupportV1
    const implementation = await new ConcreteERC4337VoterSupportV1__factory(deployer).deploy();

    // Deploy an instance of the ERC4337VoterSupport concrete implementation
    concreteERC4337VoterSupport = await deployConcreteERC4337VoterSupport(
      deployer,
      implementation,
      mockLightAccountFactory,
    );

    // Set up the mock light account factory to return our mock account
    await mockLightAccountFactory.setAccountAddress(
      await mockLightAccount.owner(),
      0n,
      await mockLightAccount.getAddress(),
    );
  });

  describe('voter', () => {
    describe('light accounts', function () {
      it('should return the owner of the light account', async () => {
        // Test with our mock ownership contract
        const voter = await concreteERC4337VoterSupport.voter(await mockLightAccount.getAddress());
        expect(voter).to.equal(owner.address);
      });
    });

    describe('non-light accounts', function () {
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

  describe('voting period ended', () => {
    it('should initially return false for any proposal', async () => {
      const proposalId = 1;
      const result = await concreteERC4337VoterSupport.votingPeriodEnded(proposalId);
      void expect(result).to.be.false;
    });

    it('should be able to set and get voting period ended status', async () => {
      const proposalId = 1;

      // Initially false
      let result = await concreteERC4337VoterSupport.votingPeriodEnded(proposalId);
      void expect(result).to.be.false;

      // Set to true
      await concreteERC4337VoterSupport.setVotingPeriodEnded(proposalId, true);
      result = await concreteERC4337VoterSupport.votingPeriodEnded(proposalId);
      void expect(result).to.be.true;

      // Set back to false
      await concreteERC4337VoterSupport.setVotingPeriodEnded(proposalId, false);
      result = await concreteERC4337VoterSupport.votingPeriodEnded(proposalId);
      void expect(result).to.be.false;
    });

    it('should maintain separate states for different proposal IDs', async () => {
      const proposalId1 = 1;
      const proposalId2 = 2;

      // Set first proposal to ended
      await concreteERC4337VoterSupport.setVotingPeriodEnded(proposalId1, true);

      // First proposal should be ended
      const result1 = await concreteERC4337VoterSupport.votingPeriodEnded(proposalId1);
      void expect(result1).to.be.true;

      // Second proposal should still be false
      const result2 = await concreteERC4337VoterSupport.votingPeriodEnded(proposalId2);
      void expect(result2).to.be.false;
    });

    it('should be accessible by any address', async () => {
      const proposalId = 1;

      await concreteERC4337VoterSupport.setVotingPeriodEnded(proposalId, true);

      // Test access from different accounts
      const userResult = await concreteERC4337VoterSupport
        .connect(user)
        .votingPeriodEnded(proposalId);
      void expect(userResult).to.be.true;

      const ownerResult = await concreteERC4337VoterSupport
        .connect(owner)
        .votingPeriodEnded(proposalId);
      void expect(ownerResult).to.be.true;
    });
  });
});
