"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const typechain_types_1 = require("../typechain-types");
const chai_1 = __importDefault(require("chai"));
const hardhat_1 = require("hardhat");
const expect = chai_1.default.expect;
describe("VotesToken Claiming", function () {
    let pToken;
    let cToken;
    let tokenClaim;
    let deployer;
    let userA;
    let userB;
    beforeEach(async function () {
        [deployer, userA, userB] = await hardhat_1.ethers.getSigners();
        tokenClaim = await new typechain_types_1.TokenClaim__factory(deployer).deploy();
        pToken = await new typechain_types_1.VotesToken__factory(deployer).deploy();
        cToken = await new typechain_types_1.VotesToken__factory(deployer).deploy();
        const abiCoder = new hardhat_1.ethers.utils.AbiCoder(); // encode data
        const pTokenSetupData = abiCoder.encode(["string", "string", "address[]", "uint256[]"], [
            "ParentDecent",
            "pDCNT",
            [deployer.address, userA.address],
            [
                hardhat_1.ethers.utils.parseUnits("100", 18),
                hardhat_1.ethers.utils.parseUnits("150", 18),
            ],
        ]);
        await pToken.setUp(pTokenSetupData);
        const cTokenSetupData = abiCoder.encode(["string", "string", "address[]", "uint256[]"], [
            "ChildDecent",
            "cDCNT",
            [userB.address, deployer.address],
            [
                hardhat_1.ethers.utils.parseUnits("100", 18),
                hardhat_1.ethers.utils.parseUnits("100", 18),
            ],
        ]);
        await cToken.setUp(cTokenSetupData);
        const tokenClaimSetupData = abiCoder.encode(["address", "address", "address", "uint256"], [
            deployer.address,
            pToken.address,
            cToken.address,
            hardhat_1.ethers.utils.parseUnits("100", 18),
        ]);
        await cToken
            .connect(deployer)
            .approve(tokenClaim.address, hardhat_1.ethers.utils.parseUnits("100", 18));
        await tokenClaim.setUp(tokenClaimSetupData);
    });
    it("Init is correct", async () => {
        expect(await pToken.name()).to.eq("ParentDecent");
        expect(await pToken.symbol()).to.eq("pDCNT");
        expect(await pToken.totalSupply()).to.eq(hardhat_1.ethers.utils.parseUnits("250", 18));
        expect(await pToken.balanceOf(deployer.address)).to.eq(hardhat_1.ethers.utils.parseUnits("100", 18));
        expect(await pToken.balanceOf(userA.address)).to.eq(hardhat_1.ethers.utils.parseUnits("150", 18));
        expect(await cToken.name()).to.eq("ChildDecent");
        expect(await cToken.symbol()).to.eq("cDCNT");
        expect(await cToken.totalSupply()).to.eq(hardhat_1.ethers.utils.parseUnits("200", 18));
        expect(await cToken.balanceOf(userB.address)).to.eq(hardhat_1.ethers.utils.parseUnits("100", 18));
        expect(await cToken.balanceOf(deployer.address)).to.eq(hardhat_1.ethers.utils.parseUnits("0", 18));
        expect(await cToken.balanceOf(tokenClaim.address)).to.eq(hardhat_1.ethers.utils.parseUnits("100", 18));
    });
    it("Inits ClaimSubsidiary contract", async () => {
        expect(await tokenClaim.childToken()).to.eq(cToken.address);
        expect(await tokenClaim.parentToken()).to.eq(pToken.address);
        expect(await tokenClaim.snapShotId()).to.eq(1);
        expect(await tokenClaim.parentAllocation()).to.eq(hardhat_1.ethers.utils.parseUnits("100", 18));
    });
    it("Claim Snap", async () => {
        const amount = await tokenClaim.getClaimAmount(deployer.address);
        // Claim on behalf
        await expect(tokenClaim.connect(userB).claimToken(deployer.address)).to.emit(tokenClaim, "TokenClaimed");
        expect(await amount
            .add(await await tokenClaim.getClaimAmount(userA.address))
            .add(await await tokenClaim.getClaimAmount(tokenClaim.address))).to.eq(hardhat_1.ethers.utils.parseUnits("100", 18));
        expect(await cToken.balanceOf(deployer.address)).to.eq(amount);
        expect(await cToken.balanceOf(tokenClaim.address)).to.eq(hardhat_1.ethers.utils.parseUnits("100", 18).sub(amount));
    });
    it("Should revert double claim", async () => {
        await expect(tokenClaim.claimToken(deployer.address)).to.emit(tokenClaim, "TokenClaimed");
        expect(await tokenClaim.getClaimAmount(deployer.address)).to.eq(0);
        await expect(tokenClaim.connect(userA).claimToken(deployer.address)).to.revertedWith("NoAllocation()");
        await expect(tokenClaim.claimToken(deployer.address)).to.revertedWith("NoAllocation()");
    });
    it("Should revert without an allocation", async () => {
        await expect(tokenClaim.claimToken(userB.address)).to.revertedWith("NoAllocation()");
    });
});
