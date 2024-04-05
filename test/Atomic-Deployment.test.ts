import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import {
  Azorius__factory,
  FractalModule,
  FractalModule__factory,
  GnosisSafeL2,
  GnosisSafeL2__factory,
  GnosisSafeProxyFactory,
  ModuleProxyFactory,
  MultiSendCallOnly,
  MultiSendCallOnly__factory,
  MultisigFreezeGuard,
  MultisigFreezeGuard__factory,
} from "../typechain-types";
import {
  calculateProxyAddress,
  predictGnosisSafeAddress,
  buildContractCall,
  MetaTransaction,
  encodeMultiSend,
} from "./helpers";

import {
  getGnosisSafeL2Singleton,
  getGnosisSafeProxyFactory,
  getModuleProxyFactory,
  getMultiSendCallOnly,
} from "./GlobalSafeDeployments.test";

describe("Atomic Gnosis Safe Deployment", () => {
  // Factories
  let gnosisSafeProxyFactory: GnosisSafeProxyFactory;

  // Deployed contracts
  let gnosisSafeL2Singleton: GnosisSafeL2;
  let gnosisSafe: GnosisSafeL2;
  let moduleProxyFactory: ModuleProxyFactory;
  let multiSendCallOnly: MultiSendCallOnly;
  let freezeGuard: MultisigFreezeGuard;
  let freezeGuardImplementation: MultisigFreezeGuard;
  let fractalModuleSingleton: FractalModule;
  let fractalModule: FractalModule;

  // Predicted Contracts
  let predictedFractalModule: string;

  // Wallets
  let deployer: SignerWithAddress;
  let owner1: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;

  const abiCoder = new ethers.utils.AbiCoder(); // encode data
  let createGnosisSetupCalldata: string;
  let freezeGuardFactoryInit: string;
  let setModuleCalldata: string;
  let sigs: string;

  const threshold = 2;
  let predictedFreezeGuard: string;
  const saltNum = BigNumber.from(
    "0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c"
  );

  beforeEach(async () => {
    gnosisSafeProxyFactory = getGnosisSafeProxyFactory();
    moduleProxyFactory = getModuleProxyFactory();
    multiSendCallOnly = getMultiSendCallOnly();
    gnosisSafeL2Singleton = getGnosisSafeL2Singleton();

    [deployer, owner1, owner2, owner3] = await ethers.getSigners();

    /// ////////////////// GNOSIS //////////////////
    // SETUP GnosisSafe
    createGnosisSetupCalldata =
      // eslint-disable-next-line camelcase
      GnosisSafeL2__factory.createInterface().encodeFunctionData("setup", [
        [
          owner1.address,
          owner2.address,
          owner3.address,
          multiSendCallOnly.address,
        ],
        1,
        ethers.constants.AddressZero,
        ethers.constants.HashZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        0,
        ethers.constants.AddressZero,
      ]);

    const predictedGnosisSafeAddress = await predictGnosisSafeAddress(
      createGnosisSetupCalldata,
      saltNum,
      gnosisSafeL2Singleton.address,
      gnosisSafeProxyFactory
    );

    // Get Gnosis Safe contract
    // eslint-disable-next-line camelcase
    gnosisSafe = GnosisSafeL2__factory.connect(
      predictedGnosisSafeAddress,
      deployer
    );

    /// /////////////  GUARD ///////////////////
    // DEPLOY GUARD
    freezeGuardImplementation = await new MultisigFreezeGuard__factory(
      deployer
    ).deploy();
    freezeGuardFactoryInit =
      // eslint-disable-next-line camelcase
      MultisigFreezeGuard__factory.createInterface().encodeFunctionData(
        "setUp",
        [
          abiCoder.encode(
            ["uint256", "uint256", "address", "address", "address"],
            [10, 20, owner1.address, owner1.address, gnosisSafe.address]
          ),
        ]
      );

    predictedFreezeGuard = calculateProxyAddress(
      moduleProxyFactory,
      freezeGuardImplementation.address,
      freezeGuardFactoryInit,
      "10031021"
    );

    freezeGuard = await ethers.getContractAt(
      "MultisigFreezeGuard",
      predictedFreezeGuard
    );

    /// /////////////// MODULE ////////////////
    // DEPLOY Fractal Module
    fractalModuleSingleton = await new FractalModule__factory(
      deployer
    ).deploy();

    // SETUP Module
    setModuleCalldata =
      // eslint-disable-next-line camelcase
      FractalModule__factory.createInterface().encodeFunctionData("setUp", [
        abiCoder.encode(
          ["address", "address", "address", "address[]"],
          [
            owner1.address,
            gnosisSafe.address,
            gnosisSafe.address,
            [owner2.address],
          ]
        ),
      ]);

    predictedFractalModule = calculateProxyAddress(
      moduleProxyFactory,
      fractalModuleSingleton.address,
      setModuleCalldata,
      "10031021"
    );

    fractalModule = await ethers.getContractAt(
      "FractalModule",
      predictedFractalModule
    );

    // TX Array
    sigs =
      "0x000000000000000000000000" +
      multiSendCallOnly.address.slice(2) +
      "0000000000000000000000000000000000000000000000000000000000000000" +
      "01";
  });

  describe("Atomic Gnosis Safe Deployment", () => {
    it("Setup Fractal Module w/ ModuleProxyCreationEvent", async () => {
      const txs: MetaTransaction[] = [
        buildContractCall(
          gnosisSafeProxyFactory,
          "createProxyWithNonce",
          [gnosisSafeL2Singleton.address, createGnosisSetupCalldata, saltNum],
          0,
          false
        ),
        buildContractCall(
          moduleProxyFactory,
          "deployModule",
          [fractalModuleSingleton.address, setModuleCalldata, "10031021"],
          0,
          false
        ),
      ];
      const safeTx = encodeMultiSend(txs);
      await expect(multiSendCallOnly.multiSend(safeTx))
        .to.emit(moduleProxyFactory, "ModuleProxyCreation")
        .withArgs(predictedFractalModule, fractalModuleSingleton.address);

      expect(await fractalModule.avatar()).eq(gnosisSafe.address);
      expect(await fractalModule.target()).eq(gnosisSafe.address);
      expect(await fractalModule.owner()).eq(owner1.address);
    });

    it("Setup FreezeGuard w/ ModuleProxyCreationEvent", async () => {
      const txs: MetaTransaction[] = [
        buildContractCall(
          gnosisSafeProxyFactory,
          "createProxyWithNonce",
          [gnosisSafeL2Singleton.address, createGnosisSetupCalldata, saltNum],
          0,
          false
        ),
        buildContractCall(
          moduleProxyFactory,
          "deployModule",
          [
            freezeGuardImplementation.address,
            freezeGuardFactoryInit,
            "10031021",
          ],
          0,
          false
        ),
      ];
      const safeTx = encodeMultiSend(txs);
      await expect(multiSendCallOnly.multiSend(safeTx))
        .to.emit(moduleProxyFactory, "ModuleProxyCreation")
        .withArgs(predictedFreezeGuard, freezeGuardImplementation.address);
      expect(await freezeGuard.timelockPeriod()).eq(10);
      expect(await freezeGuard.freezeVoting()).eq(owner1.address);
      expect(await freezeGuard.childGnosisSafe()).eq(gnosisSafe.address);
    });

    it("Setup Azorius Module w/ ModuleProxyCreationEvent", async () => {
      const VOTING_STRATEGIES_TO_DEPLOY: string[] = [];
      const encodedInitAzoriusData = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "address[]", "uint32", "uint32"],
        [
          gnosisSafe.address,
          gnosisSafe.address,
          gnosisSafe.address,
          VOTING_STRATEGIES_TO_DEPLOY,
          0,
          0,
        ]
      );
      const encodedSetupAzoriusData =
        // eslint-disable-next-line camelcase
        Azorius__factory.createInterface().encodeFunctionData("setUp", [
          encodedInitAzoriusData,
        ]);

      const azoriusSingleton = await new Azorius__factory(deployer).deploy();

      const predictedAzoriusModule = calculateProxyAddress(
        moduleProxyFactory,
        azoriusSingleton.address,
        encodedSetupAzoriusData,
        "10031021"
      );

      // eslint-disable-next-line camelcase
      const azoriusContract = Azorius__factory.connect(
        predictedAzoriusModule,
        deployer
      );

      const txs: MetaTransaction[] = [
        buildContractCall(
          gnosisSafeProxyFactory,
          "createProxyWithNonce",
          [gnosisSafeL2Singleton.address, createGnosisSetupCalldata, saltNum],
          0,
          false
        ),
        buildContractCall(
          moduleProxyFactory,
          "deployModule",
          [azoriusSingleton.address, encodedSetupAzoriusData, "10031021"],
          0,
          false
        ),
      ];
      const safeTx = encodeMultiSend(txs);

      const tx = await multiSendCallOnly.multiSend(safeTx);

      await expect(tx)
        .to.emit(moduleProxyFactory, "ModuleProxyCreation")
        .withArgs(predictedAzoriusModule, azoriusSingleton.address);

      expect(await azoriusContract.avatar()).eq(gnosisSafe.address);
      expect(await azoriusContract.target()).eq(gnosisSafe.address);
      expect(await azoriusContract.owner()).eq(gnosisSafe.address);
    });

    it("Setup Module w/ enabledModule event", async () => {
      const internalTxs: MetaTransaction[] = [
        buildContractCall(
          gnosisSafe,
          "enableModule",
          [fractalModule.address],
          0,
          false
        ),
      ];
      const safeInternalTx = encodeMultiSend(internalTxs);
      const txs: MetaTransaction[] = [
        buildContractCall(
          gnosisSafeProxyFactory,
          "createProxyWithNonce",
          [gnosisSafeL2Singleton.address, createGnosisSetupCalldata, saltNum],
          0,
          false
        ),
        buildContractCall(
          moduleProxyFactory,
          "deployModule",
          [fractalModuleSingleton.address, setModuleCalldata, "10031021"],
          0,
          false
        ),
        buildContractCall(
          moduleProxyFactory,
          "deployModule",
          [
            freezeGuardImplementation.address,
            freezeGuardFactoryInit,
            "10031021",
          ],
          0,
          false
        ),
        buildContractCall(
          gnosisSafe,
          "execTransaction",
          [
            multiSendCallOnly.address, // to
            "0", // value
            // eslint-disable-next-line camelcase
            MultiSendCallOnly__factory.createInterface().encodeFunctionData(
              "multiSend",
              [safeInternalTx]
            ), // calldata
            "1", // operation
            "0", // tx gas
            "0", // base gas
            "0", // gas price
            ethers.constants.AddressZero, // gas token
            ethers.constants.AddressZero, // receiver
            sigs, // sigs
          ],
          0,
          false
        ),
      ];
      const safeTx = encodeMultiSend(txs);
      await expect(multiSendCallOnly.multiSend(safeTx))
        .to.emit(gnosisSafe, "EnabledModule")
        .withArgs(fractalModule.address);
      expect(await gnosisSafe.isModuleEnabled(fractalModule.address)).to.eq(
        true
      );
    });

    it("Setup AzoriusModule w/ enabledModule event", async () => {
      const VOTING_STRATEGIES_TO_DEPLOY: string[] = []; // @todo pass expected addresses for voting strategies
      const encodedInitAzoriusData = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "address[]", "uint32", "uint32"],
        [
          gnosisSafe.address,
          gnosisSafe.address,
          gnosisSafe.address,
          VOTING_STRATEGIES_TO_DEPLOY,
          0,
          0,
        ]
      );
      const encodedSetupAzoriusData =
        // eslint-disable-next-line camelcase
        Azorius__factory.createInterface().encodeFunctionData("setUp", [
          encodedInitAzoriusData,
        ]);

      const azoriusSingleton = await new Azorius__factory(deployer).deploy();

      const predictedAzoriusModule = calculateProxyAddress(
        moduleProxyFactory,
        azoriusSingleton.address,
        encodedSetupAzoriusData,
        "10031021"
      );

      // eslint-disable-next-line camelcase
      const azoriusContract = Azorius__factory.connect(
        predictedAzoriusModule,
        deployer
      );

      const internalTxs: MetaTransaction[] = [
        buildContractCall(
          gnosisSafe,
          "enableModule",
          [fractalModule.address],
          0,
          false
        ),
        buildContractCall(
          gnosisSafe,
          "enableModule",
          [azoriusContract.address],
          0,
          false
        ),
      ];
      const safeInternalTx = encodeMultiSend(internalTxs);
      const txs: MetaTransaction[] = [
        buildContractCall(
          gnosisSafeProxyFactory,
          "createProxyWithNonce",
          [gnosisSafeL2Singleton.address, createGnosisSetupCalldata, saltNum],
          0,
          false
        ),
        buildContractCall(
          moduleProxyFactory,
          "deployModule",
          [fractalModuleSingleton.address, setModuleCalldata, "10031021"],
          0,
          false
        ),
        buildContractCall(
          moduleProxyFactory,
          "deployModule",
          [
            freezeGuardImplementation.address,
            freezeGuardFactoryInit,
            "10031021",
          ],
          0,
          false
        ),
        buildContractCall(
          moduleProxyFactory,
          "deployModule",
          [azoriusSingleton.address, encodedSetupAzoriusData, "10031021"],
          0,
          false
        ),
        buildContractCall(
          gnosisSafe,
          "execTransaction",
          [
            multiSendCallOnly.address, // to
            "0", // value
            // eslint-disable-next-line camelcase
            MultiSendCallOnly__factory.createInterface().encodeFunctionData(
              "multiSend",
              [safeInternalTx]
            ), // calldata
            "1", // operation
            "0", // tx gas
            "0", // base gas
            "0", // gas price
            ethers.constants.AddressZero, // gas token
            ethers.constants.AddressZero, // receiver
            sigs, // sigs
          ],
          0,
          false
        ),
      ];
      const safeTx = encodeMultiSend(txs);
      await expect(multiSendCallOnly.multiSend(safeTx))
        .to.emit(gnosisSafe, "EnabledModule")
        .withArgs(azoriusContract.address);
      expect(await gnosisSafe.isModuleEnabled(azoriusContract.address)).to.eq(
        true
      );
    });

    it("Setup Guard w/ changeGuard event", async () => {
      const internalTxs: MetaTransaction[] = [
        buildContractCall(
          gnosisSafe,
          "setGuard",
          [freezeGuard.address],
          0,
          false
        ),
      ];
      const safeInternalTx = encodeMultiSend(internalTxs);
      const txs: MetaTransaction[] = [
        buildContractCall(
          gnosisSafeProxyFactory,
          "createProxyWithNonce",
          [gnosisSafeL2Singleton.address, createGnosisSetupCalldata, saltNum],
          0,
          false
        ),
        buildContractCall(
          moduleProxyFactory,
          "deployModule",
          [fractalModuleSingleton.address, setModuleCalldata, "10031021"],
          0,
          false
        ),
        buildContractCall(
          moduleProxyFactory,
          "deployModule",
          [
            freezeGuardImplementation.address,
            freezeGuardFactoryInit,
            "10031021",
          ],
          0,
          false
        ),
        buildContractCall(
          gnosisSafe,
          "execTransaction",
          [
            multiSendCallOnly.address, // to
            "0", // value
            // eslint-disable-next-line camelcase
            MultiSendCallOnly__factory.createInterface().encodeFunctionData(
              "multiSend",
              [safeInternalTx]
            ), // calldata
            "1", // operation
            "0", // tx gas
            "0", // base gas
            "0", // gas price
            ethers.constants.AddressZero, // gas token
            ethers.constants.AddressZero, // receiver
            sigs, // sigs
          ],
          0,
          false
        ),
      ];
      const safeTx = encodeMultiSend(txs);
      await expect(multiSendCallOnly.multiSend(safeTx))
        .to.emit(gnosisSafe, "ChangedGuard")
        .withArgs(freezeGuard.address);
    });

    it("Setup Gnosis Safe w/ removedOwner event", async () => {
      const internalTxs: MetaTransaction[] = [
        buildContractCall(
          gnosisSafe,
          "removeOwner",
          [owner3.address, multiSendCallOnly.address, threshold],
          0,
          false
        ),
      ];
      const safeInternalTx = encodeMultiSend(internalTxs);
      const txs: MetaTransaction[] = [
        buildContractCall(
          gnosisSafeProxyFactory,
          "createProxyWithNonce",
          [gnosisSafeL2Singleton.address, createGnosisSetupCalldata, saltNum],
          0,
          false
        ),
        buildContractCall(
          moduleProxyFactory,
          "deployModule",
          [fractalModuleSingleton.address, setModuleCalldata, "10031021"],
          0,
          false
        ),
        buildContractCall(
          moduleProxyFactory,
          "deployModule",
          [
            freezeGuardImplementation.address,
            freezeGuardFactoryInit,
            "10031021",
          ],
          0,
          false
        ),
        buildContractCall(
          gnosisSafe,
          "execTransaction",
          [
            multiSendCallOnly.address, // to
            "0", // value
            // eslint-disable-next-line camelcase
            MultiSendCallOnly__factory.createInterface().encodeFunctionData(
              "multiSend",
              [safeInternalTx]
            ), // calldata
            "1", // operation
            "0", // tx gas
            "0", // base gas
            "0", // gas price
            ethers.constants.AddressZero, // gas token
            ethers.constants.AddressZero, // receiver
            sigs, // sigs
          ],
          0,
          false
        ),
      ];
      const safeTx = encodeMultiSend(txs);
      await expect(multiSendCallOnly.multiSend(safeTx))
        .to.emit(gnosisSafe, "RemovedOwner")
        .withArgs(multiSendCallOnly.address);

      expect(await gnosisSafe.isOwner(owner1.address)).eq(true);
      expect(await gnosisSafe.isOwner(owner2.address)).eq(true);
      expect(await gnosisSafe.isOwner(owner3.address)).eq(true);
      expect(await gnosisSafe.isOwner(multiSendCallOnly.address)).eq(false);
      expect(await gnosisSafe.getThreshold()).eq(threshold);
    });
  });
});
