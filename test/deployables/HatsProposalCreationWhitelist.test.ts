import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  MockHatsProposalCreationWhitelist,
  MockHatsProposalCreationWhitelist__factory,
  MockHats,
  MockHats__factory,
} from '../../typechain-types';
import { topHatIdToHatId } from '../helpers';

describe('HatsProposalCreationWhitelist', () => {
  let mockHatsProposalCreationWhitelist: MockHatsProposalCreationWhitelist;
  let hatsProtocol: MockHats;

  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let hatWearer1: SignerWithAddress;
  let hatWearer2: SignerWithAddress;

  let proposerHatId: bigint;
  let nonProposerHatId: bigint;

  beforeEach(async () => {
    [deployer, owner, hatWearer1, hatWearer2] = await ethers.getSigners();

    // Deploy Hats mock contract
    hatsProtocol = await new MockHats__factory(deployer).deploy();

    // Mint the top hat
    const topHatId = topHatIdToHatId((await hatsProtocol.lastTopHatId()) + 1n);
    await hatsProtocol.mintTopHat(deployer.address, '', '');

    // Create and mint hats for testing
    proposerHatId = await hatsProtocol.getNextId(topHatId);
    await hatsProtocol.createHat(
      topHatId,
      'Proposer Hat',
      1,
      deployer.address,
      deployer.address,
      true,
      '',
    );
    await hatsProtocol.mintHat(proposerHatId, hatWearer1.address);

    nonProposerHatId = await hatsProtocol.getNextId(topHatId);
    await hatsProtocol.createHat(
      topHatId,
      'Non-Proposer Hat',
      1,
      deployer.address,
      deployer.address,
      true,
      '',
    );
    await hatsProtocol.mintHat(nonProposerHatId, hatWearer2.address);

    // Deploy MockHatsProposalCreationWhitelist
    mockHatsProposalCreationWhitelist = await new MockHatsProposalCreationWhitelist__factory(
      deployer,
    ).deploy();

    // Initialize the contract
    await mockHatsProposalCreationWhitelist.setUp(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256[]'],
        [await hatsProtocol.getAddress(), [proposerHatId]],
      ),
    );

    // Transfer ownership to the owner
    await mockHatsProposalCreationWhitelist.transferOwnership(owner.address);
  });

  it('Gets correctly initialized', async () => {
    expect(await mockHatsProposalCreationWhitelist.owner()).to.eq(owner.address);
    expect(await mockHatsProposalCreationWhitelist.hatsContract()).to.eq(
      await hatsProtocol.getAddress(),
    );
    expect(
      (await mockHatsProposalCreationWhitelist.getWhitelistedHatIds()).includes(proposerHatId),
    ).to.equal(true);
  });

  it('Cannot call setUp function again', async () => {
    const setupParams = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256[]'],
      [await hatsProtocol.getAddress(), [proposerHatId]],
    );

    await expect(
      mockHatsProposalCreationWhitelist.setUp(setupParams),
    ).to.be.revertedWithCustomError(mockHatsProposalCreationWhitelist, 'InvalidInitialization');
  });

  it('Cannot initialize with no whitelisted hats', async () => {
    const mockHatsProposalCreationWhitelistFactory = new MockHatsProposalCreationWhitelist__factory(
      deployer,
    );
    const newMockContract = await mockHatsProposalCreationWhitelistFactory.deploy();

    const setupParams = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256[]'],
      [await hatsProtocol.getAddress(), []],
    );

    await expect(newMockContract.setUp(setupParams)).to.be.revertedWithCustomError(
      newMockContract,
      'NoHatsWhitelisted',
    );
  });

  it('Only owner can whitelist a hat', async () => {
    await expect(mockHatsProposalCreationWhitelist.connect(owner).whitelistHat(nonProposerHatId))
      .to.emit(mockHatsProposalCreationWhitelist, 'HatWhitelisted')
      .withArgs(nonProposerHatId);

    await expect(
      mockHatsProposalCreationWhitelist.connect(hatWearer1).whitelistHat(nonProposerHatId),
    ).to.be.revertedWithCustomError(
      mockHatsProposalCreationWhitelist,
      'OwnableUnauthorizedAccount',
    );
  });

  it('Only owner can remove a hat from whitelist', async () => {
    await expect(
      mockHatsProposalCreationWhitelist.connect(owner).removeHatFromWhitelist(proposerHatId),
    )
      .to.emit(mockHatsProposalCreationWhitelist, 'HatRemovedFromWhitelist')
      .withArgs(proposerHatId);

    await expect(
      mockHatsProposalCreationWhitelist.connect(hatWearer1).removeHatFromWhitelist(proposerHatId),
    ).to.be.revertedWithCustomError(
      mockHatsProposalCreationWhitelist,
      'OwnableUnauthorizedAccount',
    );
  });

  it('Correctly identifies proposers based on whitelisted hats', async () => {
    expect(await mockHatsProposalCreationWhitelist.isProposer(hatWearer1.address)).to.equal(true);
    expect(await mockHatsProposalCreationWhitelist.isProposer(hatWearer2.address)).to.equal(false);

    await mockHatsProposalCreationWhitelist.connect(owner).whitelistHat(nonProposerHatId);

    expect(await mockHatsProposalCreationWhitelist.isProposer(hatWearer2.address)).to.equal(true);
  });

  it('Returns correct number of whitelisted hats', async () => {
    expect((await mockHatsProposalCreationWhitelist.getWhitelistedHatIds()).length).to.equal(1);

    await mockHatsProposalCreationWhitelist.connect(owner).whitelistHat(nonProposerHatId);

    expect((await mockHatsProposalCreationWhitelist.getWhitelistedHatIds()).length).to.equal(2);

    await mockHatsProposalCreationWhitelist.connect(owner).removeHatFromWhitelist(proposerHatId);

    expect((await mockHatsProposalCreationWhitelist.getWhitelistedHatIds()).length).to.equal(1);
  });

  it('Correctly checks if a hat is whitelisted', async () => {
    expect(
      (await mockHatsProposalCreationWhitelist.getWhitelistedHatIds()).includes(proposerHatId),
    ).to.equal(true);
    expect(
      (await mockHatsProposalCreationWhitelist.getWhitelistedHatIds()).includes(nonProposerHatId),
    ).to.equal(false);

    await mockHatsProposalCreationWhitelist.connect(owner).whitelistHat(nonProposerHatId);

    expect(
      (await mockHatsProposalCreationWhitelist.getWhitelistedHatIds()).includes(nonProposerHatId),
    ).to.equal(true);

    await mockHatsProposalCreationWhitelist.connect(owner).removeHatFromWhitelist(proposerHatId);

    expect(
      (await mockHatsProposalCreationWhitelist.getWhitelistedHatIds()).includes(proposerHatId),
    ).to.equal(false);
  });

  describe('Version', function () {
    it('Hats proposal creation whitelist should have a version', async function () {
      const version = await mockHatsProposalCreationWhitelist.getVersion();
      void expect(version).to.equal(1);
    });
  });
});
