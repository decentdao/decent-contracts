import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  VotesToken,
  VotesToken__factory,
  ClaimSubsidiary,
  ClaimSubsidiary__factory,
} from "../typechain-types";
import chai from "chai";
import { ethers } from "hardhat";

const expect = chai.expect;

describe("VotesToken Claiming", function () {
  let pToken: VotesToken;
  let cToken: VotesToken;
  let claimSubsidiary: ClaimSubsidiary;

  let deployer: SignerWithAddress;
  let userA: SignerWithAddress;
  let userB: SignerWithAddress;

  beforeEach(async function () {
    [deployer, userA, userB] = await ethers.getSigners();

    claimSubsidiary = await new ClaimSubsidiary__factory(deployer).deploy();
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

    const claimSubsidiarySetupData = abiCoder.encode(
      ["address", "address", "address", "uint256"],
      [
        deployer.address,
        pToken.address,
        cToken.address,
        ethers.utils.parseUnits("100", 18),
      ]
    );

    await cToken
      .connect(deployer)
      .approve(claimSubsidiary.address, ethers.utils.parseUnits("100", 18));

    await claimSubsidiary.setUp(claimSubsidiarySetupData);
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
    expect(await cToken.balanceOf(claimSubsidiary.address)).to.eq(
      ethers.utils.parseUnits("100", 18)
    );
  });

  it("Inits ClaimSubsidiary contract", async () => {
    expect(await claimSubsidiary.cToken()).to.eq(cToken.address);
    expect(await claimSubsidiary.pToken()).to.eq(pToken.address);
    expect(await claimSubsidiary.snapId()).to.eq(1);
    expect(await claimSubsidiary.pAllocation()).to.eq(
      ethers.utils.parseUnits("100", 18)
    );
  });

  it("Claim Snap", async () => {
    const amount = await claimSubsidiary.calculateClaimAmount(deployer.address);
    // Claim on behalf
    await expect(
      claimSubsidiary.connect(userB).claimSnap(deployer.address)
    ).to.emit(claimSubsidiary, "SnapClaimed");
    expect(
      await amount
        .add(await await claimSubsidiary.calculateClaimAmount(userA.address))
        .add(
          await await claimSubsidiary.calculateClaimAmount(
            claimSubsidiary.address
          )
        )
    ).to.eq(ethers.utils.parseUnits("100", 18));
    expect(await cToken.balanceOf(deployer.address)).to.eq(amount);
    expect(await cToken.balanceOf(claimSubsidiary.address)).to.eq(
      ethers.utils.parseUnits("100", 18).sub(amount)
    );
  });

  it("Should revert double claim", async () => {
    await expect(claimSubsidiary.claimSnap(deployer.address)).to.emit(
      claimSubsidiary,
      "SnapClaimed"
    );
    expect(await claimSubsidiary.calculateClaimAmount(deployer.address)).to.eq(
      0
    );
    await expect(
      claimSubsidiary.connect(userA).claimSnap(deployer.address)
    ).to.revertedWith("NoAllocation()");
    await expect(claimSubsidiary.claimSnap(deployer.address)).to.revertedWith(
      "NoAllocation()"
    );
  });

  it("Should revert without an allocation", async () => {
    await expect(claimSubsidiary.claimSnap(userB.address)).to.revertedWith(
      "NoAllocation()"
    );
  });
});
