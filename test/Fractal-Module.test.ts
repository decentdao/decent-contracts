import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "ethers";
import hre from "hardhat";
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

  const abiCoder = new ethers.AbiCoder(); // encode data
  let createGnosisSetupCalldata: string;
  let freezeGuardSetup: string;
  let setModuleCalldata: string;

  const saltNum = BigInt(
    "0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c"
  );

  beforeEach(async () => {
    [deployer, owner1, owner2, owner3] = await hre.ethers.getSigners();

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
          await multiSendCallOnly.getAddress(),
        ],
        1,
        ethers.ZeroAddress,
        ethers.ZeroHash,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        0,
        ethers.ZeroAddress,
      ]);
    const predictedGnosisSafeAddress = await predictGnosisSafeAddress(
      createGnosisSetupCalldata,
      saltNum,
      await gnosisSafeL2Singleton.getAddress(),
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
            [
              10,
              10,
              owner1.address,
              owner1.address,
              await gnosisSafe.getAddress(),
            ]
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
            await gnosisSafe.getAddress(),
            await gnosisSafe.getAddress(),
            [owner2.address],
          ]
        ),
      ]);

    const predictedFractalModule = await calculateProxyAddress(
      moduleProxyFactory,
      await moduleImpl.getAddress(),
      setModuleCalldata,
      "10031021"
    );

    fractalModule = await hre.ethers.getContractAt(
      "FractalModule",
      predictedFractalModule
    );
  });

  describe("Fractal Module", () => {
    it("Supports the expected ERC165 interface", async () => {
      const txs: MetaTransaction[] = [
        await buildContractCall(
          gnosisSafeProxyFactory,
          "createProxyWithNonce",
          [
            await gnosisSafeL2Singleton.getAddress(),
            createGnosisSetupCalldata,
            saltNum,
          ],
          0,
          false
        ),
        await buildContractCall(
          moduleProxyFactory,
          "deployModule",
          [await moduleImpl.getAddress(), setModuleCalldata, "10031021"],
          0,
          false
        ),
      ];
      const safeTx = encodeMultiSend(txs);
      await expect(multiSendCallOnly.multiSend(safeTx))
        .to.emit(gnosisSafeProxyFactory, "ProxyCreation")
        .withArgs(
          await gnosisSafe.getAddress(),
          await gnosisSafeL2Singleton.getAddress()
        );
    });

    it("Owner may add/remove controllers", async () => {
      const txs: MetaTransaction[] = [
        await buildContractCall(
          gnosisSafeProxyFactory,
          "createProxyWithNonce",
          [
            await gnosisSafeL2Singleton.getAddress(),
            createGnosisSetupCalldata,
            saltNum,
          ],
          0,
          false
        ),
        await buildContractCall(
          moduleProxyFactory,
          "deployModule",
          [await moduleImpl.getAddress(), setModuleCalldata, "10031021"],
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
        await buildContractCall(
          gnosisSafe,
          "enableModule",
          [await fractalModule.getAddress()],
          0,
          false
        ),
      ];
      const safeInternalTx = encodeMultiSend(internalTxs);
      const sigs =
        "0x000000000000000000000000" +
        (await multiSendCallOnly.getAddress()).slice(2) +
        "0000000000000000000000000000000000000000000000000000000000000000" +
        "01";
      const txs: MetaTransaction[] = [
        await buildContractCall(
          gnosisSafeProxyFactory,
          "createProxyWithNonce",
          [
            await gnosisSafeL2Singleton.getAddress(),
            createGnosisSetupCalldata,
            saltNum,
          ],
          0,
          false
        ),
        await buildContractCall(
          moduleProxyFactory,
          "deployModule",
          [await moduleImpl.getAddress(), setModuleCalldata, "10031021"],
          0,
          false
        ),
        await buildContractCall(
          moduleProxyFactory,
          "deployModule",
          [await freezeGuard.getAddress(), freezeGuardSetup, "10031021"],
          0,
          false
        ),
        await buildContractCall(
          gnosisSafe,
          "execTransaction",
          [
            await multiSendCallOnly.getAddress(), // to
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
            ethers.ZeroAddress, // gas token
            ethers.ZeroAddress, // receiver
            sigs, // sigs
          ],
          0,
          false
        ),
      ];
      const safeTx = encodeMultiSend(txs);
      await multiSendCallOnly.multiSend(safeTx);

      // FUND SAFE
      const abiCoder = new ethers.AbiCoder(); // encode data

      // Deploy token mastercopy
      const votesERC20Mastercopy = await new VotesERC20__factory(
        deployer
      ).deploy();

      const votesERC20SetupData =
        // eslint-disable-next-line camelcase
        VotesERC20__factory.createInterface().encodeFunctionData("setUp", [
          abiCoder.encode(
            ["string", "string", "address[]", "uint256[]"],
            ["DCNT", "DCNT", [await gnosisSafe.getAddress()], [1000]]
          ),
        ]);

      await moduleProxyFactory.deployModule(
        await votesERC20Mastercopy.getAddress(),
        votesERC20SetupData,
        "10031021"
      );

      const predictedVotesERC20Address = await calculateProxyAddress(
        moduleProxyFactory,
        await votesERC20Mastercopy.getAddress(),
        votesERC20SetupData,
        "10031021"
      );

      const votesERC20 = await hre.ethers.getContractAt(
        "VotesERC20",
        predictedVotesERC20Address
      );

      expect(await votesERC20.balanceOf(await gnosisSafe.getAddress())).to.eq(
        1000
      );
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
          [await votesERC20.getAddress(), 0, clawBackCalldata, 0]
        );

      // REVERT => NOT AUTHORIZED
      await expect(fractalModule.execTx(txData)).to.be.revertedWithCustomError(
        fractalModule,
        "Unauthorized"
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
      ).to.be.revertedWithCustomError(fractalModule, "TxFailed");

      expect(await votesERC20.balanceOf(await gnosisSafe.getAddress())).to.eq(
        0
      );
      expect(await votesERC20.balanceOf(owner1.address)).to.eq(1000);
    });
  });
});
