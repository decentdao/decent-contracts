/* eslint-disable camelcase */
import {
  GnosisSafeL2,
  GnosisSafeL2__factory,
  DecentHats_0_1_0__factory,
  KeyValuePairs,
  KeyValuePairs__factory,
  MockHats__factory,
  ERC6551Registry__factory,
  MockHatsAccount__factory,
  ERC6551Registry,
  DecentHats_0_1_0,
  MockHatsAccount,
  MockHats,
} from "../typechain-types";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
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
import { solidityKeccak256 } from "ethers/lib/utils";

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

  let mockHats: MockHats;
  let mockHatsAddress: string;

  let keyValuePairs: KeyValuePairs;
  let gnosisSafe: GnosisSafeL2;

  let decentHats: DecentHats_0_1_0;
  let decentHatsAddress: string;

  let gnosisSafeAddress: string;
  let erc6551Registry: ERC6551Registry;

  let mockHatsAccountImplementation: MockHatsAccount;
  let mockHatsAccountImplementationAddress: string;

  beforeEach(async () => {
    const signers = await hre.ethers.getSigners();
    const [deployer] = signers;
    [, dao] = signers;

    mockHats = await new MockHats__factory(deployer).deploy();
    mockHatsAddress = mockHats.address;
    keyValuePairs = await new KeyValuePairs__factory(deployer).deploy();
    erc6551Registry = await new ERC6551Registry__factory(deployer).deploy();
    mockHatsAccountImplementation = await new MockHatsAccount__factory(
      deployer
    ).deploy();
    mockHatsAccountImplementationAddress =
      mockHatsAccountImplementation.address;
    decentHats = await new DecentHats_0_1_0__factory(deployer).deploy();
    decentHatsAddress = decentHats.address;

    const gnosisSafeProxyFactory = getGnosisSafeProxyFactory();
    const gnosisSafeL2Singleton = getGnosisSafeL2Singleton();
    const gnosisSafeL2SingletonAddress = gnosisSafeL2Singleton.address;

    const createGnosisSetupCalldata =
      GnosisSafeL2__factory.createInterface().encodeFunctionData("setup", [
        [dao.address],
        1,
        hre.ethers.constants.AddressZero,
        hre.ethers.constants.HashZero,
        hre.ethers.constants.AddressZero,
        hre.ethers.constants.AddressZero,
        0,
        hre.ethers.constants.AddressZero,
      ]);

    const saltNum = ethers.BigNumber.from(
      `0x${Buffer.from(hre.ethers.utils.randomBytes(32)).toString("hex")}`
    );

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
    let enableModuleTx: ethers.ContractTransaction;

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
      let createAndDeclareTreeTx: ethers.ContractTransaction;

      beforeEach(async () => {
        createAndDeclareTreeTx = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentHatsAddress,
          transactionData:
            DecentHats_0_1_0__factory.createInterface().encodeFunctionData(
              "createAndDeclareTree",
              [
                {
                  hatsProtocol: mockHatsAddress,
                  hatsAccountImplementation:
                    mockHatsAccountImplementationAddress,
                  registry: erc6551Registry.address,
                  keyValuePairs: keyValuePairs.address,
                  topHatDetails: "",
                  topHatImageURI: "",
                  adminHat: {
                    maxSupply: 1,
                    details: "",
                    imageURI: "",
                    isMutable: false,
                    wearer: ethers.constants.AddressZero,
                  },
                  hats: [
                    {
                      maxSupply: 1,
                      details: "",
                      imageURI: "",
                      isMutable: false,
                      wearer: ethers.constants.AddressZero,
                    },
                    {
                      maxSupply: 1,
                      details: "",
                      imageURI: "",
                      isMutable: false,
                      wearer: ethers.constants.AddressZero,
                    },
                  ],
                },
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
          .withArgs(gnosisSafeAddress, "topHatId", "0");
      });

      describe("Multiple calls", () => {
        let createAndDeclareTreeTx2: ethers.ContractTransaction;

        beforeEach(async () => {
          createAndDeclareTreeTx2 = await executeSafeTransaction({
            safe: gnosisSafe,
            to: decentHatsAddress,
            transactionData:
              DecentHats_0_1_0__factory.createInterface().encodeFunctionData(
                "createAndDeclareTree",
                [
                  {
                    hatsProtocol: mockHatsAddress,
                    hatsAccountImplementation:
                      mockHatsAccountImplementationAddress,
                    registry: erc6551Registry.address,
                    keyValuePairs: keyValuePairs.address,
                    topHatDetails: "",
                    topHatImageURI: "",
                    adminHat: {
                      maxSupply: 1,
                      details: "",
                      imageURI: "",
                      isMutable: false,
                      wearer: ethers.constants.AddressZero,
                    },
                    hats: [],
                  },
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
            .withArgs(gnosisSafeAddress, "topHatId", "4");
        });
      });

      describe("Creating Hats Accounts", () => {
        let salt: string;

        beforeEach(async () => {
          salt = solidityKeccak256(
            ["string", "uint256", "address"],
            ["DecentHats_0_1_0", await hre.getChainId(), decentHatsAddress]
          );
        });

        const getHatAccount = async (hatId: bigint) => {
          const hatAccountAddress = await erc6551Registry.account(
            mockHatsAccountImplementationAddress,
            salt,
            await hre.getChainId(),
            mockHatsAddress,
            hatId
          );

          const hatAccount = MockHatsAccount__factory.connect(
            hatAccountAddress,
            hre.ethers.provider
          );

          return hatAccount;
        };

        it("Generates the correct Addresses for the current Hats", async () => {
          const currentCount = await mockHats.count();

          for (
            let i = ethers.BigNumber.from(0);
            i.lt(currentCount);
            i = i.add(1)
          ) {
            const foo = BigInt(i.toString());
            const topHatAccount = await getHatAccount(foo);
            expect(await topHatAccount.tokenId()).eq(i);
            expect(await topHatAccount.tokenImplementation()).eq(
              mockHatsAddress
            );
          }
        });
      });
    });
  });
});
