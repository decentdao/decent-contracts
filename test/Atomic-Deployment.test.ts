import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, network } from "hardhat";
import {
  FractalModule,
  FractalModule__factory,
  MultisigFreezeGuard,
  MultisigFreezeGuard__factory,
} from "../typechain-types";
import {
  ifaceSafe,
  abi,
  abiSafe,
  calculateProxyAddress,
  abiFactory,
  predictGnosisSafeAddress,
  buildContractCall,
  MetaTransaction,
  multisendABI,
  encodeMultiSend,
  ifaceMultiSend,
  azoriusiface,
  abiAzorius,
} from "./helpers";

describe("Atomic Gnosis Safe Deployment", () => {
  // Factories
  let gnosisFactory: Contract;

  // Deployed contracts
  let gnosisSafe: Contract;
  let moduleFactory: Contract;
  let multiSend: Contract;
  let freezeGuard: MultisigFreezeGuard;
  let freezeGuardImplementation: MultisigFreezeGuard;
  let moduleImpl: FractalModule;
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

  const gnosisFactoryAddress = "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2";
  const gnosisSingletonAddress = "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552";
  const threshold = 2;
  let predictedFreezeGuard: string;
  const saltNum = BigNumber.from(
    "0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c"
  );

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    setTimeout(function () {}, 500); // This timeout is to prevent API rate limit errors
    // Fork Goerli to use contracts deployed on Goerli
    await network.provider.request({
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

    [deployer, owner1, owner2, owner3] = await ethers.getSigners();
    multiSend = new ethers.Contract(
      "0x40A2aCCbd92BCA938b02010E17A5b8929b49130D",
      multisendABI,
      deployer
    );
    gnosisFactory = new ethers.Contract(gnosisFactoryAddress, abi, deployer); // Gnosis Factory
    moduleFactory = new ethers.Contract(
      "0x00000000000DC7F163742Eb4aBEf650037b1f588",
      // eslint-disable-next-line camelcase
      abiFactory,
      deployer
    );

    /// ////////////////// GNOSIS //////////////////
    // SETUP GnosisSafe
    createGnosisSetupCalldata = ifaceSafe.encodeFunctionData("setup", [
      [owner1.address, owner2.address, owner3.address, multiSend.address],
      1,
      ethers.constants.AddressZero,
      ethers.constants.HashZero,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      0,
      ethers.constants.AddressZero,
    ]);
    const predictedGnosisSafeAddress = await predictGnosisSafeAddress(
      gnosisFactory.address,
      createGnosisSetupCalldata,
      saltNum,
      gnosisSingletonAddress,
      gnosisFactory
    );

    // Get Gnosis Safe contract
    gnosisSafe = new ethers.Contract(
      predictedGnosisSafeAddress,
      abiSafe,
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

    predictedFreezeGuard = await calculateProxyAddress(
      moduleFactory,
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
    moduleImpl = await new FractalModule__factory(deployer).deploy();

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

    predictedFractalModule = await calculateProxyAddress(
      moduleFactory,
      moduleImpl.address,
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
      multiSend.address.slice(2) +
      "0000000000000000000000000000000000000000000000000000000000000000" +
      "01";
  });

  describe("Atomic Gnosis Safe Deployment", () => {
    it("Setup Fractal Module w/ ModuleProxyCreationEvent", async () => {
      const txs: MetaTransaction[] = [
        buildContractCall(
          gnosisFactory,
          "createProxyWithNonce",
          [gnosisSingletonAddress, createGnosisSetupCalldata, saltNum],
          0,
          false
        ),
        buildContractCall(
          moduleFactory,
          "deployModule",
          [moduleImpl.address, setModuleCalldata, "10031021"],
          0,
          false
        ),
      ];
      const safeTx = encodeMultiSend(txs);
      await expect(multiSend.multiSend(safeTx))
        .to.emit(moduleFactory, "ModuleProxyCreation")
        .withArgs(predictedFractalModule, moduleImpl.address);

      expect(await fractalModule.avatar()).eq(gnosisSafe.address);
      expect(await fractalModule.target()).eq(gnosisSafe.address);
      expect(await fractalModule.owner()).eq(owner1.address);
    });

    it("Setup FreezeGuard w/ ModuleProxyCreationEvent", async () => {
      const txs: MetaTransaction[] = [
        buildContractCall(
          gnosisFactory,
          "createProxyWithNonce",
          [gnosisSingletonAddress, createGnosisSetupCalldata, saltNum],
          0,
          false
        ),
        buildContractCall(
          moduleFactory,
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
      await expect(multiSend.multiSend(safeTx))
        .to.emit(moduleFactory, "ModuleProxyCreation")
        .withArgs(predictedFreezeGuard, freezeGuardImplementation.address);
      expect(await freezeGuard.timelockPeriod()).eq(10);
      expect(await freezeGuard.freezeLock()).eq(owner1.address);
      expect(await freezeGuard.childGnosisSafe()).eq(gnosisSafe.address);
    });

    it("Setup Azorius Module w/ ModuleProxyCreationEvent", async () => {
      const VOTING_STRATEGIES_TO_DEPLOY: string[] = [];
      const encodedInitAzoriusData = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "address[]"],
        [
          gnosisSafe.address,
          gnosisSafe.address,
          gnosisSafe.address,
          VOTING_STRATEGIES_TO_DEPLOY,
        ]
      );
      const encodedSetupAzoriusData = azoriusiface.encodeFunctionData("setUp", [
        encodedInitAzoriusData,
      ]);
      const predictedAzoriusModule = await calculateProxyAddress(
        moduleFactory,
        "0xCdea1582a57Ca4A678070Fa645aaf3a40c2164C1",
        encodedSetupAzoriusData,
        "10031021"
      );

      const azoriusContract = new ethers.Contract(
        predictedAzoriusModule,
        // eslint-disable-next-line camelcase
        abiAzorius,
        deployer
      );

      const txs: MetaTransaction[] = [
        buildContractCall(
          gnosisFactory,
          "createProxyWithNonce",
          [gnosisSingletonAddress, createGnosisSetupCalldata, saltNum],
          0,
          false
        ),
        buildContractCall(
          moduleFactory,
          "deployModule",
          [
            "0xCdea1582a57Ca4A678070Fa645aaf3a40c2164C1",
            encodedSetupAzoriusData,
            "10031021",
          ],
          0,
          false
        ),
      ];
      const safeTx = encodeMultiSend(txs);
      await expect(multiSend.multiSend(safeTx))
        .to.emit(moduleFactory, "ModuleProxyCreation")
        .withArgs(
          predictedAzoriusModule,
          "0xCdea1582a57Ca4A678070Fa645aaf3a40c2164C1"
        );

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
          gnosisFactory,
          "createProxyWithNonce",
          [gnosisSingletonAddress, createGnosisSetupCalldata, saltNum],
          0,
          false
        ),
        buildContractCall(
          moduleFactory,
          "deployModule",
          [moduleImpl.address, setModuleCalldata, "10031021"],
          0,
          false
        ),
        buildContractCall(
          moduleFactory,
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
            multiSend.address, // to
            "0", // value
            // eslint-disable-next-line camelcase
            ifaceMultiSend.encodeFunctionData("multiSend", [safeInternalTx]), // calldata
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
      await expect(multiSend.multiSend(safeTx))
        .to.emit(gnosisSafe, "EnabledModule")
        .withArgs(fractalModule.address);
      expect(await gnosisSafe.isModuleEnabled(fractalModule.address)).to.eq(
        true
      );
    });

    it("Setup AzoriusModule w/ enabledModule event", async () => {
      const VOTING_STRATEGIES_TO_DEPLOY: string[] = []; // @todo pass expected addresses for voting strategies
      const encodedInitAzoriusData = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "address[]"],
        [
          gnosisSafe.address,
          gnosisSafe.address,
          gnosisSafe.address,
          VOTING_STRATEGIES_TO_DEPLOY,
        ]
      );
      const encodedSetupAzoriusData = azoriusiface.encodeFunctionData("setUp", [
        encodedInitAzoriusData,
      ]);
      const predictedAzoriusModule = await calculateProxyAddress(
        moduleFactory,
        "0xCdea1582a57Ca4A678070Fa645aaf3a40c2164C1",
        encodedSetupAzoriusData,
        "10031021"
      );

      const azoriusContract = new ethers.Contract(
        predictedAzoriusModule,
        // eslint-disable-next-line camelcase
        abiAzorius,
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
          gnosisFactory,
          "createProxyWithNonce",
          [gnosisSingletonAddress, createGnosisSetupCalldata, saltNum],
          0,
          false
        ),
        buildContractCall(
          moduleFactory,
          "deployModule",
          [moduleImpl.address, setModuleCalldata, "10031021"],
          0,
          false
        ),
        buildContractCall(
          moduleFactory,
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
          moduleFactory,
          "deployModule",
          [
            "0xCdea1582a57Ca4A678070Fa645aaf3a40c2164C1",
            encodedSetupAzoriusData,
            "10031021",
          ],
          0,
          false
        ),
        buildContractCall(
          gnosisSafe,
          "execTransaction",
          [
            multiSend.address, // to
            "0", // value
            // eslint-disable-next-line camelcase
            ifaceMultiSend.encodeFunctionData("multiSend", [safeInternalTx]), // calldata
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
      await expect(multiSend.multiSend(safeTx))
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
          gnosisFactory,
          "createProxyWithNonce",
          [gnosisSingletonAddress, createGnosisSetupCalldata, saltNum],
          0,
          false
        ),
        buildContractCall(
          moduleFactory,
          "deployModule",
          [moduleImpl.address, setModuleCalldata, "10031021"],
          0,
          false
        ),
        buildContractCall(
          moduleFactory,
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
            multiSend.address, // to
            "0", // value
            // eslint-disable-next-line camelcase
            ifaceMultiSend.encodeFunctionData("multiSend", [safeInternalTx]), // calldata
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
      await expect(multiSend.multiSend(safeTx))
        .to.emit(gnosisSafe, "ChangedGuard")
        .withArgs(freezeGuard.address);
    });

    it("Setup Gnosis Safe w/ removedOwner event", async () => {
      const internalTxs: MetaTransaction[] = [
        buildContractCall(
          gnosisSafe,
          "removeOwner",
          [owner3.address, multiSend.address, threshold],
          0,
          false
        ),
      ];
      const safeInternalTx = encodeMultiSend(internalTxs);
      const txs: MetaTransaction[] = [
        buildContractCall(
          gnosisFactory,
          "createProxyWithNonce",
          [gnosisSingletonAddress, createGnosisSetupCalldata, saltNum],
          0,
          false
        ),
        buildContractCall(
          moduleFactory,
          "deployModule",
          [moduleImpl.address, setModuleCalldata, "10031021"],
          0,
          false
        ),
        buildContractCall(
          moduleFactory,
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
            multiSend.address, // to
            "0", // value
            // eslint-disable-next-line camelcase
            ifaceMultiSend.encodeFunctionData("multiSend", [safeInternalTx]), // calldata
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
      await expect(multiSend.multiSend(safeTx))
        .to.emit(gnosisSafe, "RemovedOwner")
        .withArgs(multiSend.address);

      expect(await gnosisSafe.isOwner(owner1.address)).eq(true);
      expect(await gnosisSafe.isOwner(owner2.address)).eq(true);
      expect(await gnosisSafe.isOwner(owner3.address)).eq(true);
      expect(await gnosisSafe.isOwner(multiSend.address)).eq(false);
      expect(await gnosisSafe.getThreshold()).eq(threshold);
    });
  });
});
