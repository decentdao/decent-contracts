import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  VotesToken,
  VotesToken__factory,
  TokenClaim,
  TokenClaim__factory,
} from "../typechain-types";
import chai from "chai";
import { ethers } from "hardhat";
import time from "./time";

const expect = chai.expect;

describe("VotesToken Claiming", function () {
  let pToken: VotesToken;
  let cToken: VotesToken;
  let tokenClaim: TokenClaim;

  let deployer: SignerWithAddress;
  let userA: SignerWithAddress;
  let userB: SignerWithAddress;

  beforeEach(async function () {
    [deployer, userA, userB] = await ethers.getSigners();

    tokenClaim = await new TokenClaim__factory(deployer).deploy();
    pToken = await new VotesToken__factory(deployer).deploy();
    cToken = await new VotesToken__factory(deployer).deploy();

    const abiCoder = new ethers.utils.AbiCoder(); // encode data

    const pTokenSetupData = abiCoder.encode(
      ["string", "string", "address[]", "uint256[]"],
      [
        "ParentDecent",
        "pDCNT",
        [deployer.address, userA.address],
        [
          ethers.utils.parseUnits("100", 18),
          ethers.utils.parseUnits("150", 18),
        ],
      ]
    );

    await pToken.setUp(pTokenSetupData);

    const cTokenSetupData = abiCoder.encode(
      ["string", "string", "address[]", "uint256[]"],
      [
        "ChildDecent",
        "cDCNT",
        [userB.address, deployer.address],
        [
          ethers.utils.parseUnits("100", 18),
          ethers.utils.parseUnits("100", 18),
        ],
      ]
    );

    await cToken.setUp(cTokenSetupData);

    const latestBlock = await ethers.provider.getBlock("latest");
    const tokenClaimSetupData = abiCoder.encode(
      ["address", "uint256", "address", "address", "uint256"],
      [
        deployer.address,
        latestBlock.number + 5,
        pToken.address,
        cToken.address,
        ethers.utils.parseUnits("100", 18),
      ]
    );

    await cToken
      .connect(deployer)
      .approve(tokenClaim.address, ethers.utils.parseUnits("100", 18));

    await tokenClaim.setUp(tokenClaimSetupData);
  });

  it("Init is correct", async () => {
    expect(await pToken.name()).to.eq("ParentDecent");
    expect(await pToken.symbol()).to.eq("pDCNT");
    expect(await pToken.totalSupply()).to.eq(
      ethers.utils.parseUnits("250", 18)
    );
    expect(await pToken.balanceOf(deployer.address)).to.eq(
      ethers.utils.parseUnits("100", 18)
    );
    expect(await pToken.balanceOf(userA.address)).to.eq(
      ethers.utils.parseUnits("150", 18)
    );

    expect(await cToken.name()).to.eq("ChildDecent");
    expect(await cToken.symbol()).to.eq("cDCNT");
    expect(await cToken.totalSupply()).to.eq(
      ethers.utils.parseUnits("200", 18)
    );
    expect(await cToken.balanceOf(userB.address)).to.eq(
      ethers.utils.parseUnits("100", 18)
    );
    expect(await cToken.balanceOf(deployer.address)).to.eq(
      ethers.utils.parseUnits("0", 18)
    );
    expect(await cToken.balanceOf(tokenClaim.address)).to.eq(
      ethers.utils.parseUnits("100", 18)
    );
  });

  it("Inits ClaimSubsidiary contract", async () => {
    expect(await tokenClaim.childToken()).to.eq(cToken.address);
    expect(await tokenClaim.parentToken()).to.eq(pToken.address);
    expect(await tokenClaim.snapShotId()).to.eq(1);
    expect(await tokenClaim.parentAllocation()).to.eq(
      ethers.utils.parseUnits("100", 18)
    );
  });

  it("Claim Snap", async () => {
    const amount = await tokenClaim.getClaimAmount(deployer.address);
    // Claim on behalf
    await expect(
      tokenClaim.connect(userB).claimToken(deployer.address)
    ).to.emit(tokenClaim, "TokenClaimed");
    expect(
      await amount
        .add(await await tokenClaim.getClaimAmount(userA.address))
        .add(await await tokenClaim.getClaimAmount(tokenClaim.address))
    ).to.eq(ethers.utils.parseUnits("100", 18));
    expect(await cToken.balanceOf(deployer.address)).to.eq(amount);
    expect(await cToken.balanceOf(tokenClaim.address)).to.eq(
      ethers.utils.parseUnits("100", 18).sub(amount)
    );
  });

  it("Should revert double claim", async () => {
    await expect(tokenClaim.claimToken(deployer.address)).to.emit(
      tokenClaim,
      "TokenClaimed"
    );
    expect(await tokenClaim.getClaimAmount(deployer.address)).to.eq(0);
    await expect(
      tokenClaim.connect(userA).claimToken(deployer.address)
    ).to.revertedWith("NoAllocation()");
    await expect(tokenClaim.claimToken(deployer.address)).to.revertedWith(
      "NoAllocation()"
    );
  });

  it("Should revert without an allocation", async () => {
    await expect(tokenClaim.claimToken(userB.address)).to.revertedWith(
      "NoAllocation()"
    );
  });

  it("Should revert a non funder reclaim", async () => {
    await expect(tokenClaim.connect(userA).reclaim()).to.revertedWith(
      "NotTheFunder()"
    );
  });

  it("Should revert an unexpired reclaim", async () => {
    await expect(tokenClaim.connect(deployer).reclaim()).to.revertedWith(
      "DeadlinePending()"
    );
  });

  it("Should allow an expired reclaim", async () => {
    await time.advanceBlocks(5);
    await tokenClaim.connect(deployer).reclaim();
    expect(await cToken.balanceOf(deployer.address)).to.eq(
      ethers.utils.parseUnits("100", 18)
    );
  });
});
