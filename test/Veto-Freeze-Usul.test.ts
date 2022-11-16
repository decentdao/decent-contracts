import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, network } from "hardhat";
import { TASK_ETHERSCAN_VERIFY } from "hardhat-deploy";
import time from "./time";

import {
  GnosisSafe,
  GnosisSafe__factory,
  GnosisSafeProxyFactory,
  GnosisSafeProxyFactory__factory,
  OZLinearVoting,
  OZLinearVoting__factory,
  Usul,
  Usul__factory,
  UsulVetoGuard,
  UsulVetoGuard__factory,
  VetoERC20Voting,
  VetoERC20Voting__factory,
  VotesToken,
  VotesToken__factory,
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

describe.only("Child DAO with Usul", () => {
  // Factories
  let gnosisFactory: Contract;

  // Deployed contracts
  let gnosisSafeSingleton: GnosisSafe;
  let childGnosisSafe: GnosisSafe;
  let usulVetoGuard: UsulVetoGuard;
  let usulModule: Usul;
  let ozLinearVoting: OZLinearVoting;
  let vetoERC20Voting: VetoERC20Voting;
  let parentVotesToken: VotesToken;
  let childVotesToken: VotesToken;
  let gnosisSafeProxyFactory: GnosisSafeProxyFactory;

  // Wallets
  let deployer: SignerWithAddress;
  let childSafeOwner: SignerWithAddress;
  let parentTokenHolder1: SignerWithAddress;
  let parentTokenHolder2: SignerWithAddress;
  let childTokenHolder1: SignerWithAddress;
  let childTokenHolder2: SignerWithAddress;
  let mockParentDAO: SignerWithAddress;

  // Gnosis
  let createGnosisSetupCalldata: string;

  const gnosisFactoryAddress = "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2";
  const gnosisSingletonAddress = "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552";
  const saltNum = BigNumber.from(
    "0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c"
  );

  beforeEach(async () => {
    const abiCoder = new ethers.utils.AbiCoder();

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

    // Get the signer accounts
    [
      deployer,
      childSafeOwner,
      parentTokenHolder1,
      parentTokenHolder2,
      childTokenHolder1,
      childTokenHolder2,
      mockParentDAO,
    ] = await ethers.getSigners();

    // Deploy Gnosis Safe Proxy factory
    gnosisSafeProxyFactory = await ethers.getContractAt(
      "GnosisSafeProxyFactory",
      gnosisFactoryAddress
    );

    createGnosisSetupCalldata = ifaceSafe.encodeFunctionData("setup", [
      [childSafeOwner.address],
      1,
      ethers.constants.AddressZero,
      ethers.constants.HashZero,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      0,
      ethers.constants.AddressZero,
    ]);

    const predictedGnosisSafeAddress = await predictGnosisSafeAddress(
      gnosisSafeProxyFactory.address,
      createGnosisSetupCalldata,
      saltNum,
      gnosisSingletonAddress,
      gnosisSafeProxyFactory
    );

    // Deploy Gnosis Safe
    await gnosisSafeProxyFactory.createProxyWithNonce(
      gnosisSingletonAddress,
      createGnosisSetupCalldata,
      saltNum
    );

    childGnosisSafe = await ethers.getContractAt(
      "GnosisSafe",
      predictedGnosisSafeAddress
    );

    // Child Votes Token
    childVotesToken = await new VotesToken__factory(deployer).deploy();

    const childVotesTokenSetupData = abiCoder.encode(
      ["string", "string", "address[]", "uint256[]"],
      [
        "CHILD",
        "CHILD",
        [
          childTokenHolder1.address,
          childTokenHolder2.address,
          childGnosisSafe.address,
        ],
        [100, 100, 100],
      ]
    );

    await childVotesToken.setUp(childVotesTokenSetupData);

    // Parent Votes Token
    parentVotesToken = await new VotesToken__factory(deployer).deploy();

    const parentVotesTokenSetupData = abiCoder.encode(
      ["string", "string", "address[]", "uint256[]"],
      [
        "PARENT",
        "PARENT",
        [parentTokenHolder1.address, parentTokenHolder2.address],
        [100, 100],
      ]
    );

    await parentVotesToken.setUp(parentVotesTokenSetupData);

    // Token holders delegate their votes to themselves
    await childVotesToken
      .connect(childTokenHolder1)
      .delegate(childTokenHolder1.address);
    await childVotesToken
      .connect(childTokenHolder2)
      .delegate(childTokenHolder2.address);
    await parentVotesToken
      .connect(parentTokenHolder1)
      .delegate(parentTokenHolder1.address);
    await parentVotesToken
      .connect(parentTokenHolder2)
      .delegate(parentTokenHolder2.address);

    // Deploy Usul module
    usulModule = await new Usul__factory(deployer).deploy(
      mockParentDAO.address,
      childGnosisSafe.address,
      childGnosisSafe.address,
      []
    );

    // Deploy OZ Linear Voting Strategy
    ozLinearVoting = await new OZLinearVoting__factory(deployer).deploy(
      mockParentDAO.address, // owner
      childVotesToken.address, // governance token
      usulModule.address, // usul module
      60, // voting period in seconds
      50, // quorom numerator, denominator is 100
      60, // timelock period in seconds
      "Voting" // name
    );

    // Enable the OZ Linear Voting strategy on Usul
    await usulModule
      .connect(mockParentDAO)
      .enableStrategy(ozLinearVoting.address);

    // Deploy VetoERC20Voting contract
    vetoERC20Voting = await new VetoERC20Voting__factory(deployer).deploy();

    // Deploy and setUp Usul Veto Guard contract
    usulVetoGuard = await new UsulVetoGuard__factory(deployer).deploy();

    await usulVetoGuard.setUp(
      abiCoder.encode(
        ["address", "address", "address", "address"],
        [
          mockParentDAO.address, // owner
          vetoERC20Voting.address, // veto voting contract
          ozLinearVoting.address, // OZ linear voting contract
          usulModule.address, // Usul
        ]
      )
    );

    // Set the Usul Veto Guard as the Guard on the Usul Module
    await usulModule.connect(mockParentDAO).setGuard(usulVetoGuard.address);

    await vetoERC20Voting.setUp(
      abiCoder.encode(
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
          mockParentDAO.address, // owner
          150, // veto votes threshold
          150, // freeze votes threshold
          10, // freeze proposal duration in blocks
          100, // freeze duration in blocks
          parentVotesToken.address,
          usulVetoGuard.address,
        ]
      )
    );

    // Create transaction on Gnosis Safe to setup Usul module
    const enableUsulModuleData = childGnosisSafe.interface.encodeFunctionData(
      "enableModule",
      [usulModule.address]
    );

    const enableUsulModuleTx = buildSafeTransaction({
      to: childGnosisSafe.address,
      data: enableUsulModuleData,
      safeTxGas: 1000000,
      nonce: (await childGnosisSafe.nonce()).toNumber(),
    });

    const sigs = [
      await safeSignTypedData(
        childSafeOwner,
        childGnosisSafe,
        enableUsulModuleTx
      ),
    ];

    const signatureBytes = buildSignatureBytes(sigs);

    // Execute transaction that adds the veto guard to the Safe
    await expect(
      childGnosisSafe.execTransaction(
        enableUsulModuleTx.to,
        enableUsulModuleTx.value,
        enableUsulModuleTx.data,
        enableUsulModuleTx.operation,
        enableUsulModuleTx.safeTxGas,
        enableUsulModuleTx.baseGas,
        enableUsulModuleTx.gasPrice,
        enableUsulModuleTx.gasToken,
        enableUsulModuleTx.refundReceiver,
        signatureBytes
      )
    ).to.emit(childGnosisSafe, "ExecutionSuccess");

    // Gnosis Safe received the 1,000 tokens
    expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(100);
  });

  describe("VetoGuard Functionality", () => {
    it("Supports ERC-165", async () => {
      // Supports IVetoGuard interface
      expect(await usulVetoGuard.supportsInterface("0x213fabef")).to.eq(true);
      // Supports IGuard interface
      expect(await usulVetoGuard.supportsInterface("0xe6d7a83a")).to.eq(true);
      // Supports IERC-165 interface
      expect(await usulVetoGuard.supportsInterface("0x01ffc9a7")).to.eq(true);
      // Doesn't support random interface
      expect(await usulVetoGuard.supportsInterface("0x00000000")).to.eq(false);
    });

    it("A proposal can be created and executed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      // Get the tx hash to submit within the proposal
      const txHash = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData,
        0
      );

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal([txHash], ozLinearVoting.address, [0]);

      // 0 => Active
      // 1 => Canceled,
      // 2 => TimeLocked,
      // 3 => Executed,
      // 4 => Executing,
      // 5 => Uninitialized

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      // Both users vote in support of proposal
      await ozLinearVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await ozLinearVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Queue the proposal
      await usulVetoGuard.queueProposal(0);

      // Proposal is timelocked
      expect(await usulModule.state(0)).to.eq(2);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await usulModule.state(0)).to.eq(4);

      expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(
        100
      );
      expect(await childVotesToken.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await usulModule.executeProposalByIndex(
        0,
        childVotesToken.address,
        0,
        tokenTransferData,
        0
      );

      expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(
        90
      );
      expect(await childVotesToken.balanceOf(deployer.address)).to.eq(10);
    });

    it("A transaction cannot be executed if it hasn't yet been queued", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      // Get the tx hash to submit within the proposal
      const txHash = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData,
        0
      );

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal([txHash], ozLinearVoting.address, [0]);

      // 0 => Active
      // 1 => Canceled,
      // 2 => TimeLocked,
      // 3 => Executed,
      // 4 => Executing,
      // 5 => Uninitialized

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      // Both users vote in support of proposal
      await ozLinearVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await ozLinearVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Execute the transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData,
          0
        )
      ).to.be.revertedWith("proposal is not in execution state");
    });

    it("A proposal cannot be queued if quorum hasn't been reached", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      // Get the tx hash to submit within the proposal
      const txHash = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData,
        0
      );

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal([txHash], ozLinearVoting.address, [0]);

      // 0 => Active
      // 1 => Canceled,
      // 2 => TimeLocked,
      // 3 => Executed,
      // 4 => Executing,
      // 5 => Uninitialized

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      // Both users vote in support of proposal
      // await ozLinearVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      // await ozLinearVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Attempt to queue the proposal
      await expect(usulVetoGuard.queueProposal(0)).to.be.revertedWith(
        "majority yesVotes not reached"
      );
    });

    it("A proposal cannot be queued if no votes exceed yes votes", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      // Get the tx hash to submit within the proposal
      const txHash = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData,
        0
      );

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal([txHash], ozLinearVoting.address, [0]);

      // 0 => Active
      // 1 => Canceled,
      // 2 => TimeLocked,
      // 3 => Executed,
      // 4 => Executing,
      // 5 => Uninitialized

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      // Both users vote in support of proposal
      await ozLinearVoting.connect(childTokenHolder1).vote(0, 0, [0]);
      await ozLinearVoting.connect(childTokenHolder2).vote(0, 0, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Attempt to queue the proposal
      await expect(usulVetoGuard.queueProposal(0)).to.be.revertedWith(
        "majority yesVotes not reached"
      );
    });

    it("A proposal cannot be queued if its voting period hasn't ended yet", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      // Get the tx hash to submit within the proposal
      const txHash = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData,
        0
      );

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal([txHash], ozLinearVoting.address, [0]);

      // 0 => Active
      // 1 => Canceled,
      // 2 => TimeLocked,
      // 3 => Executed,
      // 4 => Executing,
      // 5 => Uninitialized

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      // Both users vote in support of proposal
      await ozLinearVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await ozLinearVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      // await time.increase(time.duration.seconds(60));

      // Queue the proposal
      await expect(usulVetoGuard.queueProposal(0)).to.be.revertedWith(
        "voting period has not passed yet"
      );
    });

    it("A proposal cannot be executed if it is still timelocked", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      // Get the tx hash to submit within the proposal
      const txHash = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData,
        0
      );

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal([txHash], ozLinearVoting.address, [0]);

      // 0 => Active
      // 1 => Canceled,
      // 2 => TimeLocked,
      // 3 => Executed,
      // 4 => Executing,
      // 5 => Uninitialized

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      // Both users vote in support of proposal
      await ozLinearVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await ozLinearVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Queue the proposal
      await usulVetoGuard.queueProposal(0);

      // Proposal is timelocked
      expect(await usulModule.state(0)).to.eq(2);

      // Do not wait for timelock to end, but attempt to execute the transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData,
          0
        )
      ).to.be.revertedWith("proposal is not in execution state");
    });

    it("A transaction cannot be executed if it has been vetoed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      // Get the tx hash to submit within the proposal
      const txHash = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData,
        0
      );

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal([txHash], ozLinearVoting.address, [0]);

      // 0 => Active
      // 1 => Canceled,
      // 2 => TimeLocked,
      // 3 => Executed,
      // 4 => Executing,
      // 5 => Uninitialized

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      // Both users vote in support of proposal
      await ozLinearVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await ozLinearVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Queue the proposal
      await usulVetoGuard.queueProposal(0);

      // Proposal is timelocked
      expect(await usulModule.state(0)).to.eq(2);

      // Cast veto votes
      await vetoERC20Voting
        .connect(parentTokenHolder1)
        .castVetoVote(txHash, false);
      await vetoERC20Voting
        .connect(parentTokenHolder2)
        .castVetoVote(txHash, false);

      expect(await vetoERC20Voting.getIsVetoed(txHash)).to.eq(true);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await usulModule.state(0)).to.eq(4);

      // Execute the transaction
      await usulModule.executeProposalByIndex(
        0,
        childVotesToken.address,
        0,
        tokenTransferData,
        0
      );
    });

    // it("A transaction cannot be executed if it has received more veto votes than the threshold", async () => {
    //   // Create transaction to set the guard address
    //   const tokenTransferData = votesToken.interface.encodeFunctionData(
    //     "transfer",
    //     [deployer.address, 1000]
    //   );
    //   const tx = buildSafeTransaction({
    //     to: votesToken.address,
    //     data: tokenTransferData,
    //     safeTxGas: 1000000,
    //     nonce: await gnosisSafe.nonce(),
    //   });
    //   const sigs = [
    //     await safeSignTypedData(owner1, gnosisSafe, tx),
    //     await safeSignTypedData(owner2, gnosisSafe, tx),
    //   ];
    //   const signatureBytes = buildSignatureBytes(sigs);
    //   await vetoGuard.queueTransaction(
    //     tx.to,
    //     tx.value,
    //     tx.data,
    //     tx.operation,
    //     tx.safeTxGas,
    //     tx.baseGas,
    //     tx.gasPrice,
    //     tx.gasToken,
    //     tx.refundReceiver,
    //     signatureBytes
    //   );
    //   const txHash = await vetoERC20Voting.getTransactionHash(
    //     tx.to,
    //     tx.value,
    //     tx.data,
    //     tx.operation,
    //     tx.safeTxGas,
    //     tx.baseGas,
    //     tx.gasPrice,
    //     tx.gasToken,
    //     tx.refundReceiver
    //   );
    //   // Vetoer 1 casts 500 veto votes
    //   await vetoERC20Voting.connect(tokenVetoer1).castVetoVote(txHash, false);
    //   // Vetoer 2 casts 600 veto votes
    //   await vetoERC20Voting.connect(tokenVetoer2).castVetoVote(txHash, false);
    //   // 1100 veto votes have been cast
    //   expect(await vetoERC20Voting.transactionVetoVotes(txHash)).to.eq(1100);
    //   expect(await vetoERC20Voting.getIsVetoed(txHash)).to.eq(true);
    //   // Mine blocks to surpass the execution delay
    //   for (let i = 0; i < 9; i++) {
    //     await network.provider.send("evm_mine");
    //   }
    //   await expect(
    //     gnosisSafe.execTransaction(
    //       tx.to,
    //       tx.value,
    //       tx.data,
    //       tx.operation,
    //       tx.safeTxGas,
    //       tx.baseGas,
    //       tx.gasPrice,
    //       tx.gasToken,
    //       tx.refundReceiver,
    //       signatureBytes
    //     )
    //   ).to.be.revertedWith("Transaction has been vetoed");
    // });
    // it("A vetoed transaction does not prevent another transaction from being executed", async () => {
    //   // Create transaction to set the guard address
    //   const tokenTransferData1 = votesToken.interface.encodeFunctionData(
    //     "transfer",
    //     [deployer.address, 1000]
    //   );
    //   const tokenTransferData2 = votesToken.interface.encodeFunctionData(
    //     "transfer",
    //     [deployer.address, 999]
    //   );
    //   const tx1 = buildSafeTransaction({
    //     to: votesToken.address,
    //     data: tokenTransferData1,
    //     safeTxGas: 1000000,
    //     nonce: await gnosisSafe.nonce(),
    //   });
    //   const tx2 = buildSafeTransaction({
    //     to: votesToken.address,
    //     data: tokenTransferData2,
    //     safeTxGas: 1000000,
    //     nonce: await gnosisSafe.nonce(),
    //   });
    //   const sigs1 = [
    //     await safeSignTypedData(owner1, gnosisSafe, tx1),
    //     await safeSignTypedData(owner2, gnosisSafe, tx1),
    //   ];
    //   const signatureBytes1 = buildSignatureBytes(sigs1);
    //   const sigs2 = [
    //     await safeSignTypedData(owner1, gnosisSafe, tx2),
    //     await safeSignTypedData(owner2, gnosisSafe, tx2),
    //   ];
    //   const signatureBytes2 = buildSignatureBytes(sigs2);
    //   await vetoGuard.queueTransaction(
    //     tx1.to,
    //     tx1.value,
    //     tx1.data,
    //     tx1.operation,
    //     tx1.safeTxGas,
    //     tx1.baseGas,
    //     tx1.gasPrice,
    //     tx1.gasToken,
    //     tx1.refundReceiver,
    //     signatureBytes1
    //   );
    //   const txHash1 = await vetoERC20Voting.getTransactionHash(
    //     tx1.to,
    //     tx1.value,
    //     tx1.data,
    //     tx1.operation,
    //     tx1.safeTxGas,
    //     tx1.baseGas,
    //     tx1.gasPrice,
    //     tx1.gasToken,
    //     tx1.refundReceiver
    //   );
    //   // Vetoer 1 casts 500 veto votes
    //   await vetoERC20Voting.connect(tokenVetoer1).castVetoVote(txHash1, false);
    //   // Vetoer 2 casts 600 veto votes
    //   await vetoERC20Voting.connect(tokenVetoer2).castVetoVote(txHash1, false);
    //   // 1100 veto votes have been cast
    //   expect(await vetoERC20Voting.transactionVetoVotes(txHash1)).to.eq(1100);
    //   expect(await vetoERC20Voting.getIsVetoed(txHash1)).to.eq(true);
    //   // Mine blocks to surpass the execution delay
    //   for (let i = 0; i < 9; i++) {
    //     await network.provider.send("evm_mine");
    //   }
    //   await expect(
    //     gnosisSafe.execTransaction(
    //       tx1.to,
    //       tx1.value,
    //       tx1.data,
    //       tx1.operation,
    //       tx1.safeTxGas,
    //       tx1.baseGas,
    //       tx1.gasPrice,
    //       tx1.gasToken,
    //       tx1.refundReceiver,
    //       signatureBytes1
    //     )
    //   ).to.be.revertedWith("Transaction has been vetoed");
    //   // Tx1 has been vetoed, now try to queue and execute tx2
    //   await vetoGuard.queueTransaction(
    //     tx2.to,
    //     tx2.value,
    //     tx2.data,
    //     tx2.operation,
    //     tx2.safeTxGas,
    //     tx2.baseGas,
    //     tx2.gasPrice,
    //     tx2.gasToken,
    //     tx2.refundReceiver,
    //     signatureBytes2
    //   );
    //   // Mine blocks to surpass the execution delay
    //   for (let i = 0; i < 9; i++) {
    //     await network.provider.send("evm_mine");
    //   }
    //   await gnosisSafe.execTransaction(
    //     tx2.to,
    //     tx2.value,
    //     tx2.data,
    //     tx2.operation,
    //     tx2.safeTxGas,
    //     tx2.baseGas,
    //     tx2.gasPrice,
    //     tx2.gasToken,
    //     tx2.refundReceiver,
    //     signatureBytes2
    //   );
    //   expect(await votesToken.balanceOf(deployer.address)).to.eq(999);
    //   expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(1);
    // });
    // it("A vetoer cannot cast veto votes more than once", async () => {
    //   // Create transaction to set the guard address
    //   const tokenTransferData = votesToken.interface.encodeFunctionData(
    //     "transfer",
    //     [deployer.address, 1000]
    //   );
    //   const tx = buildSafeTransaction({
    //     to: votesToken.address,
    //     data: tokenTransferData,
    //     safeTxGas: 1000000,
    //     nonce: await gnosisSafe.nonce(),
    //   });
    //   const sigs = [
    //     await safeSignTypedData(owner1, gnosisSafe, tx),
    //     await safeSignTypedData(owner2, gnosisSafe, tx),
    //   ];
    //   const signatureBytes = buildSignatureBytes(sigs);
    //   await vetoGuard.queueTransaction(
    //     tx.to,
    //     tx.value,
    //     tx.data,
    //     tx.operation,
    //     tx.safeTxGas,
    //     tx.baseGas,
    //     tx.gasPrice,
    //     tx.gasToken,
    //     tx.refundReceiver,
    //     signatureBytes
    //   );
    //   const txHash = await vetoERC20Voting.getTransactionHash(
    //     tx.to,
    //     tx.value,
    //     tx.data,
    //     tx.operation,
    //     tx.safeTxGas,
    //     tx.baseGas,
    //     tx.gasPrice,
    //     tx.gasToken,
    //     tx.refundReceiver
    //   );
    //   // Vetoer 1 casts 500 veto votes
    //   await vetoERC20Voting.connect(tokenVetoer1).castVetoVote(txHash, false);
    //   await expect(
    //     vetoERC20Voting.connect(tokenVetoer1).castVetoVote(txHash, false)
    //   ).to.be.revertedWith("User has already voted");
    // });
    // it("A veto vote cannot be cast if the transaction has not been queued yet", async () => {
    //   // Create transaction to set the guard address
    //   const tokenTransferData = votesToken.interface.encodeFunctionData(
    //     "transfer",
    //     [deployer.address, 1000]
    //   );
    //   const tx = buildSafeTransaction({
    //     to: votesToken.address,
    //     data: tokenTransferData,
    //     safeTxGas: 1000000,
    //     nonce: await gnosisSafe.nonce(),
    //   });
    //   const txHash = await vetoERC20Voting.getTransactionHash(
    //     tx.to,
    //     tx.value,
    //     tx.data,
    //     tx.operation,
    //     tx.safeTxGas,
    //     tx.baseGas,
    //     tx.gasPrice,
    //     tx.gasToken,
    //     tx.refundReceiver
    //   );
    //   await expect(
    //     vetoERC20Voting.connect(tokenVetoer1).castVetoVote(txHash, false)
    //   ).to.be.revertedWith("Transaction has not yet been queued");
    // });
  });

  // describe("Frozen Functionality", () => {
  // it("A frozen DAO cannot execute any transactions", async () => {
  //   // Create transaction to set the guard address
  //   const tokenTransferData1 = votesToken.interface.encodeFunctionData(
  //     "transfer",
  //     [deployer.address, 1000]
  //   );

  //   const tokenTransferData2 = votesToken.interface.encodeFunctionData(
  //     "transfer",
  //     [deployer.address, 999]
  //   );

  //   const tx1 = buildSafeTransaction({
  //     to: votesToken.address,
  //     data: tokenTransferData1,
  //     safeTxGas: 1000000,
  //     nonce: await gnosisSafe.nonce(),
  //   });

  //   const tx2 = buildSafeTransaction({
  //     to: votesToken.address,
  //     data: tokenTransferData2,
  //     safeTxGas: 1000000,
  //     nonce: await gnosisSafe.nonce(),
  //   });

  //   const sigs1 = [
  //     await safeSignTypedData(owner1, gnosisSafe, tx1),
  //     await safeSignTypedData(owner2, gnosisSafe, tx1),
  //   ];
  //   const signatureBytes1 = buildSignatureBytes(sigs1);

  //   const sigs2 = [
  //     await safeSignTypedData(owner1, gnosisSafe, tx2),
  //     await safeSignTypedData(owner2, gnosisSafe, tx2),
  //   ];
  //   const signatureBytes2 = buildSignatureBytes(sigs2);

  //   await vetoGuard.queueTransaction(
  //     tx1.to,
  //     tx1.value,
  //     tx1.data,
  //     tx1.operation,
  //     tx1.safeTxGas,
  //     tx1.baseGas,
  //     tx1.gasPrice,
  //     tx1.gasToken,
  //     tx1.refundReceiver,
  //     signatureBytes1
  //   );

  //   const txHash1 = await vetoERC20Voting.getTransactionHash(
  //     tx1.to,
  //     tx1.value,
  //     tx1.data,
  //     tx1.operation,
  //     tx1.safeTxGas,
  //     tx1.baseGas,
  //     tx1.gasPrice,
  //     tx1.gasToken,
  //     tx1.refundReceiver
  //   );

  //   // Vetoer 1 casts 500 veto votes and 500 freeze votes
  //   await vetoERC20Voting.connect(tokenVetoer1).castVetoVote(txHash1, true);

  //   // Vetoer 2 casts 600 veto votes
  //   await vetoERC20Voting.connect(tokenVetoer2).castVetoVote(txHash1, true);

  //   // 1100 veto votes have been cast
  //   expect(await vetoERC20Voting.transactionVetoVotes(txHash1)).to.eq(1100);

  //   // 1100 freeze votes have been cast
  //   expect(await vetoERC20Voting.freezeProposalVoteCount()).to.eq(1100);

  //   expect(await vetoERC20Voting.getIsVetoed(txHash1)).to.eq(true);

  //   // Check that the DAO has been frozen
  //   expect(await vetoERC20Voting.isFrozen()).to.eq(true);

  //   // Mine blocks to surpass the execution delay
  //   for (let i = 0; i < 9; i++) {
  //     await network.provider.send("evm_mine");
  //   }

  //   await expect(
  //     gnosisSafe.execTransaction(
  //       tx1.to,
  //       tx1.value,
  //       tx1.data,
  //       tx1.operation,
  //       tx1.safeTxGas,
  //       tx1.baseGas,
  //       tx1.gasPrice,
  //       tx1.gasToken,
  //       tx1.refundReceiver,
  //       signatureBytes1
  //     )
  //   ).to.be.revertedWith("Transaction has been vetoed");

  //   // Queue tx2
  //   await vetoGuard.queueTransaction(
  //     tx2.to,
  //     tx2.value,
  //     tx2.data,
  //     tx2.operation,
  //     tx2.safeTxGas,
  //     tx2.baseGas,
  //     tx2.gasPrice,
  //     tx2.gasToken,
  //     tx2.refundReceiver,
  //     signatureBytes2
  //   );

  //   // Mine blocks to surpass the execution delay
  //   for (let i = 0; i < 9; i++) {
  //     await network.provider.send("evm_mine");
  //   }

  //   await expect(
  //     gnosisSafe.execTransaction(
  //       tx2.to,
  //       tx2.value,
  //       tx2.data,
  //       tx2.operation,
  //       tx2.safeTxGas,
  //       tx2.baseGas,
  //       tx2.gasPrice,
  //       tx2.gasToken,
  //       tx2.refundReceiver,
  //       signatureBytes2
  //     )
  //   ).to.be.revertedWith("DAO is frozen");
  // });

  // it("A DAO may be frozen ind. of a veto ", async () => {
  //   // Vetoer 1 casts 500 veto votes and 500 freeze votes
  //   await vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();
  //   // Vetoer 2 casts 600 veto votes
  //   await vetoERC20Voting.connect(tokenVetoer2).castFreezeVote();

  //   // 1100 freeze votes have been cast
  //   expect(await vetoERC20Voting.freezeProposalVoteCount()).to.eq(1100);

  //   // Check that the DAO has been frozen
  //   expect(await vetoERC20Voting.isFrozen()).to.eq(true);

  //   // Create transaction to set the guard address
  //   const tokenTransferData1 = votesToken.interface.encodeFunctionData(
  //     "transfer",
  //     [deployer.address, 1000]
  //   );

  //   const tx1 = buildSafeTransaction({
  //     to: votesToken.address,
  //     data: tokenTransferData1,
  //     safeTxGas: 1000000,
  //     nonce: await gnosisSafe.nonce(),
  //   });

  //   const sigs1 = [
  //     await safeSignTypedData(owner1, gnosisSafe, tx1),
  //     await safeSignTypedData(owner2, gnosisSafe, tx1),
  //   ];
  //   const signatureBytes1 = buildSignatureBytes(sigs1);

  //   await vetoGuard.queueTransaction(
  //     tx1.to,
  //     tx1.value,
  //     tx1.data,
  //     tx1.operation,
  //     tx1.safeTxGas,
  //     tx1.baseGas,
  //     tx1.gasPrice,
  //     tx1.gasToken,
  //     tx1.refundReceiver,
  //     signatureBytes1
  //   );

  //   // Mine blocks to surpass the execution delay
  //   for (let i = 0; i < 9; i++) {
  //     await network.provider.send("evm_mine");
  //   }

  //   await expect(
  //     gnosisSafe.execTransaction(
  //       tx1.to,
  //       tx1.value,
  //       tx1.data,
  //       tx1.operation,
  //       tx1.safeTxGas,
  //       tx1.baseGas,
  //       tx1.gasPrice,
  //       tx1.gasToken,
  //       tx1.refundReceiver,
  //       signatureBytes1
  //     )
  //   ).to.be.revertedWith("DAO is frozen");
  // });

  // it("A DAO may execute txs during a the freeze proposal period if the freeze threshold is not met", async () => {
  //   // Vetoer 1 casts 500 veto votes and 500 freeze votes
  //   await vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();

  //   // Check that the DAO has been frozen
  //   expect(await vetoERC20Voting.isFrozen()).to.eq(false);

  //   // Create transaction to set the guard address
  //   const tokenTransferData1 = votesToken.interface.encodeFunctionData(
  //     "transfer",
  //     [deployer.address, 1000]
  //   );

  //   const tx1 = buildSafeTransaction({
  //     to: votesToken.address,
  //     data: tokenTransferData1,
  //     safeTxGas: 1000000,
  //     nonce: await gnosisSafe.nonce(),
  //   });

  //   const sigs1 = [
  //     await safeSignTypedData(owner1, gnosisSafe, tx1),
  //     await safeSignTypedData(owner2, gnosisSafe, tx1),
  //   ];
  //   const signatureBytes1 = buildSignatureBytes(sigs1);

  //   await vetoGuard.queueTransaction(
  //     tx1.to,
  //     tx1.value,
  //     tx1.data,
  //     tx1.operation,
  //     tx1.safeTxGas,
  //     tx1.baseGas,
  //     tx1.gasPrice,
  //     tx1.gasToken,
  //     tx1.refundReceiver,
  //     signatureBytes1
  //   );

  //   // Mine blocks to surpass the execution delay
  //   for (let i = 0; i < 9; i++) {
  //     await network.provider.send("evm_mine");
  //   }

  //   await expect(
  //     gnosisSafe.execTransaction(
  //       tx1.to,
  //       tx1.value,
  //       tx1.data,
  //       tx1.operation,
  //       tx1.safeTxGas,
  //       tx1.baseGas,
  //       tx1.gasPrice,
  //       tx1.gasToken,
  //       tx1.refundReceiver,
  //       signatureBytes1
  //     )
  //   ).to.emit(gnosisSafe, "ExecutionSuccess");
  // });

  // it("Freeze vars set properly during init", async () => {
  //   // Frozen Params init correctly
  //   expect(await vetoERC20Voting.freezeVotesThreshold()).to.eq(1090);
  //   expect(await vetoERC20Voting.freezeProposalBlockDuration()).to.eq(10);
  //   expect(await vetoERC20Voting.freezeBlockDuration()).to.eq(100);
  //   expect(await vetoERC20Voting.owner()).to.eq(vetoGuardOwner.address);
  // });

  // it("updates state properly due to freeze actions", async () => {
  //   expect(await vetoERC20Voting.freezeProposalVoteCount()).to.eq(0);
  //   expect(await vetoERC20Voting.freezeProposalCreatedBlock()).to.eq(0);

  //   // Vetoer 1 casts 500 veto votes and 500 freeze votes
  //   await vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();
  //   expect(await vetoERC20Voting.isFrozen()).to.eq(false);
  //   expect(await vetoERC20Voting.freezeProposalVoteCount()).to.eq(500);
  //   const latestBlock = await ethers.provider.getBlock("latest");
  //   expect(await vetoERC20Voting.freezeProposalCreatedBlock()).to.eq(
  //     latestBlock.number
  //   );

  //   await vetoERC20Voting.connect(tokenVetoer2).castFreezeVote();
  //   expect(await vetoERC20Voting.isFrozen()).to.eq(true);
  // });

  // it("Casting a vote after the freeze voting period resets state", async () => {
  //   expect(await vetoERC20Voting.freezeProposalVoteCount()).to.eq(0);
  //   expect(await vetoERC20Voting.freezeProposalCreatedBlock()).to.eq(0);

  //   // Vetoer 1 casts 500 veto votes and 500 freeze votes
  //   await vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();
  //   expect(await vetoERC20Voting.isFrozen()).to.eq(false);
  //   expect(await vetoERC20Voting.freezeProposalVoteCount()).to.eq(500);
  //   let latestBlock = await ethers.provider.getBlock("latest");
  //   expect(await vetoERC20Voting.freezeProposalCreatedBlock()).to.eq(
  //     latestBlock.number
  //   );

  //   for (let i = 0; i < 10; i++) {
  //     await network.provider.send("evm_mine");
  //   }

  //   await vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();
  //   expect(await vetoERC20Voting.freezeProposalVoteCount()).to.eq(500);
  //   latestBlock = await ethers.provider.getBlock("latest");
  //   expect(await vetoERC20Voting.freezeProposalCreatedBlock()).to.eq(
  //     latestBlock.number
  //   );
  //   expect(await vetoERC20Voting.isFrozen()).to.eq(false);
  // });

  // it("A user cannot vote twice to freeze a dao during the same voting period", async () => {
  //   await vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();
  //   await expect(
  //     vetoERC20Voting.connect(tokenVetoer1).castFreezeVote()
  //   ).to.be.revertedWith("User has already voted");
  //   expect(await vetoERC20Voting.freezeProposalVoteCount()).to.eq(500);
  // });

  // it("Prev. Frozen DAOs may execute txs after the frozen period", async () => {
  //   // Vetoer 1 casts 500 veto votes and 500 freeze votes
  //   await vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();
  //   // Vetoer 2 casts 600 veto votes
  //   await vetoERC20Voting.connect(tokenVetoer2).castFreezeVote();

  //   // Check that the DAO has been frozen
  //   expect(await vetoERC20Voting.isFrozen()).to.eq(true);

  //   // Create transaction to set the guard address
  //   const tokenTransferData1 = votesToken.interface.encodeFunctionData(
  //     "transfer",
  //     [deployer.address, 1000]
  //   );

  //   const tx1 = buildSafeTransaction({
  //     to: votesToken.address,
  //     data: tokenTransferData1,
  //     safeTxGas: 1000000,
  //     nonce: await gnosisSafe.nonce(),
  //   });

  //   const sigs1 = [
  //     await safeSignTypedData(owner1, gnosisSafe, tx1),
  //     await safeSignTypedData(owner2, gnosisSafe, tx1),
  //   ];
  //   const signatureBytes1 = buildSignatureBytes(sigs1);

  //   await vetoGuard.queueTransaction(
  //     tx1.to,
  //     tx1.value,
  //     tx1.data,
  //     tx1.operation,
  //     tx1.safeTxGas,
  //     tx1.baseGas,
  //     tx1.gasPrice,
  //     tx1.gasToken,
  //     tx1.refundReceiver,
  //     signatureBytes1
  //   );

  //   // Mine blocks to surpass the execution delay
  //   for (let i = 0; i < 9; i++) {
  //     await network.provider.send("evm_mine");
  //   }

  //   await expect(
  //     gnosisSafe.execTransaction(
  //       tx1.to,
  //       tx1.value,
  //       tx1.data,
  //       tx1.operation,
  //       tx1.safeTxGas,
  //       tx1.baseGas,
  //       tx1.gasPrice,
  //       tx1.gasToken,
  //       tx1.refundReceiver,
  //       signatureBytes1
  //     )
  //   ).to.be.revertedWith("DAO is frozen");

  //   for (let i = 0; i < 100; i++) {
  //     await network.provider.send("evm_mine");
  //   }

  //   // Check that the DAO has been unFrozen
  //   expect(await vetoERC20Voting.isFrozen()).to.eq(false);
  //   await expect(
  //     gnosisSafe.execTransaction(
  //       tx1.to,
  //       tx1.value,
  //       tx1.data,
  //       tx1.operation,
  //       tx1.safeTxGas,
  //       tx1.baseGas,
  //       tx1.gasPrice,
  //       tx1.gasToken,
  //       tx1.refundReceiver,
  //       signatureBytes1
  //     )
  //   ).to.emit(gnosisSafe, "ExecutionSuccess");
  // });

  // it("Defrosted DAOs may execute txs", async () => {
  //   // Vetoer 1 casts 500 veto votes and 500 freeze votes
  //   await vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();
  //   // Vetoer 2 casts 600 veto votes
  //   await vetoERC20Voting.connect(tokenVetoer2).castFreezeVote();

  //   // Check that the DAO has been frozen
  //   expect(await vetoERC20Voting.isFrozen()).to.eq(true);
  //   await vetoERC20Voting.connect(vetoGuardOwner).defrost();
  //   expect(await vetoERC20Voting.isFrozen()).to.eq(false);

  //   // Create transaction to set the guard address
  //   const tokenTransferData1 = votesToken.interface.encodeFunctionData(
  //     "transfer",
  //     [deployer.address, 1000]
  //   );

  //   const tx1 = buildSafeTransaction({
  //     to: votesToken.address,
  //     data: tokenTransferData1,
  //     safeTxGas: 1000000,
  //     nonce: await gnosisSafe.nonce(),
  //   });

  //   const sigs1 = [
  //     await safeSignTypedData(owner1, gnosisSafe, tx1),
  //     await safeSignTypedData(owner2, gnosisSafe, tx1),
  //   ];
  //   const signatureBytes1 = buildSignatureBytes(sigs1);

  //   await vetoGuard.queueTransaction(
  //     tx1.to,
  //     tx1.value,
  //     tx1.data,
  //     tx1.operation,
  //     tx1.safeTxGas,
  //     tx1.baseGas,
  //     tx1.gasPrice,
  //     tx1.gasToken,
  //     tx1.refundReceiver,
  //     signatureBytes1
  //   );

  //   // Mine blocks to surpass the execution delay
  //   for (let i = 0; i < 9; i++) {
  //     await network.provider.send("evm_mine");
  //   }

  //   // Check that the DAO has been unFrozen
  //   await expect(
  //     gnosisSafe.execTransaction(
  //       tx1.to,
  //       tx1.value,
  //       tx1.data,
  //       tx1.operation,
  //       tx1.safeTxGas,
  //       tx1.baseGas,
  //       tx1.gasPrice,
  //       tx1.gasToken,
  //       tx1.refundReceiver,
  //       signatureBytes1
  //     )
  //   ).to.emit(gnosisSafe, "ExecutionSuccess");
  // });

  // it("You must have voting weight to cast a freeze vote", async () => {
  //   await expect(
  //     vetoERC20Voting.connect(vetoGuardOwner).castFreezeVote()
  //   ).to.be.revertedWith("User has no votes");
  //   vetoERC20Voting.connect(tokenVetoer1).castFreezeVote();
  //   await expect(
  //     vetoERC20Voting.connect(vetoGuardOwner).castFreezeVote()
  //   ).to.be.revertedWith("User has no votes");
  // });

  // it("Only owner methods must be called by vetoGuard owner", async () => {
  //   await expect(
  //     vetoERC20Voting.connect(tokenVetoer1).defrost()
  //   ).to.be.revertedWith("Ownable: caller is not the owner");
  //   await expect(
  //     vetoERC20Voting.connect(tokenVetoer1).updateVetoVotesThreshold(0)
  //   ).to.be.revertedWith("Ownable: caller is not the owner");
  //   await expect(
  //     vetoERC20Voting.connect(tokenVetoer1).updateFreezeVotesThreshold(0)
  //   ).to.be.revertedWith("Ownable: caller is not the owner");
  //   await expect(
  //     vetoERC20Voting
  //       .connect(tokenVetoer1)
  //       .updateFreezeProposalBlockDuration(0)
  //   ).to.be.revertedWith("Ownable: caller is not the owner");
  //   await expect(
  //     vetoERC20Voting.connect(tokenVetoer1).updateFreezeBlockDuration(0)
  //   ).to.be.revertedWith("Ownable: caller is not the owner");
  // });
  // });
});
