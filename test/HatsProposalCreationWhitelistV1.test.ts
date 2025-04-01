import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ConcreteHatsProposalCreationWhitelistV1,
  ConcreteHatsProposalCreationWhitelistV1__factory,
  IERC165__factory,
  IHatsProposalCreationWhitelistV1__factory,
  MockHats2,
  MockHats2__factory,
} from '../typechain-types';
import { getModuleProxyFactory } from './GlobalSafeDeployments.test';
import { calculateProxyAddress } from './helpers';
import { runHatsProposerTests } from './helpers/hatsProposerTests';
import { calculateInterfaceId } from './helpers/utils';

describe('HatsProposalCreationWhitelistV1', () => {
  // Signers
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let nonOwner: SignerWithAddress;
  let hatWearer: SignerWithAddress;
  let nonHatWearer: SignerWithAddress;

  // Contracts
  let concreteHatsProposalCreationWhitelist: ConcreteHatsProposalCreationWhitelistV1;
  let mockHats: MockHats2;

  // Hat IDs - we can use any arbitrary values now
  const proposerHatId1 = 1n;
  const proposerHatId2 = 2n;
  const nonProposerHatId = 3n;

  async function deployHatsProposalCreationWhitelistProxy(
    implementation: ConcreteHatsProposalCreationWhitelistV1,
    ownerSigner: SignerWithAddress,
    hatsContract: string,
    initialWhitelistedHats: bigint[],
  ): Promise<ConcreteHatsProposalCreationWhitelistV1> {
    // Create the initialization data
    const initializeCalldata =
      ConcreteHatsProposalCreationWhitelistV1__factory.createInterface().encodeFunctionData(
        'setUp(address,bytes)',
        [
          ownerSigner.address,
          ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'uint256[]'],
            [hatsContract, initialWhitelistedHats],
          ),
        ],
      );

    const moduleProxyFactory = getModuleProxyFactory();
    const salt = ethers.keccak256(ethers.randomBytes(32));

    // Deploy the proxy with owner as the deployer so msg.sender becomes the owner
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

    // Connect the proxy to the contract owner
    return ConcreteHatsProposalCreationWhitelistV1__factory.connect(predictedAddress, ownerSigner);
  }

  beforeEach(async () => {
    [deployer, owner, nonOwner, hatWearer, nonHatWearer] = await ethers.getSigners();

    // Deploy the ultra-minimal MockHats contract
    mockHats = await new MockHats2__factory(deployer).deploy();

    // Set up initial hat wearing status - this is all we need!
    await mockHats.setWearerStatus(hatWearer.address, proposerHatId1, true);
    await mockHats.setWearerStatus(nonHatWearer.address, nonProposerHatId, true);

    // Deploy the ConcreteHatsProposalCreationWhitelist implementation
    const masterCopy = await new ConcreteHatsProposalCreationWhitelistV1__factory(
      deployer,
    ).deploy();

    // Deploy a proxy with initialization
    concreteHatsProposalCreationWhitelist = await deployHatsProposalCreationWhitelistProxy(
      masterCopy,
      owner,
      await mockHats.getAddress(),
      [proposerHatId1, proposerHatId2],
    );
  });

  describe('Initialization', () => {
    it('should initialize with correct hats contract address', async () => {
      expect(await concreteHatsProposalCreationWhitelist.hatsContract()).to.equal(
        await mockHats.getAddress(),
      );
    });

    it('should initialize with correct whitelisted hats', async () => {
      const whitelistedHats = await concreteHatsProposalCreationWhitelist.getWhitelistedHatIds();
      expect(whitelistedHats.length).to.equal(2);
      expect(whitelistedHats[0]).to.equal(proposerHatId1);
      expect(whitelistedHats[1]).to.equal(proposerHatId2);
    });

    it('should initialize with correct owner', async () => {
      expect(await concreteHatsProposalCreationWhitelist.owner()).to.equal(owner.address);
    });

    it('should not allow initialization with no whitelisted hats', async () => {
      // Deploy another implementation for this test
      const mockImplementation = await new ConcreteHatsProposalCreationWhitelistV1__factory(
        deployer,
      ).deploy();

      // Create initialization data with empty hats array
      const emptyWhitelistedHats: bigint[] = [];
      const initData =
        ConcreteHatsProposalCreationWhitelistV1__factory.createInterface().encodeFunctionData(
          'setUp(address,bytes)',
          [
            owner.address,
            ethers.AbiCoder.defaultAbiCoder().encode(
              ['address', 'uint256[]'],
              [await mockHats.getAddress(), emptyWhitelistedHats],
            ),
          ],
        );

      const moduleProxyFactory = getModuleProxyFactory();
      // Attempt to deploy the proxy - should revert
      await expect(
        moduleProxyFactory.deployModule(
          await mockImplementation.getAddress(),
          initData,
          ethers.keccak256(ethers.randomBytes(32)),
        ),
      ).to.be.revertedWithCustomError(getModuleProxyFactory(), 'FailedInitialization');
    });

    it('should not allow initialization with invalid hats contract', async () => {
      // Deploy another implementation for this test
      const mockImplementation = await new ConcreteHatsProposalCreationWhitelistV1__factory(
        deployer,
      ).deploy();

      // Create initialization data with zero address for hats contract
      const initData =
        ConcreteHatsProposalCreationWhitelistV1__factory.createInterface().encodeFunctionData(
          'setUp(address,bytes)',
          [
            owner.address,
            ethers.AbiCoder.defaultAbiCoder().encode(
              ['address', 'uint256[]'],
              [ethers.ZeroAddress, [proposerHatId1]],
            ),
          ],
        );

      const moduleProxyFactory = getModuleProxyFactory();

      // Attempt to deploy the proxy - should revert
      await expect(
        moduleProxyFactory.deployModule(
          await mockImplementation.getAddress(),
          initData,
          ethers.keccak256(ethers.randomBytes(32)),
        ),
      ).to.be.revertedWithCustomError(getModuleProxyFactory(), 'FailedInitialization');
    });
  });

  describe('whitelistHat', () => {
    it('should allow owner to whitelist a new hat', async () => {
      await concreteHatsProposalCreationWhitelist.connect(owner).whitelistHat(nonProposerHatId);

      const whitelistedHats = await concreteHatsProposalCreationWhitelist.getWhitelistedHatIds();
      expect(whitelistedHats.length).to.equal(3);
      expect(whitelistedHats[2]).to.equal(nonProposerHatId);
    });

    it('should emit HatWhitelisted event when a hat is whitelisted', async () => {
      await expect(
        concreteHatsProposalCreationWhitelist.connect(owner).whitelistHat(nonProposerHatId),
      )
        .to.emit(concreteHatsProposalCreationWhitelist, 'HatWhitelisted')
        .withArgs(nonProposerHatId);
    });

    it('should not allow non-owner to whitelist a hat', async () => {
      await expect(
        concreteHatsProposalCreationWhitelist.connect(nonOwner).whitelistHat(nonProposerHatId),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should not allow whitelisting an already whitelisted hat', async () => {
      await expect(
        concreteHatsProposalCreationWhitelist.connect(owner).whitelistHat(proposerHatId1),
      ).to.be.revertedWithCustomError(
        concreteHatsProposalCreationWhitelist,
        'HatAlreadyWhitelisted',
      );
    });
  });

  describe('unwhitelistHat', () => {
    it('should allow owner to remove a hat from the whitelist', async () => {
      await concreteHatsProposalCreationWhitelist.connect(owner).unwhitelistHat(proposerHatId1);

      const whitelistedHats = await concreteHatsProposalCreationWhitelist.getWhitelistedHatIds();
      expect(whitelistedHats.length).to.equal(1);
      expect(whitelistedHats[0]).to.equal(proposerHatId2);
    });

    it('should emit HatUnwhitelisted event when a hat is removed', async () => {
      await expect(
        concreteHatsProposalCreationWhitelist.connect(owner).unwhitelistHat(proposerHatId1),
      )
        .to.emit(concreteHatsProposalCreationWhitelist, 'HatUnwhitelisted')
        .withArgs(proposerHatId1);
    });

    it('should not allow non-owner to remove a hat from the whitelist', async () => {
      await expect(
        concreteHatsProposalCreationWhitelist.connect(nonOwner).unwhitelistHat(proposerHatId1),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should not allow removing a hat that is not whitelisted', async () => {
      await expect(
        concreteHatsProposalCreationWhitelist.connect(owner).unwhitelistHat(nonProposerHatId),
      ).to.be.revertedWithCustomError(concreteHatsProposalCreationWhitelist, 'HatNotWhitelisted');
    });
  });

  describe('isProposer override', () => {
    runHatsProposerTests({
      getMockHats: () => mockHats,
      getContract: () => concreteHatsProposalCreationWhitelist,
      hatWearer: () => hatWearer,
      nonHatWearer: () => nonHatWearer,
      tokenHolder: () => nonOwner, // Using nonOwner as tokenHolder since we don't have tokens in this test
      owner: () => owner,
      proposerHatId: proposerHatId1,
      nonProposerHatId,
    });
  });

  describe('getWhitelistedHatIds', () => {
    it('should return the correct list of whitelisted hat IDs', async () => {
      const whitelistedHats = await concreteHatsProposalCreationWhitelist.getWhitelistedHatIds();
      expect(whitelistedHats.length).to.equal(2);
      expect(whitelistedHats[0]).to.equal(proposerHatId1);
      expect(whitelistedHats[1]).to.equal(proposerHatId2);
    });

    it('should return updated list after adding a hat', async () => {
      await concreteHatsProposalCreationWhitelist.connect(owner).whitelistHat(nonProposerHatId);

      const whitelistedHats = await concreteHatsProposalCreationWhitelist.getWhitelistedHatIds();
      expect(whitelistedHats.length).to.equal(3);
      expect(whitelistedHats[2]).to.equal(nonProposerHatId);
    });

    it('should return updated list after removing a hat', async () => {
      await concreteHatsProposalCreationWhitelist.connect(owner).unwhitelistHat(proposerHatId1);

      const whitelistedHats = await concreteHatsProposalCreationWhitelist.getWhitelistedHatIds();
      expect(whitelistedHats.length).to.equal(1);
      expect(whitelistedHats[0]).to.equal(proposerHatId2);
    });
  });

  describe('ERC165', () => {
    it('Should support IERC165 interface', async () => {
      const interfaceId = calculateInterfaceId(IERC165__factory.createInterface());
      void expect(await concreteHatsProposalCreationWhitelist.supportsInterface(interfaceId)).to.be
        .true;
    });

    it('Should support IHatsProposalCreationWhitelistV1 interface', async () => {
      const interfaceId = calculateInterfaceId(
        IHatsProposalCreationWhitelistV1__factory.createInterface(),
      );
      void expect(await concreteHatsProposalCreationWhitelist.supportsInterface(interfaceId)).to.be
        .true;
    });

    it('Should not support random interface', async () => {
      // Random interface ID
      void expect(await concreteHatsProposalCreationWhitelist.supportsInterface('0x12345678')).to.be
        .false;
    });

    it('Should not support 0xffffffff interface', async () => {
      // Random interface ID
      void expect(await concreteHatsProposalCreationWhitelist.supportsInterface('0xffffffff')).to.be
        .false;
    });
  });
});
