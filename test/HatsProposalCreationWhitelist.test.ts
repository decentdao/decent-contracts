import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import hre from "hardhat";
import { ethers } from "ethers";

import {
  MockHatsProposalCreationWhitelist,
  MockHatsProposalCreationWhitelist__factory,
  MockHats,
  MockHats__factory,
} from "../typechain-types";

describe("HatsProposalCreationWhitelist", () => {
  let mockHatsProposalCreationWhitelist: MockHatsProposalCreationWhitelist;
  let hatsContract: MockHats;

  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let hatWearer1: SignerWithAddress;
  let hatWearer2: SignerWithAddress;

  let proposerHat: bigint;
  let nonProposerHat: bigint;

  beforeEach(async () => {
    [deployer, owner, hatWearer1, hatWearer2] = await hre.ethers.getSigners();

    // Deploy Hats mock contract
    hatsContract = await new MockHats__factory(deployer).deploy();

    // Create hats for testing
    proposerHat = await hatsContract.createHat.staticCall(
      0,
      "Proposer Hat",
      0,
      ethers.ZeroAddress,
      deployer.address,
      true,
      ""
    );
    await hatsContract.createHat(
      0,
      "Proposer Hat",
      0,
      ethers.ZeroAddress,
      deployer.address,
      true,
      ""
    );
    nonProposerHat = await hatsContract.createHat.staticCall(
      0,
      "Non-Proposer Hat",
      0,
      ethers.ZeroAddress,
      deployer.address,
      true,
      ""
    );
    await hatsContract.createHat(
      0,
      "Non-Proposer Hat",
      0,
      ethers.ZeroAddress,
      deployer.address,
      true,
      ""
    );

    // Mint hats to users
    await hatsContract.mintHat(proposerHat, hatWearer1.address);
    await hatsContract.mintHat(nonProposerHat, hatWearer2.address);

    // Deploy MockHatsProposalCreationWhitelist
    mockHatsProposalCreationWhitelist =
      await new MockHatsProposalCreationWhitelist__factory(deployer).deploy();

    // Initialize the contract
    await mockHatsProposalCreationWhitelist.setUp(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256[]"],
        [await hatsContract.getAddress(), [proposerHat]]
      )
    );

    // Transfer ownership to the owner
    await mockHatsProposalCreationWhitelist.transferOwnership(owner.address);
  });

  it("Gets correctly initialized", async () => {
    expect(await mockHatsProposalCreationWhitelist.owner()).to.eq(
      owner.address
    );
    expect(await mockHatsProposalCreationWhitelist.hatsContract()).to.eq(
      await hatsContract.getAddress()
    );
    expect(
      await mockHatsProposalCreationWhitelist.isHatWhitelisted(proposerHat)
    ).to.be.true;
  });

  it("Cannot call setUp function again", async () => {
    const setupParams = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256[]"],
      [await hatsContract.getAddress(), [proposerHat]]
    );

    await expect(
      mockHatsProposalCreationWhitelist.setUp(setupParams)
    ).to.be.revertedWith("Initializable: contract is already initialized");
  });

  it("Cannot initialize with no whitelisted hats", async () => {
    const mockHatsProposalCreationWhitelistFactory =
      new MockHatsProposalCreationWhitelist__factory(deployer);
    const newMockContract =
      await mockHatsProposalCreationWhitelistFactory.deploy();

    const setupParams = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256[]"],
      [await hatsContract.getAddress(), []]
    );

    await expect(
      newMockContract.setUp(setupParams)
    ).to.be.revertedWithCustomError(newMockContract, "NoHatsWhitelisted");
  });

  it("Only owner can whitelist a hat", async () => {
    await expect(
      mockHatsProposalCreationWhitelist
        .connect(owner)
        .whitelistHat(nonProposerHat)
    )
      .to.emit(mockHatsProposalCreationWhitelist, "HatWhitelisted")
      .withArgs(nonProposerHat);

    await expect(
      mockHatsProposalCreationWhitelist
        .connect(hatWearer1)
        .whitelistHat(nonProposerHat)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Only owner can remove a hat from whitelist", async () => {
    await expect(
      mockHatsProposalCreationWhitelist
        .connect(owner)
        .removeHatFromWhitelist(proposerHat)
    )
      .to.emit(mockHatsProposalCreationWhitelist, "HatRemovedFromWhitelist")
      .withArgs(proposerHat);

    await expect(
      mockHatsProposalCreationWhitelist
        .connect(hatWearer1)
        .removeHatFromWhitelist(proposerHat)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Correctly identifies proposers based on whitelisted hats", async () => {
    expect(
      await mockHatsProposalCreationWhitelist.isProposer(hatWearer1.address)
    ).to.be.true;
    expect(
      await mockHatsProposalCreationWhitelist.isProposer(hatWearer2.address)
    ).to.be.false;

    await mockHatsProposalCreationWhitelist
      .connect(owner)
      .whitelistHat(nonProposerHat);

    expect(
      await mockHatsProposalCreationWhitelist.isProposer(hatWearer2.address)
    ).to.be.true;
  });

  it("Returns correct number of whitelisted hats", async () => {
    expect(
      await mockHatsProposalCreationWhitelist.getWhitelistedHatsCount()
    ).to.equal(1);

    await mockHatsProposalCreationWhitelist
      .connect(owner)
      .whitelistHat(nonProposerHat);

    expect(
      await mockHatsProposalCreationWhitelist.getWhitelistedHatsCount()
    ).to.equal(2);

    await mockHatsProposalCreationWhitelist
      .connect(owner)
      .removeHatFromWhitelist(proposerHat);

    expect(
      await mockHatsProposalCreationWhitelist.getWhitelistedHatsCount()
    ).to.equal(1);
  });

  it("Correctly checks if a hat is whitelisted", async () => {
    expect(
      await mockHatsProposalCreationWhitelist.isHatWhitelisted(proposerHat)
    ).to.be.true;
    expect(
      await mockHatsProposalCreationWhitelist.isHatWhitelisted(nonProposerHat)
    ).to.be.false;

    await mockHatsProposalCreationWhitelist
      .connect(owner)
      .whitelistHat(nonProposerHat);

    expect(
      await mockHatsProposalCreationWhitelist.isHatWhitelisted(nonProposerHat)
    ).to.be.true;

    await mockHatsProposalCreationWhitelist
      .connect(owner)
      .removeHatFromWhitelist(proposerHat);

    expect(
      await mockHatsProposalCreationWhitelist.isHatWhitelisted(proposerHat)
    ).to.be.false;
  });
});
