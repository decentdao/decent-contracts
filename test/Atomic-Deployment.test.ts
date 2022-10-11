import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, network } from "hardhat";
import { VetoGuard, VetoGuard__factory } from "../typechain-types";
import { CallbackGnosis } from "../typechain-types/contracts/CallbackGnosis";
import { CallbackGnosis__factory } from "../typechain-types/factories/contracts/CallbackGnosis__factory";

import {
  ifaceSafe,
  abi,
  abiSafe,
  predictGnosisSafeCallbackAddress,
  ifaceFactory,
  calculateProxyAddress,
  abiFactory,
} from "./helpers";

describe("Gnosis Safe", () => {
  // Factories
  let gnosisFactory: Contract;

  // Deployed contracts
  let gnosisSafe: Contract;
  let moduleFactory: Contract;
  let vetoGuard: VetoGuard;
  let vetoImpl: VetoGuard;
  let callback: CallbackGnosis;

  // Wallets
  let deployer: SignerWithAddress;
  let owner1: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;

  const abiCoder = new ethers.utils.AbiCoder(); // encode data
  const gnosisFactoryAddress = "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2";
  const gnosisSingletonAddress = "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552";
  const threshold = 2;
  let predictedVetoGuard: string;
  let bytecode: string;
  const saltNum = BigNumber.from(
    "0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c"
  );

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    setTimeout(function () {}, 100); // This timeout is to prevent API rate limit errors
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

    // DEPLOY GUARD
    vetoImpl = await new VetoGuard__factory(deployer).deploy(); // Veto Impl
    const vetoGuardFactoryInit =
      // eslint-disable-next-line camelcase
      VetoGuard__factory.createInterface().encodeFunctionData(
        "vetoERC20Voting"
      );

    predictedVetoGuard = await calculateProxyAddress(
      moduleFactory,
      vetoImpl.address,
      vetoGuardFactoryInit,
      "10031021"
    );

    vetoGuard = await ethers.getContractAt("VetoGuard", predictedVetoGuard);

    const moduleData = ifaceFactory.encodeFunctionData("deployModule", [
      vetoImpl.address,
      vetoGuardFactoryInit,
      "10031021",
    ]);

    // SET GUARD
    const setGuardCalldata = ifaceSafe.encodeFunctionData("setGuard", [
      predictedVetoGuard,
    ]);

    // REMOVE OWNER
    const removeCalldata = ifaceSafe.encodeFunctionData("removeOwner", [
      owner3.address,
      callback.address,
      threshold,
    ]);

    // INIT GUARD
    const initParams = abiCoder.encode(
      ["uint256", "address", "address", "address"],
      [10, owner1.address, owner1.address, ethers.constants.AddressZero]
    );

    const initGuard = vetoGuard.interface.encodeFunctionData("setUp", [
      initParams,
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
            ethers.constants.AddressZero, // setGuard Gnosis
            ethers.constants.AddressZero, // remove owner + threshold
            vetoGuard.address, // setup Guard
          ],
        ],
        [
          [createGnosisCalldata, moduleData],
          [setGuardCalldata, removeCalldata, initGuard],
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

  describe("Atomic Gnosis Safe Deployment", () => {
    it("Setup VetoGuard w/ ModuleProxyCreationEvent", async () => {
      await expect(
        gnosisFactory.createProxyWithCallback(
          gnosisSingletonAddress,
          bytecode,
          saltNum,
          callback.address
        )
      )
        .to.emit(moduleFactory, "ModuleProxyCreation")
        .withArgs(predictedVetoGuard, vetoImpl.address);
      expect(await vetoGuard.executionDelayBlocks()).eq(10);
      expect(await vetoGuard.vetoERC20Voting()).eq(owner1.address);
      expect(await vetoGuard.gnosisSafe()).eq(gnosisSafe.address);
    });

    it("Setup Guard w/ changeGuard event", async () => {
      await expect(
        gnosisFactory.createProxyWithCallback(
          gnosisSingletonAddress,
          bytecode,
          saltNum,
          callback.address
        )
      )
        .to.emit(gnosisSafe, "ChangedGuard")
        .withArgs(vetoGuard.address);
    });

    it("Setup Gnosis Safe w/ removedOwner event", async () => {
      await expect(
        gnosisFactory.createProxyWithCallback(
          gnosisSingletonAddress,
          bytecode,
          saltNum,
          callback.address
        )
      )
        .to.emit(gnosisSafe, "RemovedOwner")
        .withArgs(callback.address);
      expect(await gnosisSafe.isOwner(owner1.address)).eq(true);
      expect(await gnosisSafe.isOwner(owner2.address)).eq(true);
      expect(await gnosisSafe.isOwner(owner3.address)).eq(true);
      expect(await gnosisSafe.isOwner(callback.address)).eq(false);
      expect(await gnosisSafe.getThreshold()).eq(threshold);
    });

    it("Tx Fails w/ incorrect txCall", async () => {
      const badData = ifaceSafe.encodeFunctionData("setup", [
        [ethers.constants.AddressZero],
        1,
        ethers.constants.AddressZero,
        ethers.constants.HashZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        0,
        ethers.constants.AddressZero,
      ]);
      const sigs =
        "0x000000000000000000000000" +
        callback.address.slice(2) +
        "0000000000000000000000000000000000000000000000000000000000000000" +
        "01";

      const txdata = abiCoder.encode(
        ["address[][]", "bytes[][]", "bool[]"],
        [
          [
            [ethers.constants.AddressZero], // SetupGnosis + Deploy Guard
          ],
          [[badData]],
          [false, true],
        ]
      );
      bytecode = abiCoder.encode(["bytes", "bytes"], [txdata, sigs]);
      await expect(
        gnosisFactory.createProxyWithCallback(
          gnosisSingletonAddress,
          bytecode,
          saltNum,
          callback.address
        )
      ).to.be.revertedWith("CB001");
    });

    it("Tx Fails w/ incorrect GnosisTxCall", async () => {
      const badData = ifaceSafe.encodeFunctionData("setup", [
        [ethers.constants.AddressZero],
        1,
        ethers.constants.AddressZero,
        ethers.constants.HashZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        0,
        ethers.constants.AddressZero,
      ]);
      const sigs =
        "0x000000000000000000000000" +
        callback.address.slice(2) +
        "0000000000000000000000000000000000000000000000000000000000000000" +
        "01";

      const txdata = abiCoder.encode(
        ["address[][]", "bytes[][]", "bool[]"],
        [
          [
            [ethers.constants.AddressZero], // SetupGnosis + Deploy Guard
          ],
          [[badData]],
          [true],
        ]
      );
      bytecode = abiCoder.encode(["bytes", "bytes"], [txdata, sigs]);
      await expect(
        gnosisFactory.createProxyWithCallback(
          gnosisSingletonAddress,
          bytecode,
          saltNum,
          callback.address
        )
      ).to.be.revertedWith("CB000");
    });
  });
});
