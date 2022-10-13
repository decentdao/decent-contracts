import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, network } from "hardhat";
import {
  FractalModule,
  IFractalModule__factory,
  VotesToken__factory,
} from "../typechain-types";
import { CallbackGnosis } from "../typechain-types/contracts/CallbackGnosis";
import { CallbackGnosis__factory } from "../typechain-types/factories/contracts/CallbackGnosis__factory";
import { FractalModule__factory } from "../typechain-types/factories/contracts/FractalModule__factory";
import getInterfaceSelector from "./getInterfaceSelector";

import {
  ifaceSafe,
  abi,
  abiSafe,
  predictGnosisSafeCallbackAddress,
  ifaceFactory,
  calculateProxyAddress,
  abiFactory,
} from "./helpers";

describe("Fractal-Module Integration", () => {
  // Factories
  let gnosisFactory: Contract;

  // Deployed contracts
  let gnosisSafe: Contract;
  let moduleFactory: Contract;
  let moduleImpl: FractalModule;
  let fractalModule: FractalModule;
  let callback: CallbackGnosis;

  // Wallets
  let deployer: SignerWithAddress;
  let owner1: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;

  // Predicted Contracts
  let predictedFractalModule: string;

  // Encode Data
  const abiCoder = new ethers.utils.AbiCoder();

  // Reused Vars
  let bytecode: string;
  const gnosisFactoryAddress = "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2";
  const gnosisSingletonAddress = "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552";
  const threshold = 2;
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

    gnosisFactory = new ethers.Contract(gnosisFactoryAddress, abi, deployer); // Gnosis Factory
    moduleFactory = new ethers.Contract(
      "0x00000000000DC7F163742Eb4aBEf650037b1f588",
      // eslint-disable-next-line camelcase
      abiFactory,
      deployer
    );

    callback = await new CallbackGnosis__factory(deployer).deploy(); // Gnosis Callback

    // Setup GNOSIS
    const createGnosisCalldata = ifaceSafe.encodeFunctionData("setup", [
      [owner1.address, owner2.address, owner3.address, callback.address],
      1,
      ethers.constants.AddressZero,
      ethers.constants.HashZero,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      0,
      ethers.constants.AddressZero,
    ]);

    // DEPLOY Module
    moduleImpl = await new FractalModule__factory(deployer).deploy();
    const fractalModuleInit =
      // eslint-disable-next-line camelcase
      FractalModule__factory.createInterface().encodeFunctionData("avatar");

    predictedFractalModule = await calculateProxyAddress(
      moduleFactory,
      moduleImpl.address,
      fractalModuleInit,
      "10031021"
    );

    fractalModule = await ethers.getContractAt(
      "FractalModule",
      predictedFractalModule
    );

    const moduleData = ifaceFactory.encodeFunctionData("deployModule", [
      moduleImpl.address,
      fractalModuleInit,
      "10031021",
    ]);

    // SETUP Module
    const setModuleCalldata =
      // eslint-disable-next-line camelcase
      FractalModule__factory.createInterface().encodeFunctionData("setUp", [
        abiCoder.encode(
          ["address", "address", "address", "address[]"],
          [
            owner1.address,
            ethers.constants.AddressZero,
            ethers.constants.AddressZero,
            [owner2.address],
          ]
        ),
      ]);

    // ADD Module To Safe
    const enableModuleCalldata = ifaceSafe.encodeFunctionData("enableModule", [
      fractalModule.address,
    ]);

    // REMOVE OWNER
    const removeCalldata = ifaceSafe.encodeFunctionData("removeOwner", [
      owner3.address,
      callback.address,
      threshold,
    ]);

    // TX Array
    const sigs =
      "0x000000000000000000000000" +
      callback.address.slice(2) +
      "0000000000000000000000000000000000000000000000000000000000000000" +
      "01";

    const txdata = abiCoder.encode(
      ["address[][]", "bytes[][]", "bool[]"],
      [
        [
          [ethers.constants.AddressZero, moduleFactory.address], // SetupGnosis + Deploy Guard
          [
            fractalModule.address, // setup Module
            ethers.constants.AddressZero, // enable Module GS
            ethers.constants.AddressZero, // remove owner + threshold
          ],
        ],
        [
          [createGnosisCalldata, moduleData],
          [setModuleCalldata, enableModuleCalldata, removeCalldata],
        ],
        [false, true],
      ]
    );
    bytecode = abiCoder.encode(["bytes", "bytes"], [txdata, sigs]);

    // Predidct Gnosis Safe
    const predictedGnosisSafeAddress = await predictGnosisSafeCallbackAddress(
      gnosisFactory.address,
      bytecode,
      saltNum,
      callback.address,
      gnosisSingletonAddress,
      gnosisFactory
    );

    // Get Gnosis Safe contract
    gnosisSafe = new ethers.Contract(
      predictedGnosisSafeAddress,
      abiSafe,
      deployer
    );
  });

  describe("Fractal Module", () => {
    it("Setup Fractal Module w/ ModuleProxyCreationEvent", async () => {
      await expect(
        gnosisFactory.createProxyWithCallback(
          gnosisSingletonAddress,
          bytecode,
          saltNum,
          callback.address
        )
      )
        .to.emit(moduleFactory, "ModuleProxyCreation")
        .withArgs(predictedFractalModule, moduleImpl.address);
      expect(await fractalModule.owner()).eq(owner1.address);
      expect(await fractalModule.target()).eq(gnosisSafe.address);
      expect(await fractalModule.avatar()).eq(gnosisSafe.address);
      expect(await fractalModule.controllers(owner2.address)).eq(true);
      expect(await fractalModule.controllers(owner3.address)).eq(false);
    });

    it("Supports the expected ERC165 interface", async () => {
      await gnosisFactory.createProxyWithCallback(
        gnosisSingletonAddress,
        bytecode,
        saltNum,
        callback.address
      );
      // Supports Fractal Module
      expect(
        await fractalModule.supportsInterface(
          // eslint-disable-next-line camelcase
          getInterfaceSelector(IFractalModule__factory.createInterface())
        )
      ).to.eq(true);
    });

    it("Setup Module w/ enabledModule event", async () => {
      await expect(
        gnosisFactory.createProxyWithCallback(
          gnosisSingletonAddress,
          bytecode,
          saltNum,
          callback.address
        )
      )
        .to.emit(gnosisSafe, "EnabledModule")
        .withArgs(fractalModule.address);
    });

    it("Owner may add/remove controllers", async () => {
      await gnosisFactory.createProxyWithCallback(
        gnosisSingletonAddress,
        bytecode,
        saltNum,
        callback.address
      );
      // ADD Controller
      await expect(
        fractalModule.connect(owner3).addControllers([owner3.address])
      ).to.revertedWith("Ownable: caller is not the owner");
      expect(await fractalModule.controllers(owner3.address)).eq(false);
      await expect(
        fractalModule.connect(owner1).addControllers([owner3.address])
      ).to.emit(fractalModule, "ControllersAdded");
      expect(await fractalModule.controllers(owner3.address)).eq(true);

      // REMOVE Controller
      await expect(
        fractalModule.connect(owner3).removeControllers([owner3.address])
      ).to.revertedWith("Ownable: caller is not the owner");
      expect(await fractalModule.controllers(owner3.address)).eq(true);
      await expect(
        fractalModule.connect(owner1).removeControllers([owner3.address])
      ).to.emit(fractalModule, "ControllersRemoved");
      expect(await fractalModule.controllers(owner3.address)).eq(false);
    });

    it("Authorized users may exec txs => GS", async () => {
      await gnosisFactory.createProxyWithCallback(
        gnosisSingletonAddress,
        bytecode,
        saltNum,
        callback.address
      );
      // FUND SAFE

      const abiCoder = new ethers.utils.AbiCoder(); // encode data
      const votesTokenSetupData = abiCoder.encode(
        ["string", "string", "address[]", "uint256[]"],
        ["DCNT", "DCNT", [gnosisSafe.address], [1000]]
      );
      const votesToken = await new VotesToken__factory(deployer).deploy();
      await votesToken.setUp(votesTokenSetupData);
      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(1000);
      expect(await votesToken.balanceOf(owner1.address)).to.eq(0);

      // CLAWBACK FUNDS
      const clawBackCalldata =
        // eslint-disable-next-line camelcase
        VotesToken__factory.createInterface().encodeFunctionData("transfer", [
          owner1.address,
          500,
        ]);
      const txData =
        // eslint-disable-next-line camelcase
        abiCoder.encode(
          ["address", "uint256", "bytes", "uint8"],
          [votesToken.address, 0, clawBackCalldata, 0]
        );

      // REVERT => NOT AUTHORIZED
      await expect(fractalModule.execTx(txData)).to.be.revertedWith(
        "Not Authorized"
      );

      // OWNER MAY EXECUTE
      await expect(fractalModule.connect(owner1).execTx(txData)).to.emit(
        gnosisSafe,
        "ExecutionFromModuleSuccess"
      );

      // Controller MAY EXECUTE
      await expect(fractalModule.connect(owner2).execTx(txData)).to.emit(
        gnosisSafe,
        "ExecutionFromModuleSuccess"
      );

      // REVERT => Execution Failure
      await expect(
        fractalModule.connect(owner1).execTx(txData)
      ).to.be.revertedWith("Module transaction failed");

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(0);
      expect(await votesToken.balanceOf(owner1.address)).to.eq(1000);
    });
  });
});
