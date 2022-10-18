import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, network } from "hardhat";

import {
  VotesToken,
  VotesToken__factory,
  VetoERC20Voting,
  VetoERC20Voting__factory,
  VetoGuard,
  VetoGuard__factory,
} from "../typechain-types";

import {
  buildSignatureBytes,
  buildSafeTransaction,
  safeSignTypedData,
  ifaceSafe,
  abi,
  predictGnosisSafeAddress,
  abiSafe,
} from "./helpers";

describe("Gnosis Safe", () => {
  // Factories
  let gnosisFactory: Contract;

  // Deployed contracts
  let gnosisSafe: Contract;
  let vetoGuard: VetoGuard;
  let vetoERC20Voting: VetoERC20Voting;
  let votesToken: VotesToken;

  // Wallets
  let deployer: SignerWithAddress;
  let owner1: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;
  let tokenVetoer1: SignerWithAddress;
  let tokenVetoer2: SignerWithAddress;
  let vetoGuardOwner: SignerWithAddress;

  // Gnosis
  let createGnosisSetupCalldata: string;

  const gnosisFactoryAddress = "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2";
  const gnosisSingletonAddress = "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552";
  const threshold = 2;
  const saltNum = BigNumber.from(
    "0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c"
  );

  beforeEach(async () => {
    // Fork Goerli to use contracts deployed on Goerli
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.GOERLI_PROVIDER
              ? process.env.GOERLI_PROVIDER
              : "",
            blockNumber: 7387621,
          },
        },
      ],
    });

    [
      deployer,
      owner1,
      owner2,
      owner3,
      tokenVetoer1,
      tokenVetoer2,
      vetoGuardOwner,
    ] = await ethers.getSigners();

    // Get deployed Gnosis Safe
    gnosisFactory = new ethers.Contract(gnosisFactoryAddress, abi, deployer);

    createGnosisSetupCalldata = ifaceSafe.encodeFunctionData("setup", [
      [owner1.address, owner2.address, owner3.address],
      threshold,
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
      gnosisSingletonAddress,
      gnosisFactory
    );

    // Deploy Gnosis Safe
    await gnosisFactory.createProxyWithNonce(
      gnosisSingletonAddress,
      createGnosisSetupCalldata,
      saltNum
    );

    // Get Gnosis Safe contract
    gnosisSafe = new ethers.Contract(
      predictedGnosisSafeAddress,
      abiSafe,
      deployer
    );

    // Deploy token, allocate supply to two token vetoers and Gnosis Safe
    votesToken = await new VotesToken__factory(deployer).deploy();

    const abiCoder = new ethers.utils.AbiCoder(); // encode data
    const votesTokenSetupData = abiCoder.encode(
      ["string", "string", "address[]", "uint256[]"],
      [
        "DCNT",
        "DCNT",
        [tokenVetoer1.address, tokenVetoer2.address, gnosisSafe.address],
        [500, 600, 1000],
      ]
    );

    await votesToken.setUp(votesTokenSetupData);

    // Vetoers delegate their votes to themselves
    await votesToken.connect(tokenVetoer1).delegate(tokenVetoer1.address);
    await votesToken.connect(tokenVetoer2).delegate(tokenVetoer2.address);

    // Deploy VetoERC20Voting contract
    vetoERC20Voting = await new VetoERC20Voting__factory(deployer).deploy();

    // Deploy VetoGuard contract with a 10 block delay between queuing and execution
    const vetoGuardSetupData = abiCoder.encode(
      ["uint256", "address", "address", "address"],
      [10, vetoGuardOwner.address, vetoERC20Voting.address, gnosisSafe.address]
    );
    vetoGuard = await new VetoGuard__factory(deployer).deploy();
    await vetoGuard.setUp(vetoGuardSetupData);

    // Initialize VetoERC20Voting contract
    const vetoERC20VotingSetupData = abiCoder.encode(
      [
        "address",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
        "address",
        "address",
      ],
      [
        vetoGuardOwner.address,
        1000, // veto votes threshold
        1090, // freeze votes threshold
        10, // proposal block length
        100, // freeze duration
        votesToken.address,
        vetoGuard.address,
      ]
    );
    await vetoERC20Voting.setUp(vetoERC20VotingSetupData);

    // Create transaction to set the guard address
    const setGuardData = gnosisSafe.interface.encodeFunctionData("setGuard", [
      vetoGuard.address,
    ]);

    const tx = buildSafeTransaction({
      to: gnosisSafe.address,
      data: setGuardData,
      safeTxGas: 1000000,
      nonce: await gnosisSafe.nonce(),
    });
    const sigs = [
      await safeSignTypedData(owner1, gnosisSafe, tx),
      await safeSignTypedData(owner2, gnosisSafe, tx),
    ];
    const signatureBytes = buildSignatureBytes(sigs);

    // Execute transaction that adds the veto guard to the Safe
    await expect(
      gnosisSafe.execTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatureBytes
      )
    ).to.emit(gnosisSafe, "ExecutionSuccess");

    // Gnosis Safe received the 1,000 tokens
    expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(1000);
  });

  describe("VetoGuard Functionality", () => {
    it("Supports ERC-165", async () => {
      // Supports IVetoGuard interface
      expect(await vetoGuard.supportsInterface("0xfac0f7cd")).to.eq(true);

      // Supports IGuard interface
      expect(await vetoGuard.supportsInterface("0xe6d7a83a")).to.eq(true);

      // Supports IERC-165 interface
      expect(await vetoGuard.supportsInterface("0x01ffc9a7")).to.eq(true);

      // Doesn't support random interface
      expect(await vetoGuard.supportsInterface("0x00000000")).to.eq(false);
    });

    it("A transaction can be queued and executed", async () => {
      // Create transaction to set the guard address
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx = buildSafeTransaction({
        to: votesToken.address,
        data: tokenTransferData,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs = [
        await safeSignTypedData(owner1, gnosisSafe, tx),
        await safeSignTypedData(owner2, gnosisSafe, tx),
      ];
      const signatureBytes = buildSignatureBytes(sigs);

      await vetoGuard.queueTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatureBytes
      );

      // Mine blocks to surpass the execution delay
      for (let i = 0; i < 9; i++) {
        await network.provider.send("evm_mine");
      }

      await gnosisSafe.execTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatureBytes
      );

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(0);
      expect(await votesToken.balanceOf(deployer.address)).to.eq(1000);
    });

    it("A transaction cannot be executed if it hasn't yet been queued", async () => {
      // Create transaction to set the guard address
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx = buildSafeTransaction({
        to: votesToken.address,
        data: tokenTransferData,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs = [
        await safeSignTypedData(owner1, gnosisSafe, tx),
        await safeSignTypedData(owner2, gnosisSafe, tx),
      ];
      const signatureBytes = buildSignatureBytes(sigs);

      await expect(
        gnosisSafe.execTransaction(
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
          tx.safeTxGas,
          tx.baseGas,
          tx.gasPrice,
          tx.gasToken,
          tx.refundReceiver,
          signatureBytes
        )
      ).to.be.revertedWith("Transaction has not been queued yet");
    });

    it("A transaction cannot be queued if the signatures aren't valid", async () => {
      // Create transaction to set the guard address
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx = buildSafeTransaction({
        to: votesToken.address,
        data: tokenTransferData,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      // Only 1 signer signs, while the threshold is 2
      const sigs = [await safeSignTypedData(owner1, gnosisSafe, tx)];
      const signatureBytes = buildSignatureBytes(sigs);

      await expect(
        vetoGuard.queueTransaction(
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
          tx.safeTxGas,
          tx.baseGas,
          tx.gasPrice,
          tx.gasToken,
          tx.refundReceiver,
          signatureBytes
        )
      ).to.be.revertedWith("GS020");
    });

    it("A transaction cannot be executed if the delay period has not been reached yet", async () => {
      // Create transaction to set the guard address
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx = buildSafeTransaction({
        to: votesToken.address,
        data: tokenTransferData,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs = [
        await safeSignTypedData(owner1, gnosisSafe, tx),
        await safeSignTypedData(owner2, gnosisSafe, tx),
      ];
      const signatureBytes = buildSignatureBytes(sigs);

      await vetoGuard.queueTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatureBytes
      );

      await expect(
        gnosisSafe.execTransaction(
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
          tx.safeTxGas,
          tx.baseGas,
          tx.gasPrice,
          tx.gasToken,
          tx.refundReceiver,
          signatureBytes
        )
      ).to.be.revertedWith("Transaction delay period has not completed yet");
    });

    it("A transaction can be executed if it has received some veto votes, but not above the threshold", async () => {
      // Create transaction to set the guard address
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx = buildSafeTransaction({
        to: votesToken.address,
        data: tokenTransferData,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs = [
        await safeSignTypedData(owner1, gnosisSafe, tx),
        await safeSignTypedData(owner2, gnosisSafe, tx),
      ];
      const signatureBytes = buildSignatureBytes(sigs);

      await vetoGuard.queueTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatureBytes
      );

      const txHash = await vetoERC20Voting.getTransactionHash(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver
      );

      // Vetoer 1 casts 500 veto votes
      await vetoERC20Voting.connect(tokenVetoer1).castVetoVote(txHash, false);

      // 500 veto votes have been cast
      expect(
        await vetoERC20Voting.getVetoVotes(
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
          tx.safeTxGas,
          tx.baseGas,
          tx.gasPrice,
          tx.gasToken,
          tx.refundReceiver
        )
      ).to.eq(500);

      expect(
        await vetoERC20Voting.getIsVetoed(
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
          tx.safeTxGas,
          tx.baseGas,
          tx.gasPrice,
          tx.gasToken,
          tx.refundReceiver
        )
      ).to.eq(false);

      // Mine blocks to surpass the execution delay
      for (let i = 0; i < 9; i++) {
        await network.provider.send("evm_mine");
      }

      await gnosisSafe.execTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatureBytes
      );

      expect(await votesToken.balanceOf(deployer.address)).to.eq(1000);
      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(0);
    });

    it("A transaction cannot be executed if it has received more veto votes than the threshold", async () => {
      // Create transaction to set the guard address
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx = buildSafeTransaction({
        to: votesToken.address,
        data: tokenTransferData,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs = [
        await safeSignTypedData(owner1, gnosisSafe, tx),
        await safeSignTypedData(owner2, gnosisSafe, tx),
      ];
      const signatureBytes = buildSignatureBytes(sigs);

      await vetoGuard.queueTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatureBytes
      );

      const txHash = await vetoERC20Voting.getTransactionHash(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver
      );

      // Vetoer 1 casts 500 veto votes
      await vetoERC20Voting.connect(tokenVetoer1).castVetoVote(txHash, false);

      // Vetoer 2 casts 600 veto votes
      await vetoERC20Voting.connect(tokenVetoer2).castVetoVote(txHash, false);

      // 1100 veto votes have been cast
      expect(
        await vetoERC20Voting.getVetoVotes(
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
          tx.safeTxGas,
          tx.baseGas,
          tx.gasPrice,
          tx.gasToken,
          tx.refundReceiver
        )
      ).to.eq(1100);

      expect(
        await vetoERC20Voting.getIsVetoed(
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
          tx.safeTxGas,
          tx.baseGas,
          tx.gasPrice,
          tx.gasToken,
          tx.refundReceiver
        )
      ).to.eq(true);

      // Mine blocks to surpass the execution delay
      for (let i = 0; i < 9; i++) {
        await network.provider.send("evm_mine");
      }

      await expect(
        gnosisSafe.execTransaction(
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
          tx.safeTxGas,
          tx.baseGas,
          tx.gasPrice,
          tx.gasToken,
          tx.refundReceiver,
          signatureBytes
        )
      ).to.be.revertedWith("Transaction has been vetoed");
    });

    it("A vetoed transaction does not prevent another transaction from being executed", async () => {
      // Create transaction to set the guard address
      const tokenTransferData1 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tokenTransferData2 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 999]
      );

      const tx1 = buildSafeTransaction({
        to: votesToken.address,
        data: tokenTransferData1,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const tx2 = buildSafeTransaction({
        to: votesToken.address,
        data: tokenTransferData2,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs1 = [
        await safeSignTypedData(owner1, gnosisSafe, tx1),
        await safeSignTypedData(owner2, gnosisSafe, tx1),
      ];
      const signatureBytes1 = buildSignatureBytes(sigs1);

      const sigs2 = [
        await safeSignTypedData(owner1, gnosisSafe, tx2),
        await safeSignTypedData(owner2, gnosisSafe, tx2),
      ];
      const signatureBytes2 = buildSignatureBytes(sigs2);

      await vetoGuard.queueTransaction(
        tx1.to,
        tx1.value,
        tx1.data,
        tx1.operation,
        tx1.safeTxGas,
        tx1.baseGas,
        tx1.gasPrice,
        tx1.gasToken,
        tx1.refundReceiver,
        signatureBytes1
      );

      const txHash1 = await vetoERC20Voting.getTransactionHash(
        tx1.to,
        tx1.value,
        tx1.data,
        tx1.operation,
        tx1.safeTxGas,
        tx1.baseGas,
        tx1.gasPrice,
        tx1.gasToken,
        tx1.refundReceiver
      );

      // Vetoer 1 casts 500 veto votes
      await vetoERC20Voting.connect(tokenVetoer1).castVetoVote(txHash1, false);

      // Vetoer 2 casts 600 veto votes
      await vetoERC20Voting.connect(tokenVetoer2).castVetoVote(txHash1, false);

      // 1100 veto votes have been cast
      expect(
        await vetoERC20Voting.getVetoVotes(
          tx1.to,
          tx1.value,
          tx1.data,
          tx1.operation,
          tx1.safeTxGas,
          tx1.baseGas,
          tx1.gasPrice,
          tx1.gasToken,
          tx1.refundReceiver
        )
      ).to.eq(1100);

      expect(
        await vetoERC20Voting.getIsVetoed(
          tx1.to,
          tx1.value,
          tx1.data,
          tx1.operation,
          tx1.safeTxGas,
          tx1.baseGas,
          tx1.gasPrice,
          tx1.gasToken,
          tx1.refundReceiver
        )
      ).to.eq(true);

      // Mine blocks to surpass the execution delay
      for (let i = 0; i < 9; i++) {
        await network.provider.send("evm_mine");
      }

      await expect(
        gnosisSafe.execTransaction(
          tx1.to,
          tx1.value,
          tx1.data,
          tx1.operation,
          tx1.safeTxGas,
          tx1.baseGas,
          tx1.gasPrice,
          tx1.gasToken,
          tx1.refundReceiver,
          signatureBytes1
        )
      ).to.be.revertedWith("Transaction has been vetoed");

      // Tx1 has been vetoed, now try to queue and execute tx2
      await vetoGuard.queueTransaction(
        tx2.to,
        tx2.value,
        tx2.data,
        tx2.operation,
        tx2.safeTxGas,
        tx2.baseGas,
        tx2.gasPrice,
        tx2.gasToken,
        tx2.refundReceiver,
        signatureBytes2
      );

      // Mine blocks to surpass the execution delay
      for (let i = 0; i < 9; i++) {
        await network.provider.send("evm_mine");
      }

      await gnosisSafe.execTransaction(
        tx2.to,
        tx2.value,
        tx2.data,
        tx2.operation,
        tx2.safeTxGas,
        tx2.baseGas,
        tx2.gasPrice,
        tx2.gasToken,
        tx2.refundReceiver,
        signatureBytes2
      );

      expect(await votesToken.balanceOf(deployer.address)).to.eq(999);
      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(1);
    });

    it("A vetoer cannot cast veto votes more than once", async () => {
      // Create transaction to set the guard address
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx = buildSafeTransaction({
        to: votesToken.address,
        data: tokenTransferData,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs = [
        await safeSignTypedData(owner1, gnosisSafe, tx),
        await safeSignTypedData(owner2, gnosisSafe, tx),
      ];
      const signatureBytes = buildSignatureBytes(sigs);

      await vetoGuard.queueTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatureBytes
      );

      const txHash = await vetoERC20Voting.getTransactionHash(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver
      );

      // Vetoer 1 casts 500 veto votes
      await vetoERC20Voting.connect(tokenVetoer1).castVetoVote(txHash, false);

      await expect(
        vetoERC20Voting.connect(tokenVetoer1).castVetoVote(txHash, false)
      ).to.be.revertedWith("User has already voted");
    });

    it("A veto vote cannot be cast if the transaction has not been queued yet", async () => {
      // Create transaction to set the guard address
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx = buildSafeTransaction({
        to: votesToken.address,
        data: tokenTransferData,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const txHash = await vetoERC20Voting.getTransactionHash(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver
      );

      await expect(
        vetoERC20Voting.connect(tokenVetoer1).castVetoVote(txHash, false)
      ).to.be.revertedWith("Transaction has not yet been queued");
    });
  });

  describe("Frozen Functionality", () => {
    it("A frozen DAO cannot execute any transactions", async () => {
      // Create transaction to set the guard address
      const tokenTransferData1 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tokenTransferData2 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 999]
      );

      const tx1 = buildSafeTransaction({
        to: votesToken.address,
        data: tokenTransferData1,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const tx2 = buildSafeTransaction({
        to: votesToken.address,
        data: tokenTransferData2,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs1 = [
        await safeSignTypedData(owner1, gnosisSafe, tx1),
        await safeSignTypedData(owner2, gnosisSafe, tx1),
      ];
      const signatureBytes1 = buildSignatureBytes(sigs1);

      const sigs2 = [
        await safeSignTypedData(owner1, gnosisSafe, tx2),
        await safeSignTypedData(owner2, gnosisSafe, tx2),
      ];
      const signatureBytes2 = buildSignatureBytes(sigs2);

      await vetoGuard.queueTransaction(
        tx1.to,
        tx1.value,
        tx1.data,
        tx1.operation,
        tx1.safeTxGas,
        tx1.baseGas,
        tx1.gasPrice,
        tx1.gasToken,
        tx1.refundReceiver,
        signatureBytes1
      );

      const txHash1 = await vetoERC20Voting.getTransactionHash(
        tx1.to,
        tx1.value,
        tx1.data,
        tx1.operation,
        tx1.safeTxGas,
        tx1.baseGas,
        tx1.gasPrice,
        tx1.gasToken,
        tx1.refundReceiver
      );

      // Vetoer 1 casts 500 veto votes and 500 freeze votes
      await vetoERC20Voting.connect(tokenVetoer1).castVetoVote(txHash1, true);

      // Vetoer 2 casts 600 veto votes
      await vetoERC20Voting.connect(tokenVetoer2).castVetoVote(txHash1, true);

      // 1100 veto votes have been cast
      expect(
        await vetoERC20Voting.getVetoVotes(
          tx1.to,
          tx1.value,
          tx1.data,
          tx1.operation,
          tx1.safeTxGas,
          tx1.baseGas,
          tx1.gasPrice,
          tx1.gasToken,
          tx1.refundReceiver
        )
      ).to.eq(1100);

      // 1100 freeze votes have been cast
      expect(await vetoERC20Voting.freezeProposalVoteCount()).to.eq(1100);

      expect(
        await vetoERC20Voting.getIsVetoed(
          tx1.to,
          tx1.value,
          tx1.data,
          tx1.operation,
          tx1.safeTxGas,
          tx1.baseGas,
          tx1.gasPrice,
          tx1.gasToken,
          tx1.refundReceiver
        )
      ).to.eq(true);

      // Check that the DAO has been frozen
      expect(await vetoERC20Voting.isFrozen()).to.eq(true);

      // Mine blocks to surpass the execution delay
      for (let i = 0; i < 9; i++) {
        await network.provider.send("evm_mine");
      }

      await expect(
        gnosisSafe.execTransaction(
          tx1.to,
          tx1.value,
          tx1.data,
          tx1.operation,
          tx1.safeTxGas,
          tx1.baseGas,
          tx1.gasPrice,
          tx1.gasToken,
          tx1.refundReceiver,
          signatureBytes1
        )
      ).to.be.revertedWith("Transaction has been vetoed");

      // Queue tx2
      await vetoGuard.queueTransaction(
        tx2.to,
        tx2.value,
        tx2.data,
        tx2.operation,
        tx2.safeTxGas,
        tx2.baseGas,
        tx2.gasPrice,
        tx2.gasToken,
        tx2.refundReceiver,
        signatureBytes2
      );

      // Mine blocks to surpass the execution delay
      for (let i = 0; i < 9; i++) {
        await network.provider.send("evm_mine");
      }

      await expect(
        gnosisSafe.execTransaction(
          tx2.to,
          tx2.value,
          tx2.data,
          tx2.operation,
          tx2.safeTxGas,
          tx2.baseGas,
          tx2.gasPrice,
          tx2.gasToken,
          tx2.refundReceiver,
          signatureBytes2
        )
      ).to.be.revertedWith("DAO is frozen");
    });

    it("A DAO may be frozen ind. of a veto ", async () => {
      // Vetoer 1 casts 500 veto votes and 500 freeze votes
      await vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();
      // Vetoer 2 casts 600 veto votes
      await vetoERC20Voting.connect(tokenVetoer2).castFreezeVote();

      // 1100 freeze votes have been cast
      expect(await vetoERC20Voting.freezeProposalVoteCount()).to.eq(1100);

      // Check that the DAO has been frozen
      expect(await vetoERC20Voting.isFrozen()).to.eq(true);

      // Create transaction to set the guard address
      const tokenTransferData1 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx1 = buildSafeTransaction({
        to: votesToken.address,
        data: tokenTransferData1,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs1 = [
        await safeSignTypedData(owner1, gnosisSafe, tx1),
        await safeSignTypedData(owner2, gnosisSafe, tx1),
      ];
      const signatureBytes1 = buildSignatureBytes(sigs1);

      await vetoGuard.queueTransaction(
        tx1.to,
        tx1.value,
        tx1.data,
        tx1.operation,
        tx1.safeTxGas,
        tx1.baseGas,
        tx1.gasPrice,
        tx1.gasToken,
        tx1.refundReceiver,
        signatureBytes1
      );

      // Mine blocks to surpass the execution delay
      for (let i = 0; i < 9; i++) {
        await network.provider.send("evm_mine");
      }

      await expect(
        gnosisSafe.execTransaction(
          tx1.to,
          tx1.value,
          tx1.data,
          tx1.operation,
          tx1.safeTxGas,
          tx1.baseGas,
          tx1.gasPrice,
          tx1.gasToken,
          tx1.refundReceiver,
          signatureBytes1
        )
      ).to.be.revertedWith("DAO is frozen");
    });

    it("A DAO may execute txs during a the freeze proposal period if the freeze threshold is not met", async () => {
      // Vetoer 1 casts 500 veto votes and 500 freeze votes
      await vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();

      // Check that the DAO has been frozen
      expect(await vetoERC20Voting.isFrozen()).to.eq(false);

      // Create transaction to set the guard address
      const tokenTransferData1 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx1 = buildSafeTransaction({
        to: votesToken.address,
        data: tokenTransferData1,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs1 = [
        await safeSignTypedData(owner1, gnosisSafe, tx1),
        await safeSignTypedData(owner2, gnosisSafe, tx1),
      ];
      const signatureBytes1 = buildSignatureBytes(sigs1);

      await vetoGuard.queueTransaction(
        tx1.to,
        tx1.value,
        tx1.data,
        tx1.operation,
        tx1.safeTxGas,
        tx1.baseGas,
        tx1.gasPrice,
        tx1.gasToken,
        tx1.refundReceiver,
        signatureBytes1
      );

      // Mine blocks to surpass the execution delay
      for (let i = 0; i < 9; i++) {
        await network.provider.send("evm_mine");
      }

      await expect(
        gnosisSafe.execTransaction(
          tx1.to,
          tx1.value,
          tx1.data,
          tx1.operation,
          tx1.safeTxGas,
          tx1.baseGas,
          tx1.gasPrice,
          tx1.gasToken,
          tx1.refundReceiver,
          signatureBytes1
        )
      ).to.emit(gnosisSafe, "ExecutionSuccess");
    });

    it("Freeze vars set properly during init", async () => {
      // Frozen Params init correctly
      expect(await vetoERC20Voting.freezeVotesThreshold()).to.eq(1090);
      expect(await vetoERC20Voting.freezeProposalBlockDuration()).to.eq(10);
      expect(await vetoERC20Voting.freezeBlockDuration()).to.eq(100);
      expect(await vetoERC20Voting.owner()).to.eq(vetoGuardOwner.address);
    });

    it("updates state properly due to freeze actions", async () => {
      expect(await vetoERC20Voting.freezeProposalVoteCount()).to.eq(0);
      expect(await vetoERC20Voting.freezeProposalCreatedBlock()).to.eq(0);

      // Vetoer 1 casts 500 veto votes and 500 freeze votes
      await vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();
      expect(await vetoERC20Voting.isFrozen()).to.eq(false);
      expect(await vetoERC20Voting.freezeProposalVoteCount()).to.eq(500);
      const latestBlock = await ethers.provider.getBlock("latest");
      expect(await vetoERC20Voting.freezeProposalCreatedBlock()).to.eq(
        latestBlock.number
      );

      await vetoERC20Voting.connect(tokenVetoer2).castFreezeVote();
      expect(await vetoERC20Voting.isFrozen()).to.eq(true);
    });

    it("Casting a vote after the freeze voting period resets state", async () => {
      expect(await vetoERC20Voting.freezeProposalVoteCount()).to.eq(0);
      expect(await vetoERC20Voting.freezeProposalCreatedBlock()).to.eq(0);

      // Vetoer 1 casts 500 veto votes and 500 freeze votes
      await vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();
      expect(await vetoERC20Voting.isFrozen()).to.eq(false);
      expect(await vetoERC20Voting.freezeProposalVoteCount()).to.eq(500);
      let latestBlock = await ethers.provider.getBlock("latest");
      expect(await vetoERC20Voting.freezeProposalCreatedBlock()).to.eq(
        latestBlock.number
      );

      for (let i = 0; i < 10; i++) {
        await network.provider.send("evm_mine");
      }

      await vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();
      expect(await vetoERC20Voting.freezeProposalVoteCount()).to.eq(500);
      latestBlock = await ethers.provider.getBlock("latest");
      expect(await vetoERC20Voting.freezeProposalCreatedBlock()).to.eq(
        latestBlock.number
      );
      expect(await vetoERC20Voting.isFrozen()).to.eq(false);
    });

    it("A user cannot vote twice to freeze a dao during the same voting period", async () => {
      await vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();
      await expect(
        vetoERC20Voting.connect(tokenVetoer1).castFreezeVote()
      ).to.be.revertedWith("User has already voted");
      expect(await vetoERC20Voting.freezeProposalVoteCount()).to.eq(500);
    });

    it("Prev. Frozen DAOs may execute txs after the frozen period", async () => {
      // Vetoer 1 casts 500 veto votes and 500 freeze votes
      await vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();
      // Vetoer 2 casts 600 veto votes
      await vetoERC20Voting.connect(tokenVetoer2).castFreezeVote();

      // Check that the DAO has been frozen
      expect(await vetoERC20Voting.isFrozen()).to.eq(true);

      // Create transaction to set the guard address
      const tokenTransferData1 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx1 = buildSafeTransaction({
        to: votesToken.address,
        data: tokenTransferData1,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs1 = [
        await safeSignTypedData(owner1, gnosisSafe, tx1),
        await safeSignTypedData(owner2, gnosisSafe, tx1),
      ];
      const signatureBytes1 = buildSignatureBytes(sigs1);

      await vetoGuard.queueTransaction(
        tx1.to,
        tx1.value,
        tx1.data,
        tx1.operation,
        tx1.safeTxGas,
        tx1.baseGas,
        tx1.gasPrice,
        tx1.gasToken,
        tx1.refundReceiver,
        signatureBytes1
      );

      // Mine blocks to surpass the execution delay
      for (let i = 0; i < 9; i++) {
        await network.provider.send("evm_mine");
      }

      await expect(
        gnosisSafe.execTransaction(
          tx1.to,
          tx1.value,
          tx1.data,
          tx1.operation,
          tx1.safeTxGas,
          tx1.baseGas,
          tx1.gasPrice,
          tx1.gasToken,
          tx1.refundReceiver,
          signatureBytes1
        )
      ).to.be.revertedWith("DAO is frozen");

      for (let i = 0; i < 100; i++) {
        await network.provider.send("evm_mine");
      }

      // Check that the DAO has been unFrozen
      expect(await vetoERC20Voting.isFrozen()).to.eq(false);
      await expect(
        gnosisSafe.execTransaction(
          tx1.to,
          tx1.value,
          tx1.data,
          tx1.operation,
          tx1.safeTxGas,
          tx1.baseGas,
          tx1.gasPrice,
          tx1.gasToken,
          tx1.refundReceiver,
          signatureBytes1
        )
      ).to.emit(gnosisSafe, "ExecutionSuccess");
    });

    it("Defrosted DAOs may execute txs", async () => {
      // Vetoer 1 casts 500 veto votes and 500 freeze votes
      await vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();
      // Vetoer 2 casts 600 veto votes
      await vetoERC20Voting.connect(tokenVetoer2).castFreezeVote();

      // Check that the DAO has been frozen
      expect(await vetoERC20Voting.isFrozen()).to.eq(true);
      await vetoERC20Voting.connect(vetoGuardOwner).defrost();
      expect(await vetoERC20Voting.isFrozen()).to.eq(false);

      // Create transaction to set the guard address
      const tokenTransferData1 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx1 = buildSafeTransaction({
        to: votesToken.address,
        data: tokenTransferData1,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs1 = [
        await safeSignTypedData(owner1, gnosisSafe, tx1),
        await safeSignTypedData(owner2, gnosisSafe, tx1),
      ];
      const signatureBytes1 = buildSignatureBytes(sigs1);

      await vetoGuard.queueTransaction(
        tx1.to,
        tx1.value,
        tx1.data,
        tx1.operation,
        tx1.safeTxGas,
        tx1.baseGas,
        tx1.gasPrice,
        tx1.gasToken,
        tx1.refundReceiver,
        signatureBytes1
      );

      // Mine blocks to surpass the execution delay
      for (let i = 0; i < 9; i++) {
        await network.provider.send("evm_mine");
      }

      // Check that the DAO has been unFrozen
      await expect(
        gnosisSafe.execTransaction(
          tx1.to,
          tx1.value,
          tx1.data,
          tx1.operation,
          tx1.safeTxGas,
          tx1.baseGas,
          tx1.gasPrice,
          tx1.gasToken,
          tx1.refundReceiver,
          signatureBytes1
        )
      ).to.emit(gnosisSafe, "ExecutionSuccess");
    });

    it("You must have voting weight to cast a freeze vote", async () => {
      await expect(
        vetoERC20Voting.connect(vetoGuardOwner).castFreezeVote()
      ).to.be.revertedWith("User has no votes");
      vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();
      await expect(
        vetoERC20Voting.connect(vetoGuardOwner).castFreezeVote()
      ).to.be.revertedWith("User has no votes");
    });

    it("Only owner methods must be called by vetoGuard owner", async () => {
      await expect(
        vetoERC20Voting.connect(tokenVetoer1).defrost()
      ).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(
        vetoERC20Voting.connect(tokenVetoer1).updateVetoVotesThreshold(0)
      ).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(
        vetoERC20Voting.connect(tokenVetoer1).updateFreezeVotesThreshold(0)
      ).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(
        vetoERC20Voting
          .connect(tokenVetoer1)
          .updateFreezeProposalBlockDuration(0)
      ).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(
        vetoERC20Voting.connect(tokenVetoer1).updateFreezeBlockDuration(0)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
