import {
  GnosisSafeL2,
  GnosisSafeL2__factory,
  DecentSablier_0_1_0__factory,
  DecentSablier_0_1_0,
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

import { MockSablier__factory } from "../typechain-types";

async function executeSafeTransaction({
  safe,
  to,
  value,
  data,
  operation,
  signers,
}: {
  safe: GnosisSafeL2;
  to: string;
  value?: bigint;
  data?: string;
  operation?: number;
  signers: SignerWithAddress[];
}) {
  const safeTransactionData = {
    to,
    value: value || 0n,
    data: data || "0x",
    operation: operation || 0,
    // Add the missing 'nonce' property
    nonce: await safe.nonce(),
  };
  const safeTransaction = await buildSafeTransaction(safeTransactionData);
  const senderSignature = await safeSignTypedData(
    signers[0],
    safe,
    safeTransaction
  );
  const signatureBytes = buildSignatureBytes([senderSignature]);
  // Change 'executeTransaction' to 'execTransaction'
  return safe.execTransaction(safeTransaction, signatureBytes);
}

describe("DecentSablier", () => {
  let dao: SignerWithAddress;
  let gnosisSafe: GnosisSafeL2;
  let decentSablier: DecentSablier_0_1_0;
  let decentSablierAddress: string;
  let gnosisSafeAddress: string;

  let mockSablier: MockSablier;

  beforeEach(async () => {
    // ... (setup code similar to DecentHats.test.ts)
    // Deploy MockSablier
    const MockSablier = await ethers.getContractFactory("MockSablier");
    mockSablier = await MockSablier.deploy();
    await mockSablier.deployed();
  });

  describe("DecentSablier as a Module", () => {
    let enableModuleTx: ethers.ContractTransactionResponse;

    beforeEach(async () => {
      // ... (enable module code similar to DecentHats.test.ts)
    });

    it("Emits an ExecutionSuccess event", async () => {
      await expect(enableModuleTx).to.emit(gnosisSafe, "ExecutionSuccess");
    });

    it("Emits an EnabledModule event", async () => {
      await expect(enableModuleTx)
        .to.emit(gnosisSafe, "EnabledModule")
        .withArgs(decentSablierAddress);
    });

    describe("Processing Sablier Streams", () => {
      let processSablierStreamsTx: ethers.ContractTransactionResponse;

      beforeEach(async () => {
        // Set up mock stream balances
        await mockSablier.setStreamBalance(1, ethers.utils.parseEther("100"));
        await mockSablier.setStreamBalance(2, ethers.utils.parseEther("200"));
        await mockSablier.setStreamBalance(3, ethers.utils.parseEther("300"));

        processSablierStreamsTx = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentSablierAddress,
          data: DecentSablier_0_1_0__factory.createInterface().encodeFunctionData(
            "processSablierStreams",
            [
              mockSablier.address,
              [{ streamId: 1 }, { streamId: 2 }, { streamId: 3 }],
            ]
          ),
          signers: [dao],
        });
      });

      it("Emits an ExecutionSuccess event", async () => {
        await expect(processSablierStreamsTx).to.emit(
          gnosisSafe,
          "ExecutionSuccess"
        );
      });

      it("Emits an ExecutionFromModuleSuccess event", async () => {
        await expect(processSablierStreamsTx)
          .to.emit(gnosisSafe, "ExecutionFromModuleSuccess")
          .withArgs(decentSablierAddress);
      });

      it("Withdraws from streams correctly", async () => {
        expect(await mockSablier.getWithdrawnAmount(1)).to.equal(
          ethers.utils.parseEther("100")
        );
        expect(await mockSablier.getWithdrawnAmount(2)).to.equal(
          ethers.utils.parseEther("200")
        );
        expect(await mockSablier.getWithdrawnAmount(3)).to.equal(
          ethers.utils.parseEther("300")
        );
      });
    });
  });
});
