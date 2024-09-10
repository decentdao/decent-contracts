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
  MockSablierV2LockupLinear__factory,
  MockSablierV2LockupLinear,
} from "../typechain-types";

import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, solidityPackedKeccak256 } from "ethers";
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

describe("DecentHats_0_1_0", () => {
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

  let mockSablier: MockSablierV2LockupLinear;
  let mockSablierAddress: string;

  beforeEach(async () => {
    const signers = await hre.ethers.getSigners();
    const [deployer] = signers;
    [, dao] = signers;

    mockHats = await new MockHats__factory(deployer).deploy();
    mockHatsAddress = await mockHats.getAddress();
    keyValuePairs = await new KeyValuePairs__factory(deployer).deploy();
    erc6551Registry = await new ERC6551Registry__factory(deployer).deploy();
    mockHatsAccountImplementation = await new MockHatsAccount__factory(
      deployer
    ).deploy();
    mockHatsAccountImplementationAddress =
      await mockHatsAccountImplementation.getAddress();
    decentHats = await new DecentHats_0_1_0__factory(deployer).deploy();
    decentHatsAddress = await decentHats.getAddress();

    const gnosisSafeProxyFactory = getGnosisSafeProxyFactory();
    const gnosisSafeL2Singleton = getGnosisSafeL2Singleton();
    const gnosisSafeL2SingletonAddress =
      await gnosisSafeL2Singleton.getAddress();

    const createGnosisSetupCalldata =
      GnosisSafeL2__factory.createInterface().encodeFunctionData("setup", [
        [dao.address],
        1,
        hre.ethers.ZeroAddress,
        hre.ethers.ZeroHash,
        hre.ethers.ZeroAddress,
        hre.ethers.ZeroAddress,
        0,
        hre.ethers.ZeroAddress,
      ]);

    const saltNum = BigInt(
      `0x${Buffer.from(hre.ethers.randomBytes(32)).toString("hex")}`
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

    // Deploy MockSablierV2LockupLinear
    mockSablier = await new MockSablierV2LockupLinear__factory(
      deployer
    ).deploy();
    mockSablierAddress = await mockSablier.getAddress();
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
            DecentHats_0_1_0__factory.createInterface().encodeFunctionData(
              "createAndDeclareTree",
              [
                {
                  hatsProtocol: mockHatsAddress,
                  hatsAccountImplementation:
                    mockHatsAccountImplementationAddress,
                  registry: await erc6551Registry.getAddress(),
                  keyValuePairs: await keyValuePairs.getAddress(),
                  topHatDetails: "",
                  topHatImageURI: "",
                  adminHat: {
                    maxSupply: 1,
                    details: "",
                    imageURI: "",
                    isMutable: false,
                    wearer: ethers.ZeroAddress,
                    sablierParams: {
                      sablier: ethers.ZeroAddress,
                      sender: ethers.ZeroAddress,
                      totalAmount: 0,
                      asset: ethers.ZeroAddress,
                      cancelable: false,
                      transferable: false,
                      durations: {
                        cliff: 0,
                        total: 0,
                      },
                      broker: {
                        account: ethers.ZeroAddress,
                        fee: 0,
                      },
                    },
                  },
                  hats: [
                    {
                      maxSupply: 1,
                      details: "",
                      imageURI: "",
                      isMutable: false,
                      wearer: ethers.ZeroAddress,
                      sablierParams: {
                        sablier: ethers.ZeroAddress,
                        sender: ethers.ZeroAddress,
                        totalAmount: 0,
                        asset: ethers.ZeroAddress,
                        cancelable: false,
                        transferable: false,
                        durations: {
                          cliff: 0,
                          total: 0,
                        },
                        broker: {
                          account: ethers.ZeroAddress,
                          fee: 0,
                        },
                      },
                    },
                    {
                      maxSupply: 1,
                      details: "",
                      imageURI: "",
                      isMutable: false,
                      wearer: ethers.ZeroAddress,
                      sablierParams: {
                        sablier: ethers.ZeroAddress,
                        sender: ethers.ZeroAddress,
                        totalAmount: 0,
                        asset: ethers.ZeroAddress,
                        cancelable: false,
                        transferable: false,
                        durations: {
                          cliff: 0,
                          total: 0,
                        },
                        broker: {
                          account: ethers.ZeroAddress,
                          fee: 0,
                        },
                      },
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
        let createAndDeclareTreeTx2: ethers.ContractTransactionResponse;

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
                    registry: await erc6551Registry.getAddress(),
                    keyValuePairs: await keyValuePairs.getAddress(),
                    topHatDetails: "",
                    topHatImageURI: "",
                    adminHat: {
                      maxSupply: 1,
                      details: "",
                      imageURI: "",
                      isMutable: false,
                      wearer: ethers.ZeroAddress,
                      sablierParams: {
                        sablier: ethers.ZeroAddress,
                        sender: ethers.ZeroAddress,
                        totalAmount: 0,
                        asset: ethers.ZeroAddress,
                        cancelable: false,
                        transferable: false,
                        durations: {
                          cliff: 0,
                          total: 0,
                        },
                        broker: {
                          account: ethers.ZeroAddress,
                          fee: 0,
                        },
                      },
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
          salt = solidityPackedKeccak256(
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

          for (let i = 0n; i < currentCount; i++) {
            const topHatAccount = await getHatAccount(i);
            expect(await topHatAccount.tokenId()).eq(i);
            expect(await topHatAccount.tokenImplementation()).eq(
              mockHatsAddress
            );
          }
        });
      });
    });

    describe("Creating a new Top Hat and Tree with Sablier Streams", () => {
      let createAndDeclareTreeTx: ethers.ContractTransactionResponse;

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
                  registry: await erc6551Registry.getAddress(),
                  keyValuePairs: await keyValuePairs.getAddress(),
                  topHatDetails: "",
                  topHatImageURI: "",
                  adminHat: {
                    maxSupply: 1,
                    details: "",
                    imageURI: "",
                    isMutable: false,
                    wearer: ethers.ZeroAddress,
                    sablierParams: {
                      sablier: ethers.ZeroAddress,
                      sender: ethers.ZeroAddress,
                      totalAmount: 0,
                      asset: ethers.ZeroAddress,
                      cancelable: false,
                      transferable: false,
                      durations: { cliff: 0, total: 0 },
                      broker: { account: ethers.ZeroAddress, fee: 0 },
                    },
                  },
                  hats: [
                    {
                      maxSupply: 1,
                      details: "",
                      imageURI: "",
                      isMutable: false,
                      wearer: ethers.ZeroAddress,
                      sablierParams: {
                        sablier: mockSablierAddress,
                        sender: gnosisSafeAddress,
                        totalAmount: ethers.parseEther("100"),
                        asset: ethers.ZeroAddress, // Use a mock ERC20 token address in a real scenario
                        cancelable: true,
                        transferable: false,
                        durations: { cliff: 86400, total: 2592000 }, // 1 day cliff, 30 days total
                        broker: { account: ethers.ZeroAddress, fee: 0 },
                      },
                    },
                    {
                      maxSupply: 1,
                      details: "",
                      imageURI: "",
                      isMutable: false,
                      wearer: ethers.ZeroAddress,
                      sablierParams: {
                        sablier: ethers.ZeroAddress,
                        sender: ethers.ZeroAddress,
                        totalAmount: 0,
                        asset: ethers.ZeroAddress,
                        cancelable: false,
                        transferable: false,
                        durations: { cliff: 0, total: 0 },
                        broker: { account: ethers.ZeroAddress, fee: 0 },
                      },
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

      it("Creates a Sablier stream for the hat with stream parameters", async () => {
        const streamCreatedEvents = await mockSablier.queryFilter(
          mockSablier.filters.StreamCreated()
        );
        expect(streamCreatedEvents.length).to.equal(1);

        const event = streamCreatedEvents[0];
        expect(event.args.sender).to.equal(gnosisSafeAddress);
        expect(event.args.recipient).to.not.equal(ethers.ZeroAddress);
        expect(event.args.totalAmount).to.equal(ethers.parseEther("100"));
      });

      it("Does not create a Sablier stream for hats without stream parameters", async () => {
        const streamCreatedEvents = await mockSablier.queryFilter(
          mockSablier.filters.StreamCreated()
        );
        expect(streamCreatedEvents.length).to.equal(1); // Only one stream should be created
      });
    });
  });
});
