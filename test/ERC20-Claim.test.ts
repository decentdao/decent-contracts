import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  VotesERC20,
  VotesERC20__factory,
  ERC20Claim,
  ERC20Claim__factory,
} from "../typechain-types";
import chai from "chai";
import { ethers } from "hardhat";
import time from "./time";

const expect = chai.expect;

describe("ERC-20 Token Claiming", function () {
  let parentERC20: VotesERC20;
  let childERC20: VotesERC20;
  let erc20Claim: ERC20Claim;

  let deployer: SignerWithAddress;
  let userA: SignerWithAddress;
  let userB: SignerWithAddress;

  beforeEach(async function () {
    [deployer, userA, userB] = await ethers.getSigners();

    erc20Claim = await new ERC20Claim__factory(deployer).deploy();
    parentERC20 = await new VotesERC20__factory(deployer).deploy();
    childERC20 = await new VotesERC20__factory(deployer).deploy();

    const abiCoder = new ethers.utils.AbiCoder(); // encode data

    const parentERC20SetupData = abiCoder.encode(
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

    await parentERC20.setUp(parentERC20SetupData);

    const childERC20SetupData = abiCoder.encode(
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

    await childERC20.setUp(childERC20SetupData);

    const latestBlock = await ethers.provider.getBlock("latest");
    const erc20ClaimSetupData = abiCoder.encode(
      ["uint32", "address", "address", "address", "uint256"],
      [
        latestBlock.number + 5,
        deployer.address,
        parentERC20.address,
        childERC20.address,
        ethers.utils.parseUnits("100", 18),
      ]
    );

    await childERC20
      .connect(deployer)
      .approve(erc20Claim.address, ethers.utils.parseUnits("100", 18));

    await erc20Claim.setUp(erc20ClaimSetupData);
  });

  it("Init is correct", async () => {
    expect(await parentERC20.name()).to.eq("ParentDecent");
    expect(await parentERC20.symbol()).to.eq("pDCNT");
    expect(await parentERC20.totalSupply()).to.eq(
      ethers.utils.parseUnits("250", 18)
    );
    expect(await parentERC20.balanceOf(deployer.address)).to.eq(
      ethers.utils.parseUnits("100", 18)
    );
    expect(await parentERC20.balanceOf(userA.address)).to.eq(
      ethers.utils.parseUnits("150", 18)
    );

    expect(await childERC20.name()).to.eq("ChildDecent");
    expect(await childERC20.symbol()).to.eq("cDCNT");
    expect(await childERC20.totalSupply()).to.eq(
      ethers.utils.parseUnits("200", 18)
    );
    expect(await childERC20.balanceOf(userB.address)).to.eq(
      ethers.utils.parseUnits("100", 18)
    );
    expect(await childERC20.balanceOf(deployer.address)).to.eq(
      ethers.utils.parseUnits("0", 18)
    );
    expect(await childERC20.balanceOf(erc20Claim.address)).to.eq(
      ethers.utils.parseUnits("100", 18)
    );
  });

  it("Inits ClaimSubsidiary contract", async () => {
    expect(await erc20Claim.childERC20()).to.eq(childERC20.address);
    expect(await erc20Claim.parentERC20()).to.eq(parentERC20.address);
    expect(await erc20Claim.snapShotId()).to.eq(1);
    expect(await erc20Claim.parentAllocation()).to.eq(
      ethers.utils.parseUnits("100", 18)
    );
  });

  it("Claim Snap", async () => {
    const amount = await erc20Claim.getClaimAmount(deployer.address);
    // Claim on behalf
    await expect(
      erc20Claim.connect(userB).claimTokens(deployer.address)
    ).to.emit(erc20Claim, "ERC20Claimed");
    expect(
      await amount
        .add(await await erc20Claim.getClaimAmount(userA.address))
        .add(await await erc20Claim.getClaimAmount(erc20Claim.address))
    ).to.eq(ethers.utils.parseUnits("100", 18));
    expect(await childERC20.balanceOf(deployer.address)).to.eq(amount);
    expect(await childERC20.balanceOf(erc20Claim.address)).to.eq(
      ethers.utils.parseUnits("100", 18).sub(amount)
    );
  });

  it("Should revert double claim", async () => {
    await expect(erc20Claim.claimTokens(deployer.address)).to.emit(
      erc20Claim,
      "ERC20Claimed"
    );
    expect(await erc20Claim.getClaimAmount(deployer.address)).to.eq(0);
    await expect(
      erc20Claim.connect(userA).claimTokens(deployer.address)
    ).to.revertedWith("NoAllocation()");
    await expect(erc20Claim.claimTokens(deployer.address)).to.revertedWith(
      "NoAllocation()"
    );
  });

  it("Should revert without an allocation", async () => {
    await expect(erc20Claim.claimTokens(userB.address)).to.revertedWith(
      "NoAllocation()"
    );
  });

  it("Should revert a non funder reclaim", async () => {
    await expect(erc20Claim.connect(userA).reclaim()).to.revertedWith(
      "NotTheFunder()"
    );
  });

  it("Should revert an unexpired reclaim", async () => {
    await expect(erc20Claim.connect(deployer).reclaim()).to.revertedWith(
      "DeadlinePending()"
    );
  });

  it("Should allow an expired reclaim", async () => {
    await time.advanceBlocks(5);
    await erc20Claim.connect(deployer).reclaim();
    expect(await childERC20.balanceOf(deployer.address)).to.eq(
      ethers.utils.parseUnits("100", 18)
    );
  });

  it("If the deadlineBlock is setup as zero, then calling reclaim will revert", async () => {
    childERC20 = await new VotesERC20__factory(deployer).deploy();

    erc20Claim = await new ERC20Claim__factory(deployer).deploy();

    const abiCoder = new ethers.utils.AbiCoder(); // encode data

    const childERC20SetupData = abiCoder.encode(
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

    await childERC20.setUp(childERC20SetupData);

    const erc20ClaimSetupData = abiCoder.encode(
      ["uint32", "address", "address", "address", "uint256"],
      [
        0,
        deployer.address,
        parentERC20.address,
        childERC20.address,
        ethers.utils.parseUnits("100", 18),
      ]
    );

    await childERC20
      .connect(deployer)
      .approve(erc20Claim.address, ethers.utils.parseUnits("100", 18));

    await erc20Claim.setUp(erc20ClaimSetupData);

    await expect(erc20Claim.connect(deployer).reclaim()).to.be.revertedWith(
      "NoDeadline()"
    );
  });
});
