"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const ethers_1 = require("ethers");
const hardhat_1 = require("hardhat");
const typechain_types_1 = require("../typechain-types");
const getInterfaceSelector_1 = __importDefault(require("./getInterfaceSelector"));
const helpers_1 = require("./helpers");
describe("Fractal Module Tests", () => {
    // Factories
    let gnosisFactory;
    // Deployed contracts
    let gnosisSafe;
    let moduleFactory;
    let multiSend;
    let vetoGuard;
    let vetoImpl;
    let moduleImpl;
    let fractalModule;
    // Predicted Contracts
    let predictedFractalModule;
    // Wallets
    let deployer;
    let owner1;
    let owner2;
    let owner3;
    const abiCoder = new hardhat_1.ethers.utils.AbiCoder(); // encode data
    let createGnosisSetupCalldata;
    let vetoGuardFactoryInit;
    let setModuleCalldata;
    let sigs;
    const gnosisFactoryAddress = "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2";
    const gnosisSingletonAddress = "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552";
    const threshold = 2;
    let predictedVetoGuard;
    const saltNum = ethers_1.BigNumber.from("0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c");
    beforeEach(async () => {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        setTimeout(function () { }, 500); // This timeout is to prevent API rate limit errors
        // Fork Goerli to use contracts deployed on Goerli
        await hardhat_1.network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.GOERLI_PROVIDER
                            ? process.env.GOERLI_PROVIDER
                            : "",
                    },
                },
            ],
        });
        [deployer, owner1, owner2, owner3] = await hardhat_1.ethers.getSigners();
        multiSend = new hardhat_1.ethers.Contract("0x40A2aCCbd92BCA938b02010E17A5b8929b49130D", helpers_1.multisendABI, deployer);
        gnosisFactory = new hardhat_1.ethers.Contract(gnosisFactoryAddress, helpers_1.abi, deployer); // Gnosis Factory
        moduleFactory = new hardhat_1.ethers.Contract("0x00000000000DC7F163742Eb4aBEf650037b1f588", 
        // eslint-disable-next-line camelcase
        helpers_1.abiFactory, deployer);
        /// ////////////////// GNOSIS //////////////////
        // SETUP GnosisSafe
        createGnosisSetupCalldata = helpers_1.ifaceSafe.encodeFunctionData("setup", [
            [owner1.address, owner2.address, owner3.address, multiSend.address],
            1,
            hardhat_1.ethers.constants.AddressZero,
            hardhat_1.ethers.constants.HashZero,
            hardhat_1.ethers.constants.AddressZero,
            hardhat_1.ethers.constants.AddressZero,
            0,
            hardhat_1.ethers.constants.AddressZero,
        ]);
        const predictedGnosisSafeAddress = await (0, helpers_1.predictGnosisSafeAddress)(gnosisFactory.address, createGnosisSetupCalldata, saltNum, gnosisSingletonAddress, gnosisFactory);
        // Get Gnosis Safe contract
        gnosisSafe = new hardhat_1.ethers.Contract(predictedGnosisSafeAddress, helpers_1.abiSafe, deployer);
        /// /////////////  GUARD ///////////////////
        // DEPLOY GUARD
        vetoImpl = await new typechain_types_1.VetoGuard__factory(deployer).deploy(); // Veto Impl
        vetoGuardFactoryInit =
            // eslint-disable-next-line camelcase
            typechain_types_1.FractalModule__factory.createInterface().encodeFunctionData("setUp", [
                abiCoder.encode(["uint256", "address", "address", "address"], [10, owner1.address, owner1.address, gnosisSafe.address]),
            ]);
        predictedVetoGuard = await (0, helpers_1.calculateProxyAddress)(moduleFactory, vetoImpl.address, vetoGuardFactoryInit, "10031021");
        vetoGuard = await hardhat_1.ethers.getContractAt("VetoGuard", predictedVetoGuard);
        /// /////////////// MODULE ////////////////
        // DEPLOY Fractal Module
        moduleImpl = await new typechain_types_1.FractalModule__factory(deployer).deploy();
        // SETUP Module
        setModuleCalldata =
            // eslint-disable-next-line camelcase
            typechain_types_1.FractalModule__factory.createInterface().encodeFunctionData("setUp", [
                abiCoder.encode(["address", "address", "address", "address[]"], [
                    owner1.address,
                    gnosisSafe.address,
                    gnosisSafe.address,
                    [owner2.address],
                ]),
            ]);
        predictedFractalModule = await (0, helpers_1.calculateProxyAddress)(moduleFactory, moduleImpl.address, setModuleCalldata, "10031021");
        fractalModule = await hardhat_1.ethers.getContractAt("FractalModule", predictedFractalModule);
        // TX Array
        sigs =
            "0x000000000000000000000000" +
                multiSend.address.slice(2) +
                "0000000000000000000000000000000000000000000000000000000000000000" +
                "01";
    });
    describe("Fractal Module", () => {
        it("Supports the expected ERC165 interface", async () => {
            const txs = [
                (0, helpers_1.buildContractCall)(gnosisFactory, "createProxyWithNonce", [gnosisSingletonAddress, createGnosisSetupCalldata, saltNum], 0, false),
                (0, helpers_1.buildContractCall)(moduleFactory, "deployModule", [moduleImpl.address, setModuleCalldata, "10031021"], 0, false),
            ];
            const safeTx = (0, helpers_1.encodeMultiSend)(txs);
            await (0, chai_1.expect)(multiSend.multiSend(safeTx))
                .to.emit(gnosisFactory, "ProxyCreation")
                .withArgs(gnosisSafe.address, gnosisSingletonAddress);
            // Supports Fractal Module
            (0, chai_1.expect)(await fractalModule.supportsInterface(
            // eslint-disable-next-line camelcase
            (0, getInterfaceSelector_1.default)(typechain_types_1.IFractalModule__factory.createInterface()))).to.eq(true);
        });
        it("Owner may add/remove controllers", async () => {
            const txs = [
                (0, helpers_1.buildContractCall)(gnosisFactory, "createProxyWithNonce", [gnosisSingletonAddress, createGnosisSetupCalldata, saltNum], 0, false),
                (0, helpers_1.buildContractCall)(moduleFactory, "deployModule", [moduleImpl.address, setModuleCalldata, "10031021"], 0, false),
            ];
            const safeTx = (0, helpers_1.encodeMultiSend)(txs);
            await multiSend.multiSend(safeTx);
            // ADD Controller
            await (0, chai_1.expect)(fractalModule.connect(owner3).addControllers([owner3.address])).to.revertedWith("Ownable: caller is not the owner");
            (0, chai_1.expect)(await fractalModule.controllers(owner3.address)).eq(false);
            await (0, chai_1.expect)(fractalModule.connect(owner1).addControllers([owner3.address])).to.emit(fractalModule, "ControllersAdded");
            (0, chai_1.expect)(await fractalModule.controllers(owner3.address)).eq(true);
            // REMOVE Controller
            await (0, chai_1.expect)(fractalModule.connect(owner3).removeControllers([owner3.address])).to.revertedWith("Ownable: caller is not the owner");
            (0, chai_1.expect)(await fractalModule.controllers(owner3.address)).eq(true);
            await (0, chai_1.expect)(fractalModule.connect(owner1).removeControllers([owner3.address])).to.emit(fractalModule, "ControllersRemoved");
            (0, chai_1.expect)(await fractalModule.controllers(owner3.address)).eq(false);
        });
        it("Authorized users may exec txs => GS", async () => {
            const internalTxs = [
                (0, helpers_1.buildContractCall)(gnosisSafe, "enableModule", [fractalModule.address], 0, false),
            ];
            const safeInternalTx = (0, helpers_1.encodeMultiSend)(internalTxs);
            const txs = [
                (0, helpers_1.buildContractCall)(gnosisFactory, "createProxyWithNonce", [gnosisSingletonAddress, createGnosisSetupCalldata, saltNum], 0, false),
                (0, helpers_1.buildContractCall)(moduleFactory, "deployModule", [moduleImpl.address, setModuleCalldata, "10031021"], 0, false),
                (0, helpers_1.buildContractCall)(moduleFactory, "deployModule", [vetoImpl.address, vetoGuardFactoryInit, "10031021"], 0, false),
                (0, helpers_1.buildContractCall)(gnosisSafe, "execTransaction", [
                    multiSend.address,
                    "0",
                    // eslint-disable-next-line camelcase
                    helpers_1.ifaceMultiSend.encodeFunctionData("multiSend", [safeInternalTx]),
                    "1",
                    "0",
                    "0",
                    "0",
                    hardhat_1.ethers.constants.AddressZero,
                    hardhat_1.ethers.constants.AddressZero,
                    sigs, // sigs
                ], 0, false),
            ];
            const safeTx = (0, helpers_1.encodeMultiSend)(txs);
            await multiSend.multiSend(safeTx);
            // FUND SAFE
            const abiCoder = new hardhat_1.ethers.utils.AbiCoder(); // encode data
            const votesTokenSetupData = abiCoder.encode(["string", "string", "address[]", "uint256[]"], ["DCNT", "DCNT", [gnosisSafe.address], [1000]]);
            const votesToken = await new typechain_types_1.VotesToken__factory(deployer).deploy();
            await votesToken.setUp(votesTokenSetupData);
            (0, chai_1.expect)(await votesToken.balanceOf(gnosisSafe.address)).to.eq(1000);
            (0, chai_1.expect)(await votesToken.balanceOf(owner1.address)).to.eq(0);
            // CLAWBACK FUNDS
            const clawBackCalldata = 
            // eslint-disable-next-line camelcase
            typechain_types_1.VotesToken__factory.createInterface().encodeFunctionData("transfer", [
                owner1.address,
                500,
            ]);
            const txData = 
            // eslint-disable-next-line camelcase
            abiCoder.encode(["address", "uint256", "bytes", "uint8"], [votesToken.address, 0, clawBackCalldata, 0]);
            // REVERT => NOT AUTHORIZED
            await (0, chai_1.expect)(fractalModule.execTx(txData)).to.be.revertedWith("Not Authorized");
            // OWNER MAY EXECUTE
            await (0, chai_1.expect)(fractalModule.connect(owner1).execTx(txData)).to.emit(gnosisSafe, "ExecutionFromModuleSuccess");
            // Controller MAY EXECUTE
            await (0, chai_1.expect)(fractalModule.connect(owner2).execTx(txData)).to.emit(gnosisSafe, "ExecutionFromModuleSuccess");
            // REVERT => Execution Failure
            await (0, chai_1.expect)(fractalModule.connect(owner1).execTx(txData)).to.be.revertedWith("Module transaction failed");
            (0, chai_1.expect)(await votesToken.balanceOf(gnosisSafe.address)).to.eq(0);
            (0, chai_1.expect)(await votesToken.balanceOf(owner1.address)).to.eq(1000);
        });
    });
});
