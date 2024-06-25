import {
  GnosisSafeL2,
  GnosisSafeL2__factory,
  DecentHats__factory,
  KeyValuePairs,
  KeyValuePairs__factory,
  MockHats__factory,
} from "../typechain-types";

import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "ethers";
import hre from "hardhat";

import {
  getGnosisSafeL2Singleton,
  getGnosisSafeProxyFactory,
} from "./GlobalSafeDeployments.test";
import {
  buildSafeTransaction,
  buildSignatureBytes,
  predictGnosisSafeAddress,
  safeSignTypedData,
} from "./helpers";

const executeSafeTransaction = async ({
  safe,
  to,
  transactionData,
  signers,
}: {
  safe: GnosisSafeL2;
  to: string;
  transactionData: string;
  signers: SignerWithAddress[];
}) => {
  const safeTx = buildSafeTransaction({
    to,
    data: transactionData,
    nonce: await safe.nonce(),
  });

  const sigs = await Promise.all(
    signers.map(async (signer) => await safeSignTypedData(signer, safe, safeTx))
  );

  const tx = await safe.execTransaction(
    safeTx.to,
    safeTx.value,
    safeTx.data,
    safeTx.operation,
    safeTx.safeTxGas,
    safeTx.baseGas,
    safeTx.gasPrice,
    safeTx.gasToken,
    safeTx.refundReceiver,
    buildSignatureBytes(sigs)
  );

  return tx;
};

describe("DecentHats", () => {
  let dao: SignerWithAddress;

  let keyValuePairs: KeyValuePairs;
  let gnosisSafe: GnosisSafeL2;

  let gnosisSafeAddress: string;
  let decentHatsAddress: string;

  const saltNum = BigInt(
    `0x${Buffer.from(ethers.randomBytes(32)).toString("hex")}`
  );

  beforeEach(async () => {
    const signers = await hre.ethers.getSigners();
    const [deployer] = signers;
    [, dao] = signers;

    const hats = await new MockHats__factory(deployer).deploy();
    keyValuePairs = await new KeyValuePairs__factory(deployer).deploy();
    const decentHats = await new DecentHats__factory(deployer).deploy(
      await hats.getAddress(),
      await keyValuePairs.getAddress()
    );
    decentHatsAddress = await decentHats.getAddress();

    const gnosisSafeProxyFactory = getGnosisSafeProxyFactory();
    const gnosisSafeL2Singleton = getGnosisSafeL2Singleton();
    const gnosisSafeL2SingletonAddress =
      await gnosisSafeL2Singleton.getAddress();

    const createGnosisSetupCalldata =
      GnosisSafeL2__factory.createInterface().encodeFunctionData("setup", [
        [dao.address],
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
      gnosisSafeL2SingletonAddress,
      gnosisSafeProxyFactory
    );
    gnosisSafeAddress = predictedGnosisSafeAddress;

    await gnosisSafeProxyFactory.createProxyWithNonce(
      gnosisSafeL2SingletonAddress,
      createGnosisSetupCalldata,
      saltNum
    );

    gnosisSafe = GnosisSafeL2__factory.connect(
      predictedGnosisSafeAddress,
      deployer
    );
  });

  describe("DecentHats as a Module", () => {
    let enableModuleTx: ethers.ContractTransactionResponse;

    beforeEach(async () => {
      enableModuleTx = await executeSafeTransaction({
        safe: gnosisSafe,
        to: gnosisSafeAddress,
        transactionData:
          GnosisSafeL2__factory.createInterface().encodeFunctionData(
            "enableModule",
            [decentHatsAddress]
          ),
        signers: [dao],
      });
    });

    it("Emits an ExecutionSuccess event", async () => {
      await expect(enableModuleTx).to.emit(gnosisSafe, "ExecutionSuccess");
    });

    it("Emits an EnabledModule event", async () => {
      await expect(enableModuleTx)
        .to.emit(gnosisSafe, "EnabledModule")
        .withArgs(decentHatsAddress);
    });

    describe("Creating a new Top Hat and Tree", () => {
      let createAndDeclareTreeTx: ethers.ContractTransactionResponse;

      beforeEach(async () => {
        createAndDeclareTreeTx = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentHatsAddress,
          transactionData:
            DecentHats__factory.createInterface().encodeFunctionData(
              "createAndDeclareTree",
              [
                "",
                "",
                {
                  eligibility: ethers.ZeroAddress,
                  maxSupply: 1,
                  toggle: ethers.ZeroAddress,
                  details: "",
                  imageURI: "",
                  isMutable: false,
                  wearer: ethers.ZeroAddress,
                },
                [
                  {
                    eligibility: ethers.ZeroAddress,
                    maxSupply: 1,
                    toggle: ethers.ZeroAddress,
                    details: "",
                    imageURI: "",
                    isMutable: false,
                    wearer: ethers.ZeroAddress,
                  },
                  {
                    eligibility: ethers.ZeroAddress,
                    maxSupply: 1,
                    toggle: ethers.ZeroAddress,
                    details: "",
                    imageURI: "",
                    isMutable: false,
                    wearer: ethers.ZeroAddress,
                  },
                ],
              ]
            ),
          signers: [dao],
        });
      });

      it("Emits an ExecutionSuccess event", async () => {
        await expect(createAndDeclareTreeTx).to.emit(
          gnosisSafe,
          "ExecutionSuccess"
        );
      });

      it("Emits an ExecutionFromModuleSuccess event", async () => {
        await expect(createAndDeclareTreeTx)
          .to.emit(gnosisSafe, "ExecutionFromModuleSuccess")
          .withArgs(decentHatsAddress);
      });

      it("Emits some hatsTreeId ValueUpdated events", async () => {
        await expect(createAndDeclareTreeTx)
          .to.emit(keyValuePairs, "ValueUpdated")
          .withArgs(gnosisSafeAddress, "hatsTreeId", "0");
      });

      describe("Multiple calls", () => {
        let createAndDeclareTreeTx2: ethers.ContractTransactionResponse;

        beforeEach(async () => {
          createAndDeclareTreeTx2 = await executeSafeTransaction({
            safe: gnosisSafe,
            to: decentHatsAddress,
            transactionData:
              DecentHats__factory.createInterface().encodeFunctionData(
                "createAndDeclareTree",
                [
                  "",
                  "",
                  {
                    eligibility: ethers.ZeroAddress,
                    maxSupply: 1,
                    toggle: ethers.ZeroAddress,
                    details: "",
                    imageURI: "",
                    isMutable: false,
                    wearer: ethers.ZeroAddress,
                  },
                  [],
                ]
              ),
            signers: [dao],
          });
        });

        it("Emits an ExecutionSuccess event", async () => {
          await expect(createAndDeclareTreeTx2).to.emit(
            gnosisSafe,
            "ExecutionSuccess"
          );
        });

        it("Emits an ExecutionFromModuleSuccess event", async () => {
          await expect(createAndDeclareTreeTx2)
            .to.emit(gnosisSafe, "ExecutionFromModuleSuccess")
            .withArgs(decentHatsAddress);
        });

        it("Creates Top Hats with sequential IDs", async () => {
          await expect(createAndDeclareTreeTx2)
            .to.emit(keyValuePairs, "ValueUpdated")
            .withArgs(gnosisSafeAddress, "hatsTreeId", "4");
        });
      });
    });
  });
});
