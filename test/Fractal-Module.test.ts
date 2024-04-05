import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import {
  VotesERC20__factory,
  FractalModule,
  FractalModule__factory,
  MultisigFreezeGuard,
  MultisigFreezeGuard__factory,
  ModuleProxyFactory,
  GnosisSafeProxyFactory,
  GnosisSafeL2,
  GnosisSafeL2__factory,
  MultiSendCallOnly__factory,
  MultiSendCallOnly,
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

describe("Fractal Module Tests", () => {
  let gnosisSafeProxyFactory: GnosisSafeProxyFactory;
  let moduleProxyFactory: ModuleProxyFactory;
  let gnosisSafeL2Singleton: GnosisSafeL2;

  // Deployed contracts
  let gnosisSafe: GnosisSafeL2;
  let multiSendCallOnly: MultiSendCallOnly;
  let freezeGuard: MultisigFreezeGuard;
  let moduleImpl: FractalModule;
  let fractalModule: FractalModule;

  // Wallets
  let deployer: SignerWithAddress;
  let owner1: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;

  const abiCoder = new ethers.utils.AbiCoder(); // encode data
  let createGnosisSetupCalldata: string;
  let freezeGuardSetup: string;
  let setModuleCalldata: string;

  const saltNum = BigNumber.from(
    "0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c"
  );

  beforeEach(async () => {
    [deployer, owner1, owner2, owner3] = await ethers.getSigners();

    gnosisSafeProxyFactory = getGnosisSafeProxyFactory();
    moduleProxyFactory = getModuleProxyFactory();
    gnosisSafeL2Singleton = getGnosisSafeL2Singleton();
    multiSendCallOnly = getMultiSendCallOnly();

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
    freezeGuard = await new MultisigFreezeGuard__factory(deployer).deploy();
    freezeGuardSetup =
      // eslint-disable-next-line camelcase
      MultisigFreezeGuard__factory.createInterface().encodeFunctionData(
        "setUp",
        [
          abiCoder.encode(
            ["uint256", "uint256", "address", "address", "address"],
            [10, 10, owner1.address, owner1.address, gnosisSafe.address]
          ),
        ]
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

    const predictedFractalModule = calculateProxyAddress(
      moduleProxyFactory,
      moduleImpl.address,
      setModuleCalldata,
      "10031021"
    );

    fractalModule = await ethers.getContractAt(
      "FractalModule",
      predictedFractalModule
    );
  });

  describe("Fractal Module", () => {
    it("Supports the expected ERC165 interface", async () => {
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
          [moduleImpl.address, setModuleCalldata, "10031021"],
          0,
          false
        ),
      ];
      const safeTx = encodeMultiSend(txs);
      await expect(multiSendCallOnly.multiSend(safeTx))
        .to.emit(gnosisSafeProxyFactory, "ProxyCreation")
        .withArgs(gnosisSafe.address, gnosisSafeL2Singleton.address);
    });

    it("Owner may add/remove controllers", async () => {
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
          [moduleImpl.address, setModuleCalldata, "10031021"],
          0,
          false
        ),
      ];
      const safeTx = encodeMultiSend(txs);
      await multiSendCallOnly.multiSend(safeTx);

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

    it("Authorized users may exec TXs", async () => {
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
      const sigs =
        "0x000000000000000000000000" +
        multiSendCallOnly.address.slice(2) +
        "0000000000000000000000000000000000000000000000000000000000000000" +
        "01";
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
          [moduleImpl.address, setModuleCalldata, "10031021"],
          0,
          false
        ),
        buildContractCall(
          moduleProxyFactory,
          "deployModule",
          [freezeGuard.address, freezeGuardSetup, "10031021"],
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
      await multiSendCallOnly.multiSend(safeTx);

      // FUND SAFE
      const abiCoder = new ethers.utils.AbiCoder(); // encode data

      // Deploy token mastercopy
      const votesERC20Mastercopy = await new VotesERC20__factory(
        deployer
      ).deploy();

      const votesERC20SetupData =
        // eslint-disable-next-line camelcase
        VotesERC20__factory.createInterface().encodeFunctionData("setUp", [
          abiCoder.encode(
            ["string", "string", "address[]", "uint256[]"],
            ["DCNT", "DCNT", [gnosisSafe.address], [1000]]
          ),
        ]);

      await moduleProxyFactory.deployModule(
        votesERC20Mastercopy.address,
        votesERC20SetupData,
        "10031021"
      );

      const predictedVotesERC20Address = calculateProxyAddress(
        moduleProxyFactory,
        votesERC20Mastercopy.address,
        votesERC20SetupData,
        "10031021"
      );

      const votesERC20 = await ethers.getContractAt(
        "VotesERC20",
        predictedVotesERC20Address
      );

      expect(await votesERC20.balanceOf(gnosisSafe.address)).to.eq(1000);
      expect(await votesERC20.balanceOf(owner1.address)).to.eq(0);

      // CLAWBACK FUNDS
      const clawBackCalldata =
        // eslint-disable-next-line camelcase
        VotesERC20__factory.createInterface().encodeFunctionData("transfer", [
          owner1.address,
          500,
        ]);
      const txData =
        // eslint-disable-next-line camelcase
        abiCoder.encode(
          ["address", "uint256", "bytes", "uint8"],
          [votesERC20.address, 0, clawBackCalldata, 0]
        );

      // REVERT => NOT AUTHORIZED
      await expect(fractalModule.execTx(txData)).to.be.revertedWith(
        "Unauthorized()"
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
      ).to.be.revertedWith("TxFailed()");

      expect(await votesERC20.balanceOf(gnosisSafe.address)).to.eq(0);
      expect(await votesERC20.balanceOf(owner1.address)).to.eq(1000);
    });
  });
});
