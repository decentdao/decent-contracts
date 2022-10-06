import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  FractalNameRegistry,
  FractalNameRegistry__factory,
} from "../typechain-types";

describe("Fractal Name Registry", () => {
  // Deployed contracts
  let fractalNameRegistry: FractalNameRegistry;

  // Addresses
  let deployer: SignerWithAddress;
  let dao1: SignerWithAddress;
  let dao2: SignerWithAddress;

  beforeEach(async () => {
    [deployer, dao1, dao2] = await ethers.getSigners();

    // Deploy the Fractal Name Registry
    fractalNameRegistry = await new FractalNameRegistry__factory(
      deployer
    ).deploy();
  });

  it("A DAO can update its string", async () => {
    await expect(
      fractalNameRegistry.connect(dao1).updateDAOName("Decent Dawgs")
    )
      .to.emit(fractalNameRegistry, "FractalNameUpdated")
      .withArgs(dao1.address, "Decent Dawgs");

    await expect(
      fractalNameRegistry.connect(dao2).updateDAOName("Decent Dawgs2")
    )
      .to.emit(fractalNameRegistry, "FractalNameUpdated")
      .withArgs(dao2.address, "Decent Dawgs2");
  });

  it("A DAO can update its string multiple times", async () => {
    await expect(
      fractalNameRegistry.connect(dao1).updateDAOName("Decent Dawgs")
    )
      .to.emit(fractalNameRegistry, "FractalNameUpdated")
      .withArgs(dao1.address, "Decent Dawgs");

    await expect(
      fractalNameRegistry.connect(dao1).updateDAOName("Decent Dawgs2")
    )
      .to.emit(fractalNameRegistry, "FractalNameUpdated")
      .withArgs(dao1.address, "Decent Dawgs2");
  });
});
