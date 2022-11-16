"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const ethers_1 = require("ethers");
const hardhat_1 = require("hardhat");
const typechain_types_1 = require("../typechain-types");
const helpers_1 = require("./helpers");
describe("Gnosis Safe", () => {
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
    describe("Atomic Gnosis Safe Deployment", () => {
        it("Setup Fractal Module w/ ModuleProxyCreationEvent", async () => {
            const txs = [
                (0, helpers_1.buildContractCall)(gnosisFactory, "createProxyWithNonce", [gnosisSingletonAddress, createGnosisSetupCalldata, saltNum], 0, false),
                (0, helpers_1.buildContractCall)(moduleFactory, "deployModule", [moduleImpl.address, setModuleCalldata, "10031021"], 0, false),
            ];
            const safeTx = (0, helpers_1.encodeMultiSend)(txs);
            await (0, chai_1.expect)(multiSend.multiSend(safeTx))
                .to.emit(moduleFactory, "ModuleProxyCreation")
                .withArgs(predictedFractalModule, moduleImpl.address);
            (0, chai_1.expect)(await fractalModule.avatar()).eq(gnosisSafe.address);
            (0, chai_1.expect)(await fractalModule.target()).eq(gnosisSafe.address);
            (0, chai_1.expect)(await fractalModule.owner()).eq(owner1.address);
        });
        it("Setup VetoGuard w/ ModuleProxyCreationEvent", async () => {
            const txs = [
                (0, helpers_1.buildContractCall)(gnosisFactory, "createProxyWithNonce", [gnosisSingletonAddress, createGnosisSetupCalldata, saltNum], 0, false),
                (0, helpers_1.buildContractCall)(moduleFactory, "deployModule", [vetoImpl.address, vetoGuardFactoryInit, "10031021"], 0, false),
            ];
            const safeTx = (0, helpers_1.encodeMultiSend)(txs);
            await (0, chai_1.expect)(multiSend.multiSend(safeTx))
                .to.emit(moduleFactory, "ModuleProxyCreation")
                .withArgs(predictedVetoGuard, vetoImpl.address);
            (0, chai_1.expect)(await vetoGuard.executionDelayBlocks()).eq(10);
            (0, chai_1.expect)(await vetoGuard.vetoVoting()).eq(owner1.address);
            (0, chai_1.expect)(await vetoGuard.gnosisSafe()).eq(gnosisSafe.address);
        });
        it("Setup Usul Module w/ ModuleProxyCreationEvent", async () => {
            const VOTING_STRATEGIES_TO_DEPLOY = [];
            const encodedInitUsulData = hardhat_1.ethers.utils.defaultAbiCoder.encode(["address", "address", "address", "address[]"], [
                gnosisSafe.address,
                gnosisSafe.address,
                gnosisSafe.address,
                VOTING_STRATEGIES_TO_DEPLOY,
            ]);
            const encodedSetupUsulData = helpers_1.usuliface.encodeFunctionData("setUp", [
                encodedInitUsulData,
            ]);
            const predictedUsulModule = await (0, helpers_1.calculateProxyAddress)(moduleFactory, "0xCdea1582a57Ca4A678070Fa645aaf3a40c2164C1", encodedSetupUsulData, "10031021");
            const usulContract = new hardhat_1.ethers.Contract(predictedUsulModule, 
            // eslint-disable-next-line camelcase
            helpers_1.abiUsul, deployer);
            const txs = [
                (0, helpers_1.buildContractCall)(gnosisFactory, "createProxyWithNonce", [gnosisSingletonAddress, createGnosisSetupCalldata, saltNum], 0, false),
                (0, helpers_1.buildContractCall)(moduleFactory, "deployModule", [
                    "0xCdea1582a57Ca4A678070Fa645aaf3a40c2164C1",
                    encodedSetupUsulData,
                    "10031021",
                ], 0, false),
            ];
            const safeTx = (0, helpers_1.encodeMultiSend)(txs);
            await (0, chai_1.expect)(multiSend.multiSend(safeTx))
                .to.emit(moduleFactory, "ModuleProxyCreation")
                .withArgs(predictedUsulModule, "0xCdea1582a57Ca4A678070Fa645aaf3a40c2164C1");
            (0, chai_1.expect)(await usulContract.avatar()).eq(gnosisSafe.address);
            (0, chai_1.expect)(await usulContract.target()).eq(gnosisSafe.address);
            (0, chai_1.expect)(await usulContract.owner()).eq(gnosisSafe.address);
        });
        it("Setup Module w/ enabledModule event", async () => {
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
            await (0, chai_1.expect)(multiSend.multiSend(safeTx))
                .to.emit(gnosisSafe, "EnabledModule")
                .withArgs(fractalModule.address);
            (0, chai_1.expect)(await gnosisSafe.isModuleEnabled(fractalModule.address)).to.eq(true);
        });
        it("Setup UsulModule w/ enabledModule event", async () => {
            const VOTING_STRATEGIES_TO_DEPLOY = []; // @todo pass expected addresses for voting strategies
            const encodedInitUsulData = hardhat_1.ethers.utils.defaultAbiCoder.encode(["address", "address", "address", "address[]"], [
                gnosisSafe.address,
                gnosisSafe.address,
                gnosisSafe.address,
                VOTING_STRATEGIES_TO_DEPLOY,
            ]);
            const encodedSetupUsulData = helpers_1.usuliface.encodeFunctionData("setUp", [
                encodedInitUsulData,
            ]);
            const predictedUsulModule = await (0, helpers_1.calculateProxyAddress)(moduleFactory, "0xCdea1582a57Ca4A678070Fa645aaf3a40c2164C1", encodedSetupUsulData, "10031021");
            const usulContract = new hardhat_1.ethers.Contract(predictedUsulModule, 
            // eslint-disable-next-line camelcase
            helpers_1.abiUsul, deployer);
            const internalTxs = [
                (0, helpers_1.buildContractCall)(gnosisSafe, "enableModule", [fractalModule.address], 0, false),
                (0, helpers_1.buildContractCall)(gnosisSafe, "enableModule", [usulContract.address], 0, false),
            ];
            const safeInternalTx = (0, helpers_1.encodeMultiSend)(internalTxs);
            const txs = [
                (0, helpers_1.buildContractCall)(gnosisFactory, "createProxyWithNonce", [gnosisSingletonAddress, createGnosisSetupCalldata, saltNum], 0, false),
                (0, helpers_1.buildContractCall)(moduleFactory, "deployModule", [moduleImpl.address, setModuleCalldata, "10031021"], 0, false),
                (0, helpers_1.buildContractCall)(moduleFactory, "deployModule", [vetoImpl.address, vetoGuardFactoryInit, "10031021"], 0, false),
                (0, helpers_1.buildContractCall)(moduleFactory, "deployModule", [
                    "0xCdea1582a57Ca4A678070Fa645aaf3a40c2164C1",
                    encodedSetupUsulData,
                    "10031021",
                ], 0, false),
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
            await (0, chai_1.expect)(multiSend.multiSend(safeTx))
                .to.emit(gnosisSafe, "EnabledModule")
                .withArgs(usulContract.address);
            (0, chai_1.expect)(await gnosisSafe.isModuleEnabled(usulContract.address)).to.eq(true);
        });
        it("Setup Guard w/ changeGuard event", async () => {
            const internalTxs = [
                (0, helpers_1.buildContractCall)(gnosisSafe, "setGuard", [vetoGuard.address], 0, false),
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
            await (0, chai_1.expect)(multiSend.multiSend(safeTx))
                .to.emit(gnosisSafe, "ChangedGuard")
                .withArgs(vetoGuard.address);
        });
        it("Setup Gnosis Safe w/ removedOwner event", async () => {
            const internalTxs = [
                (0, helpers_1.buildContractCall)(gnosisSafe, "removeOwner", [owner3.address, multiSend.address, threshold], 0, false),
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
            await (0, chai_1.expect)(multiSend.multiSend(safeTx))
                .to.emit(gnosisSafe, "RemovedOwner")
                .withArgs(multiSend.address);
            (0, chai_1.expect)(await gnosisSafe.isOwner(owner1.address)).eq(true);
            (0, chai_1.expect)(await gnosisSafe.isOwner(owner2.address)).eq(true);
            (0, chai_1.expect)(await gnosisSafe.isOwner(owner3.address)).eq(true);
            (0, chai_1.expect)(await gnosisSafe.isOwner(multiSend.address)).eq(false);
            (0, chai_1.expect)(await gnosisSafe.getThreshold()).eq(threshold);
        });
    });
});
