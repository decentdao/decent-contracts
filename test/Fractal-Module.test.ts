import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, network } from "hardhat";
import {
  VotesERC20__factory,
  FractalModule,
  FractalModule__factory,
  MultisigFreezeGuard,
  MultisigFreezeGuard__factory,
  ModuleProxyFactory,
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
  SAFE_FACTORY_ADDRESS,
  SAFE_SINGLETON_ADDRESS,
} from "./helpers";

describe("Fractal Module Tests", () => {
  // Factories
  let gnosisFactory: Contract;

  // Deployed contracts
  let gnosisSafe: Contract;
  let moduleFactory: Contract;
  let multiSend: Contract;
  let freezeGuard: MultisigFreezeGuard;
  let moduleImpl: FractalModule;
  let fractalModule: FractalModule;
  let moduleProxyFactory: ModuleProxyFactory;

  // Predicted Contracts
  let predictedFractalModule: string;

  // Wallets
  let deployer: SignerWithAddress;
  let owner1: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;

  const abiCoder = new ethers.utils.AbiCoder(); // encode data
  let createGnosisSetupCalldata: string;
  let freezeGuardSetup: string;
  let setModuleCalldata: string;
  let sigs: string;

  const moduleProxyFactoryAddress =
    "0x00000000000DC7F163742Eb4aBEf650037b1f588";
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
    gnosisFactory = new ethers.Contract(SAFE_FACTORY_ADDRESS, abi, deployer); // Gnosis Factory
    moduleFactory = new ethers.Contract(
      "0x00000000000DC7F163742Eb4aBEf650037b1f588",
      // eslint-disable-next-line camelcase
      abiFactory,
      deployer
    );
    // Get module proxy factory
    moduleProxyFactory = await ethers.getContractAt(
      "ModuleProxyFactory",
      moduleProxyFactoryAddress
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
      SAFE_SINGLETON_ADDRESS,
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

  describe("Fractal Module", () => {
    it("Supports the expected ERC165 interface", async () => {
      const txs: MetaTransaction[] = [
        buildContractCall(
          gnosisFactory,
          "createProxyWithNonce",
          [SAFE_SINGLETON_ADDRESS, createGnosisSetupCalldata, saltNum],
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
        .to.emit(gnosisFactory, "ProxyCreation")
        .withArgs(gnosisSafe.address, SAFE_SINGLETON_ADDRESS);
    });

    it("Owner may add/remove controllers", async () => {
      const txs: MetaTransaction[] = [
        buildContractCall(
          gnosisFactory,
          "createProxyWithNonce",
          [SAFE_SINGLETON_ADDRESS, createGnosisSetupCalldata, saltNum],
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
      await multiSend.multiSend(safeTx);

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
      const txs: MetaTransaction[] = [
        buildContractCall(
          gnosisFactory,
          "createProxyWithNonce",
          [SAFE_SINGLETON_ADDRESS, createGnosisSetupCalldata, saltNum],
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
          [freezeGuard.address, freezeGuardSetup, "10031021"],
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
      await multiSend.multiSend(safeTx);

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

      const predictedVotesERC20Address = await calculateProxyAddress(
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
