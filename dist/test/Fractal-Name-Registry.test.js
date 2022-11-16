"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const hardhat_1 = require("hardhat");
const typechain_types_1 = require("../typechain-types");
describe("Fractal Name Registry", () => {
    // Deployed contracts
    let fractalNameRegistry;
    // Addresses
    let deployer;
    let dao1;
    let dao2;
    beforeEach(async () => {
        [deployer, dao1, dao2] = await hardhat_1.ethers.getSigners();
        // Deploy the Fractal Name Registry
        fractalNameRegistry = await new typechain_types_1.FractalNameRegistry__factory(deployer).deploy();
    });
    it("A DAO can update its string", async () => {
        await (0, chai_1.expect)(fractalNameRegistry.connect(dao1).updateDAOName("Decent Dawgs"))
            .to.emit(fractalNameRegistry, "FractalNameUpdated")
            .withArgs(dao1.address, "Decent Dawgs");
        await (0, chai_1.expect)(fractalNameRegistry.connect(dao2).updateDAOName("Decent Dawgs2"))
            .to.emit(fractalNameRegistry, "FractalNameUpdated")
            .withArgs(dao2.address, "Decent Dawgs2");
    });
    it("A DAO can update its string multiple times", async () => {
        await (0, chai_1.expect)(fractalNameRegistry.connect(dao1).updateDAOName("Decent Dawgs"))
            .to.emit(fractalNameRegistry, "FractalNameUpdated")
            .withArgs(dao1.address, "Decent Dawgs");
        await (0, chai_1.expect)(fractalNameRegistry.connect(dao1).updateDAOName("Decent Dawgs2"))
            .to.emit(fractalNameRegistry, "FractalNameUpdated")
            .withArgs(dao1.address, "Decent Dawgs2");
    });
});
