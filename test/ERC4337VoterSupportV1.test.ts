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
});
