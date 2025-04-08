import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ConcreteSmartAccountVerification,
  ConcreteSmartAccountVerification__factory,
  MockInvalidLightAccount,
  MockInvalidLightAccount__factory,
  MockLightAccount,
  MockLightAccount__factory,
  MockLightAccountFactory,
  MockLightAccountFactory__factory,
} from '../../typechain-types';
import { getModuleProxyFactory } from '../GlobalSafeDeployments.test';
import { calculateProxyAddress } from '../helpers';

async function deploySmartAccountVerification(
  deployer: SignerWithAddress,
  implementation: ConcreteSmartAccountVerification,
  mockLightAccountFactoryAddress: string,
) {
  const initializeCalldata =
    ConcreteSmartAccountVerification__factory.createInterface().encodeFunctionData('initialize', [
      mockLightAccountFactoryAddress,
    ]);

  const moduleProxyFactory = getModuleProxyFactory();
  const salt = ethers.keccak256(ethers.randomBytes(32));

  await moduleProxyFactory.deployModule(
    await implementation.getAddress(),
    initializeCalldata,
    salt,
  );

  const predictedSmartAccountVerificationAddress = await calculateProxyAddress(
    moduleProxyFactory,
    await implementation.getAddress(),
    initializeCalldata,
    salt,
  );

  return ConcreteSmartAccountVerification__factory.connect(
    predictedSmartAccountVerificationAddress,
    deployer,
  );
}

describe('LightAccountVerificationV1', function () {
  // contracts
  let concreteVerification: ConcreteSmartAccountVerification;
  let mockLightAccount: MockLightAccount;
  let mockInvalidLightAccount: MockInvalidLightAccount;
  let mockLightAccountFactory: MockLightAccountFactory;

  // signers
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;

  beforeEach(async function () {
    // Get signers
    [deployer, owner] = await ethers.getSigners();

    // Deploy MockLightAccount
    mockLightAccount = await new MockLightAccount__factory(deployer).deploy(owner.address);

    // Deploy MockInvalidLightAccount
    mockInvalidLightAccount = await new MockInvalidLightAccount__factory(deployer).deploy();

    // Deploy MockLightAccountFactory
    mockLightAccountFactory = await new MockLightAccountFactory__factory(deployer).deploy();

    // Deploy MockLightAccountVerification
    const concreteVerificationImplementation = await new ConcreteSmartAccountVerification__factory(
      deployer,
    ).deploy();

    concreteVerification = await deploySmartAccountVerification(
      deployer,
      concreteVerificationImplementation,
      mockLightAccountFactory.target.toString(),
    );
  });

  describe('verifySmartAccount', function () {
    describe('valid smart accounts', function () {
      it('should verify valid smart accounts', async function () {
        // set up the mock factory contract to return the correct address to `verifySmartAccount`
        await mockLightAccountFactory.setAccountAddress(
          await mockLightAccount.owner(),
          0n,
          await mockLightAccount.getAddress(),
        );

        void expect(
          await concreteVerification.verifySmartAccountPublic(await mockLightAccount.getAddress()),
        ).to.be.true;
      });
    });

    describe('invalid light accounts', function () {
      describe('non-contracts', function () {
        it('should return false for non-contract addresses', async function () {
          const randomAddress = ethers.Wallet.createRandom().address;

          // Should return false since the address won't have the owner() function
          void expect(await concreteVerification.verifySmartAccountPublic(randomAddress)).to.be
            .false;
        });
      });

      describe('contracts', function () {
        it('should return false for invalid light accounts that do implement the ILightAccount interface (owner())', async function () {
          // not calling "setAccountAddress", so the LightAccountFactory will always
          // return the zero address when calling `getAddress` for a given owner and salt
          // (which is implemented in the LightAccountVerification verifySmartAccount function).
          void expect(
            await concreteVerification.verifySmartAccountPublic(
              await mockLightAccount.getAddress(),
            ),
          ).to.be.false;
        });

        it('should return false for invalid light accounts that do not implement the ILightAccount interface (owner())', async function () {
          // Hits the "catch" block in the `verifySmartAccount` function
          void expect(
            await concreteVerification.verifySmartAccountPublic(
              await mockInvalidLightAccount.getAddress(),
            ),
          ).to.be.false;
        });
      });
    });
  });
});
