import {
  DecentHats_0_1_0,
  DecentHats_0_1_0__factory,
  DecentSablierStreamManagement,
  DecentSablierStreamManagement__factory,
  ERC6551Registry,
  ERC6551Registry__factory,
  GnosisSafeL2,
  GnosisSafeL2__factory,
  KeyValuePairs__factory,
  MockERC20,
  MockERC20__factory,
  MockHats,
  MockHats__factory,
  MockHatsAccount,
  MockHatsAccount__factory,
  MockSablierV2LockupLinear,
  MockSablierV2LockupLinear__factory,
} from "../typechain-types";

import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "ethers";
import hre from "hardhat";

import { executeSafeTransaction, getHatAccount, predictGnosisSafeAddress } from "./helpers";

import { getGnosisSafeProxyFactory, getGnosisSafeL2Singleton } from "./GlobalSafeDeployments.test";

describe.only("DecentSablierStreamManagement", () => {
  let dao: SignerWithAddress;
  let gnosisSafe: GnosisSafeL2;

  let mockHats: MockHats;
  let mockHatsAddress: string;

  let decentHats: DecentHats_0_1_0;
  let decentHatsAddress: string;

  let decentSablierManagement: DecentSablierStreamManagement;
  let decentSablierManagementAddress: string;

  let mockHatsAccountImplementation: MockHatsAccount;
  let mockHatsAccountImplementationAddress: string;

  let mockERC20: MockERC20;
  let mockERC20Address: string;

  let gnosisSafeAddress: string;

  let mockSablier: MockSablierV2LockupLinear;
  let mockSablierAddress: string;

  let erc6551Registry: ERC6551Registry;

  let currentBlockTimestamp: number;

  let streamId: ethers.BigNumberish;

  let enableModuleTx: ethers.ContractTransactionResponse;
  let createAndDeclareTreeWithRolesAndStreamsTx: ethers.ContractTransactionResponse;

  beforeEach(async () => {
    const signers = await hre.ethers.getSigners();
    const [deployer] = signers;
    [, dao] = signers;

    decentSablierManagement = await new DecentSablierStreamManagement__factory(deployer).deploy();
    decentSablierManagementAddress = await decentSablierManagement.getAddress();

    mockHatsAccountImplementation = await new MockHatsAccount__factory(deployer).deploy();
    mockHatsAccountImplementationAddress = await mockHatsAccountImplementation.getAddress();

    decentHats = await new DecentHats_0_1_0__factory(deployer).deploy();
    decentHatsAddress = await decentHats.getAddress();

    const gnosisSafeProxyFactory = getGnosisSafeProxyFactory();
    const gnosisSafeL2Singleton = getGnosisSafeL2Singleton();
    const gnosisSafeL2SingletonAddress = await gnosisSafeL2Singleton.getAddress();

    const createGnosisSetupCalldata = GnosisSafeL2__factory.createInterface().encodeFunctionData("setup", [
      [dao.address],
      1,
      hre.ethers.ZeroAddress,
      hre.ethers.ZeroHash,
      hre.ethers.ZeroAddress,
      hre.ethers.ZeroAddress,
      0,
      hre.ethers.ZeroAddress,
    ]);

    const saltNum = BigInt(`0x${Buffer.from(hre.ethers.randomBytes(32)).toString("hex")}`);

    const predictedGnosisSafeAddress = await predictGnosisSafeAddress(
      createGnosisSetupCalldata,
      saltNum,
      gnosisSafeL2SingletonAddress,
      gnosisSafeProxyFactory
    );
    gnosisSafeAddress = predictedGnosisSafeAddress;

    await gnosisSafeProxyFactory.createProxyWithNonce(gnosisSafeL2SingletonAddress, createGnosisSetupCalldata, saltNum);

    gnosisSafe = GnosisSafeL2__factory.connect(predictedGnosisSafeAddress, deployer);

    // Deploy MockSablierV2LockupLinear
    mockSablier = await new MockSablierV2LockupLinear__factory(deployer).deploy();
    mockSablierAddress = await mockSablier.getAddress();

    mockERC20 = await new MockERC20__factory(deployer).deploy("MockERC20", "MCK");
    mockERC20Address = await mockERC20.getAddress();

    await mockERC20.mint(gnosisSafeAddress, ethers.parseEther("1000000"));

    // Set up the Safe with roles and streams
    await executeSafeTransaction({
      safe: gnosisSafe,
      to: gnosisSafeAddress,
      transactionData: GnosisSafeL2__factory.createInterface().encodeFunctionData("enableModule", [decentHatsAddress]),
      signers: [dao],
    });

    currentBlockTimestamp = (await hre.ethers.provider.getBlock("latest"))!.timestamp;

    mockHats = await new MockHats__factory(deployer).deploy();
    mockHatsAddress = await mockHats.getAddress();
    let keyValuePairs = await new KeyValuePairs__factory(deployer).deploy();
    erc6551Registry = await new ERC6551Registry__factory(deployer).deploy();

    createAndDeclareTreeWithRolesAndStreamsTx = await executeSafeTransaction({
      safe: gnosisSafe,
      to: decentHatsAddress,
      transactionData: DecentHats_0_1_0__factory.createInterface().encodeFunctionData("createAndDeclareTree", [
        {
          hatsProtocol: mockHatsAddress,
          hatsAccountImplementation: mockHatsAccountImplementationAddress,
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
            sablierParams: [],
          },
          hats: [
            {
              maxSupply: 1,
              details: "",
              imageURI: "",
              isMutable: false,
              wearer: dao.address,
              sablierParams: [
                {
                  sablier: mockSablierAddress,
                  sender: gnosisSafeAddress,
                  totalAmount: ethers.parseEther("100"),
                  asset: mockERC20Address,
                  cancelable: true,
                  transferable: false,
                  timestamps: {
                    start: currentBlockTimestamp,
                    cliff: 0,
                    end: currentBlockTimestamp + 2592000, // 30 days from now
                  },
                  broker: { account: ethers.ZeroAddress, fee: 0 },
                },
              ],
            },
          ],
        },
      ]),
      signers: [dao],
    });

    await expect(createAndDeclareTreeWithRolesAndStreamsTx).to.emit(gnosisSafe, "ExecutionSuccess");
    await expect(createAndDeclareTreeWithRolesAndStreamsTx).to.emit(gnosisSafe, "ExecutionFromModuleSuccess");

    const streamCreatedEvents = await mockSablier.queryFilter(mockSablier.filters.StreamCreated());
    expect(streamCreatedEvents.length).to.equal(1);

    streamId = streamCreatedEvents[0].args.streamId;

    // Enable the module
    enableModuleTx = await executeSafeTransaction({
      safe: gnosisSafe,
      to: gnosisSafeAddress,
      transactionData: GnosisSafeL2__factory.createInterface().encodeFunctionData("enableModule", [
        decentSablierManagementAddress,
      ]),
      signers: [dao],
    });
  });

  describe("Enabled as a Module", () => {
    it("Emits an ExecutionSuccess event", async () => {
      await expect(enableModuleTx).to.emit(gnosisSafe, "ExecutionSuccess");
    });

    it("Emits an EnabledModule event", async () => {
      await expect(enableModuleTx).to.emit(gnosisSafe, "EnabledModule").withArgs(decentSablierManagementAddress);
    });
  });

  describe("Withdrawing From Stream", () => {
    let withdrawTx: ethers.ContractTransactionResponse;

    describe("When the stream has funds", () => {
      beforeEach(async () => {
        // No action has been taken yet on the stream. Balance should be untouched.
        expect(await mockSablier.withdrawableAmountOf(streamId)).to.not.eq(0);

        // Advance time to the end of the stream
        await hre.ethers.provider.send("evm_setNextBlockTimestamp", [currentBlockTimestamp + 2592000]);
        await hre.ethers.provider.send("evm_mine", []);

        const recipientHatAccount = await getHatAccount(
          2n,
          erc6551Registry,
          mockHatsAccountImplementationAddress,
          mockHatsAddress,
          decentHatsAddress
        );

        withdrawTx = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentSablierManagementAddress,
          transactionData: DecentSablierStreamManagement__factory.createInterface().encodeFunctionData(
            "withdrawMaxFromStream",
            [mockSablierAddress, streamId, await recipientHatAccount.getAddress()]
          ),
          signers: [dao],
        });

        await hre.ethers.provider.send("evm_setNextBlockTimestamp", [currentBlockTimestamp + 2692000]);
        await hre.ethers.provider.send("evm_mine", []);
      });

      it("Emits an ExecutionSuccess event", async () => {
        await expect(withdrawTx).to.emit(gnosisSafe, "ExecutionSuccess");
      });

      it("Emits an ExecutionFromModuleSuccess event", async () => {
        await expect(withdrawTx)
          .to.emit(gnosisSafe, "ExecutionFromModuleSuccess")
          .withArgs(decentSablierManagementAddress);
      });

      it("Withdraws the maximum amount from the stream", async () => {
        expect(await mockSablier.withdrawableAmountOf(streamId)).to.equal(0);
      });
    });

    describe("When the stream has no funds", () => {
      beforeEach(async () => {
        // Advance time to the end of the stream
        await hre.ethers.provider.send("evm_setNextBlockTimestamp", [currentBlockTimestamp + 2592000]);
        await hre.ethers.provider.send("evm_mine", []);

        const recipientHatAccount = await getHatAccount(
          2n,
          erc6551Registry,
          mockHatsAccountImplementationAddress,
          mockHatsAddress,
          decentHatsAddress
        );

        // The recipient withdraws the full amount
        await MockSablierV2LockupLinear__factory.connect(mockSablierAddress, dao).withdrawMax(
          streamId,
          await recipientHatAccount.getAddress()
        );
        expect(await mockSablier.withdrawableAmountOf(streamId)).to.equal(0);

        withdrawTx = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentSablierManagementAddress,
          transactionData: DecentSablierStreamManagement__factory.createInterface().encodeFunctionData(
            "withdrawMaxFromStream",
            [mockSablierAddress, streamId, await recipientHatAccount.getAddress()]
          ),
          signers: [dao],
        });
      });

      it("Emits an ExecutionSuccess event", async () => {
        await expect(withdrawTx).to.emit(gnosisSafe, "ExecutionSuccess");
      });

      it("Does not emit an ExecutionFromModuleSuccess event", async () => {
        await expect(withdrawTx).to.not.emit(gnosisSafe, "ExecutionFromModuleSuccess");
      });

      it("Does not revert", async () => {
        expect(withdrawTx).to.not.reverted;
      });
    });
  });

  describe("Cancelling From Stream", () => {
    let cancelTx: ethers.ContractTransactionResponse;

    describe("When the stream is active", () => {
      beforeEach(async () => {
        // Advance time to before the end of the stream
        await hre.ethers.provider.send("evm_setNextBlockTimestamp", [currentBlockTimestamp + 60000]); // 1 minute from now
        await hre.ethers.provider.send("evm_mine", []);

        cancelTx = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentSablierManagementAddress,
          transactionData: DecentSablierStreamManagement__factory.createInterface().encodeFunctionData("cancelStream", [
            mockSablierAddress,
            streamId,
          ]),
          signers: [dao],
        });
      });

      it("Emits an ExecutionSuccess event", async () => {
        await expect(cancelTx).to.emit(gnosisSafe, "ExecutionSuccess");
      });

      it("Emits an ExecutionFromModuleSuccess event", async () => {
        await expect(cancelTx)
          .to.emit(gnosisSafe, "ExecutionFromModuleSuccess")
          .withArgs(decentSablierManagementAddress);
      });

      it("Cancels the stream", async () => {
        expect((await mockSablier.getStream(streamId)).cancelable).to.equal(false);
      });
    });

    describe("When the stream has expired", () => {
      beforeEach(async () => {
        // Advance time to the end of the stream
        await hre.ethers.provider.send("evm_setNextBlockTimestamp", [currentBlockTimestamp + 2592000 + 60000]); // 30 days from now + 1 minute
        await hre.ethers.provider.send("evm_mine", []);

        cancelTx = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentSablierManagementAddress,
          transactionData: DecentSablierStreamManagement__factory.createInterface().encodeFunctionData("cancelStream", [
            mockSablierAddress,
            streamId,
          ]),
          signers: [dao],
        });
      });

      it("Emits an ExecutionSuccess event", async () => {
        await expect(cancelTx).to.emit(gnosisSafe, "ExecutionSuccess");
      });

      it("Does not emit an ExecutionFromModuleSuccess event", async () => {
        await expect(cancelTx).to.not.emit(gnosisSafe, "ExecutionFromModuleSuccess");
      });

      it("Does not revert", async () => {
        expect(cancelTx).to.not.reverted;
      });
    });

    describe("When the stream has been previously cancelled", () => {
      beforeEach(async () => {
        // Advance time to before the end of the stream
        await hre.ethers.provider.send("evm_setNextBlockTimestamp", [currentBlockTimestamp + 120000]); // 2 minutes from now
        await hre.ethers.provider.send("evm_mine", []);

        const stream = await mockSablier.getStream(streamId);
        expect(stream.endTime).to.be.greaterThan(currentBlockTimestamp);

        // The safe cancels the stream
        await executeSafeTransaction({
          safe: gnosisSafe,
          to: mockSablierAddress,
          transactionData: MockSablierV2LockupLinear__factory.createInterface().encodeFunctionData("cancel", [
            streamId,
          ]),
          signers: [dao],
        });

        await hre.ethers.provider.send("evm_setNextBlockTimestamp", [currentBlockTimestamp + 240000]); // 4 minutes from now
        await hre.ethers.provider.send("evm_mine", []);

        cancelTx = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentSablierManagementAddress,
          transactionData: DecentSablierStreamManagement__factory.createInterface().encodeFunctionData("cancelStream", [
            mockSablierAddress,
            streamId,
          ]),
          signers: [dao],
        });
      });

      it("Emits an ExecutionSuccess event", async () => {
        await expect(cancelTx).to.emit(gnosisSafe, "ExecutionSuccess");
      });

      it("Does not emit an ExecutionFromModuleSuccess event", async () => {
        await expect(cancelTx).to.not.emit(gnosisSafe, "ExecutionFromModuleSuccess");
      });

      it("Does not revert", async () => {
        expect(cancelTx).to.not.reverted;
      });
    });
  });
});
