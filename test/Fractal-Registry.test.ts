import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  FractalRegistry,
  FractalRegistry__factory,
  KeyValuePair,
  KeyValuePair__factory,
} from "../typechain-types";

describe("Fractal Registry", () => {
  // Deployed contracts
  let fractalRegistry: FractalRegistry;
  let keyValue: KeyValuePair;

  // Addresses
  let deployer: SignerWithAddress;
  let dao1: SignerWithAddress;
  let dao2: SignerWithAddress;

  beforeEach(async () => {
    [deployer, dao1, dao2] = await ethers.getSigners();

    // Deploy the Fractal Name Registry
    fractalRegistry = await new FractalRegistry__factory(deployer).deploy();
    keyValue = await new KeyValuePair__factory(deployer).deploy();
  });

  it("A DAO can update its name", async () => {
    await expect(fractalRegistry.connect(dao1).updateDAOName("Decent Dawgs"))
      .to.emit(fractalRegistry, "FractalNameUpdated")
      .withArgs(dao1.address, "Decent Dawgs");

    await expect(fractalRegistry.connect(dao2).updateDAOName("Decent Dawgs2"))
      .to.emit(fractalRegistry, "FractalNameUpdated")
      .withArgs(dao2.address, "Decent Dawgs2");
  });

  it("A DAO can update its name multiple times", async () => {
    await expect(fractalRegistry.connect(dao1).updateDAOName("Decent Dawgs"))
      .to.emit(fractalRegistry, "FractalNameUpdated")
      .withArgs(dao1.address, "Decent Dawgs");

    await expect(fractalRegistry.connect(dao1).updateDAOName("Decent Dawgs2"))
      .to.emit(fractalRegistry, "FractalNameUpdated")
      .withArgs(dao1.address, "Decent Dawgs2");
  });

  it("A DAO can declare its subDAO", async () => {
    await expect(fractalRegistry.connect(dao1).declareSubDAO(dao2.address))
      .to.emit(fractalRegistry, "FractalSubDAODeclared")
      .withArgs(dao1.address, dao2.address);
  });

  it("A DAO can declare arbitrary key/value pairs", async () => {
    await expect(keyValue.connect(dao1).updateValue("twitter", "@awesome"))
      .to.emit(keyValue, "ValueUpdated")
      .withArgs("twitter", "@awesome");
  });
});
