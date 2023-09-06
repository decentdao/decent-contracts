import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract } from "ethers";
import { ethers } from "hardhat";
import { MockERC20, Payroll } from "../typechain-types";
import { deploySafeAndPayroll, forkGoerli } from "./payrollSetup";
import { expect } from "chai";

describe("Streaming Payroll Test", () => {
  let owner: SignerWithAddress;
  let contributor1: SignerWithAddress;
  let contributor2: SignerWithAddress;
  let contributor3: SignerWithAddress;

  let safe: Contract;
  let payroll: Payroll;
  let token: MockERC20;

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    setTimeout(function () {}, 500);

    await forkGoerli();

    const {
      owner: o,
      safe: s,
      payroll: p,
      token: t,
    } = await deploySafeAndPayroll();
    owner = o;
    safe = s;
    payroll = p;
    token = t;

    [contributor1, contributor2, contributor3] = await ethers.getSigners();

    await token.connect(contributor1).mint(safe.address, 1000000);
  });

  describe("Payroll", () => {
    it("It works kinda", async () => {
      await expect(
        await payroll
          .connect(owner)
          .registerContributor(contributor1.address, 1, 1, 2)
      )
        .to.emit(payroll, "ContributorRegistered")
        .withArgs(contributor1.address, 1, 1, 2);
    });
  });
});
