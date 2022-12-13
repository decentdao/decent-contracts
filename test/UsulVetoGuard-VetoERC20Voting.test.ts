import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers, network } from "hardhat";
import time from "./time";

import {
  GnosisSafe,
  GnosisSafeProxyFactory,
  OZLinearVoting,
  OZLinearVoting__factory,
  FractalUsul,
  FractalUsul__factory,
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
  predictGnosisSafeAddress,
} from "./helpers";

describe("Usul Child DAO with Usul Parent", () => {
  // Deployed contracts
  let childGnosisSafe: GnosisSafe;
  let usulVetoGuard: UsulVetoGuard;
  let usulModule: FractalUsul;
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
    usulModule = await new FractalUsul__factory(deployer).deploy(
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
        ["address", "address", "address", "address", "uint256"],
        [
          mockParentDAO.address, // owner
          vetoERC20Voting.address, // veto voting contract
          ozLinearVoting.address, // OZ linear voting contract
          usulModule.address, // Usul
          60, // Execution period in seconds
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
      // Supports IUsulVetoGuard interface
      expect(await usulVetoGuard.supportsInterface("0x8fc0183c")).to.eq(true);
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

      // Finalize the strategy
      await ozLinearVoting.finalizeStrategy(0);

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

    it("A proposal containing multiple transactions can be created and executed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1]
      );

      const tokenTransferData2 = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 2]
      );

      const tokenTransferData3 = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 3]
      );

      // Get the tx hash to submit within the proposal
      const txHash1 = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData1,
        0
      );

      const txHash2 = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData2,
        0
      );

      const txHash3 = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData3,
        0
      );

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal(
        [txHash1, txHash2, txHash3],
        ozLinearVoting.address,
        [0]
      );

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

      // Finalize the strategy
      await ozLinearVoting.finalizeStrategy(0);

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
      await usulModule.executeProposalBatch(
        0,
        [
          childVotesToken.address,
          childVotesToken.address,
          childVotesToken.address,
        ],
        [0, 0, 0],
        [tokenTransferData1, tokenTransferData2, tokenTransferData3],
        [0, 0, 0]
      );

      // Check that all three token transfer TX's were executed
      expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(
        94
      );
      expect(await childVotesToken.balanceOf(deployer.address)).to.eq(6);
    });

    it("A proposal can be created and executed, queuing the proposal also calls finalize strategy if necessary", async () => {
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

    it("A proposal cannot be executed if its execution deadline has elapsed", async () => {
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

      // Increase time so that execution period has ended
      await time.increase(time.duration.seconds(130));

      // Execute the transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData,
          0
        )
      ).to.be.revertedWith("Transaction execution period has ended");
    });

    it("A proposal cannot be queued again before its execution deadline has elapsed", async () => {
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

      // Attempt to queue the proposal again
      await expect(usulVetoGuard.queueProposal(0)).to.be.revertedWith(
        "Proposal has already been queued"
      );
    });

    it("A proposal cannot be re-queued if its execution deadline has elapsed", async () => {
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

      // Proposal execution deadline should equal current time + timelockPeriod + executionPeriod
      expect(await usulVetoGuard.getProposalExecutionDeadline(0)).to.eq(
        (await time.latest()) + 60 + 60
      );

      // Proposal queued block has been updated
      expect((await ethers.provider.getBlock("latest")).number).to.eq(
        (await usulVetoGuard.getProposalQueuedBlock(0)).toNumber()
      );

      // // Proposal is timelocked
      expect(await usulModule.state(0)).to.eq(2);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(121));

      // Proposal is ready to execute
      expect(await usulModule.state(0)).to.eq(4);

      // Execution deadline should now be in the past
      expect(await time.latest()).to.gt(
        await (await usulVetoGuard.getProposalExecutionDeadline(0)).toNumber()
      );

      // Execute the transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData,
          0
        )
      ).to.be.revertedWith("Transaction execution period has ended");

      // Attempt to re-queue the proposal
      await expect(usulVetoGuard.queueProposal(0)).to.be.revertedWith(
        "Proposal must be timelocked before queuing"
      );
    });

    it("A proposal cannot be executed if it has been finalized, but not queued", async () => {
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

      // Finalize the strategy
      await ozLinearVoting.finalizeStrategy(0);

      // The proposal is not queued

      // Proposal is timelocked
      expect(await usulModule.state(0)).to.eq(2);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await usulModule.state(0)).to.eq(4);

      // Execute the transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData,
          0
        )
      ).to.be.revertedWith("Transaction has not been queued yet");
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

      // Attempt to finalize the proposal
      await expect(ozLinearVoting.finalizeStrategy(0)).to.be.revertedWith(
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

      // Attempt to finalize proposal
      await expect(ozLinearVoting.finalizeStrategy(0)).to.be.revertedWith(
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

      // Attempt to finalize the strategy
      await expect(ozLinearVoting.finalizeStrategy(0)).to.be.revertedWith(
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

      // Finalize the strategy
      await ozLinearVoting.finalizeStrategy(0);

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

      // Finalize the strategy
      await ozLinearVoting.finalizeStrategy(0);

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

      // expect(await vetoERC20Voting.getIsVetoed(txHash)).to.eq(true);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await usulModule.state(0)).to.eq(4);

      // Execute the transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData,
          0
        )
      ).to.be.revertedWith("Transaction has been vetoed");
    });

    it("A proposal containing multiple transactions cannot be executed if one of the tx's has been vetoed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1]
      );

      const tokenTransferData2 = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 2]
      );

      const tokenTransferData3 = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 3]
      );

      // Get the tx hash to submit within the proposal
      const txHash1 = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData1,
        0
      );

      const txHash2 = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData2,
        0
      );

      const txHash3 = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData3,
        0
      );

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal(
        [txHash1, txHash2, txHash3],
        ozLinearVoting.address,
        [0]
      );

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

      // Finalize the strategy
      await ozLinearVoting.finalizeStrategy(0);

      // Queue the proposal
      await usulVetoGuard.queueProposal(0);

      // Proposal is timelocked
      expect(await usulModule.state(0)).to.eq(2);

      // Cast veto votes
      await vetoERC20Voting
        .connect(parentTokenHolder1)
        .castVetoVote(txHash1, false);
      await vetoERC20Voting
        .connect(parentTokenHolder2)
        .castVetoVote(txHash1, false);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await usulModule.state(0)).to.eq(4);

      // Execute the transaction
      await expect(
        usulModule.executeProposalBatch(
          0,
          [
            childVotesToken.address,
            childVotesToken.address,
            childVotesToken.address,
          ],
          [0, 0, 0],
          [tokenTransferData1, tokenTransferData2, tokenTransferData3],
          [0, 0, 0]
        )
      ).to.be.revertedWith("Transaction has been vetoed");
    });

    it("A proposal can be executed if it has received some veto votes, but not more than the threshold", async () => {
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

      // Finalize the strategy
      await ozLinearVoting.finalizeStrategy(0);

      // Queue the proposal
      await usulVetoGuard.queueProposal(0);

      // Proposal is timelocked
      expect(await usulModule.state(0)).to.eq(2);

      // Cast veto votes
      await vetoERC20Voting
        .connect(parentTokenHolder1)
        .castVetoVote(txHash, false);

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

    it("A vetoed transaction does not prevent another transaction from being executed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      const tokenTransferData2 = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 5]
      );

      // Get the tx hash to submit within the proposal
      const txHash1 = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData1,
        0
      );

      const txHash2 = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData2,
        0
      );

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);
      expect(await usulModule.state(1)).to.eq(5);

      await usulModule.submitProposal([txHash1], ozLinearVoting.address, [0]);
      await usulModule.submitProposal([txHash2], ozLinearVoting.address, [0]);

      // 0 => Active
      // 1 => Canceled,
      // 2 => TimeLocked,
      // 3 => Executed,
      // 4 => Executing,
      // 5 => Uninitialized

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);
      expect(await usulModule.state(1)).to.eq(0);

      // Both users vote in support of proposals
      await ozLinearVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await ozLinearVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      await ozLinearVoting.connect(childTokenHolder1).vote(1, 1, [0]);
      await ozLinearVoting.connect(childTokenHolder2).vote(1, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategies
      await ozLinearVoting.finalizeStrategy(0);
      await ozLinearVoting.finalizeStrategy(1);

      // Queue the proposals
      await usulVetoGuard.queueProposal(0);
      await usulVetoGuard.queueProposal(1);

      // Proposal is timelocked
      expect(await usulModule.state(0)).to.eq(2);
      expect(await usulModule.state(1)).to.eq(2);

      // Voters both cast veto votes on the first proposal
      await vetoERC20Voting
        .connect(parentTokenHolder1)
        .castVetoVote(txHash1, false);

      await vetoERC20Voting
        .connect(parentTokenHolder2)
        .castVetoVote(txHash1, false);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await usulModule.state(0)).to.eq(4);
      expect(await usulModule.state(1)).to.eq(4);

      expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(
        100
      );
      expect(await childVotesToken.balanceOf(deployer.address)).to.eq(0);

      // This proposal should fail due to veto
      await expect(
        usulModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData1,
          0
        )
      ).to.be.revertedWith("Transaction has been vetoed");

      // Execute the transaction
      await usulModule.executeProposalByIndex(
        1,
        childVotesToken.address,
        0,
        tokenTransferData2,
        0
      );

      expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(
        95
      );
      expect(await childVotesToken.balanceOf(deployer.address)).to.eq(5);
    });

    it("A vetoer cannot cast veto votes more than once", async () => {
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

      // Finalize the strategy
      await ozLinearVoting.finalizeStrategy(0);

      // Queue the proposal
      await usulVetoGuard.queueProposal(0);

      // Proposal is timelocked
      expect(await usulModule.state(0)).to.eq(2);

      // Cast veto votes
      await vetoERC20Voting
        .connect(parentTokenHolder1)
        .castVetoVote(txHash, false);

      // User attempts to vote twice
      await expect(
        vetoERC20Voting.connect(parentTokenHolder1).castVetoVote(txHash, false)
      ).to.be.revertedWith("User has already voted");
    });

    it("A veto vote cannot be cast if the transaction has not been queued yet", async () => {
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

      // Cast veto votes
      await expect(
        vetoERC20Voting.connect(parentTokenHolder1).castVetoVote(txHash, false)
      ).to.be.revertedWith("Transaction has not yet been queued");
    });

    it("A frozen DAO cannot execute any transaction", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      const tokenTransferData2 = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 5]
      );

      const tokenTransferData3 = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 4]
      );

      // Get the tx hash to submit within the proposal
      const txHash1 = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData1,
        0
      );

      const txHash2 = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData2,
        0
      );

      const txHash3 = await usulModule.getTransactionHash(
        childVotesToken.address,
        0,
        tokenTransferData3,
        0
      );

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);
      expect(await usulModule.state(1)).to.eq(5);
      expect(await usulModule.state(2)).to.eq(5);

      await usulModule.submitProposal([txHash1], ozLinearVoting.address, [0]);
      await usulModule.submitProposal([txHash2], ozLinearVoting.address, [0]);
      await usulModule.submitProposal([txHash3], ozLinearVoting.address, [0]);

      // 0 => Active
      // 1 => Canceled,
      // 2 => TimeLocked,
      // 3 => Executed,
      // 4 => Executing,
      // 5 => Uninitialized

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);
      expect(await usulModule.state(1)).to.eq(0);
      expect(await usulModule.state(2)).to.eq(0);

      // Both users vote in support of proposals
      await ozLinearVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await ozLinearVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      await ozLinearVoting.connect(childTokenHolder1).vote(1, 1, [0]);
      await ozLinearVoting.connect(childTokenHolder2).vote(1, 1, [0]);

      await ozLinearVoting.connect(childTokenHolder1).vote(2, 1, [0]);
      await ozLinearVoting.connect(childTokenHolder2).vote(2, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategies
      await ozLinearVoting.finalizeStrategy(0);
      await ozLinearVoting.finalizeStrategy(1);
      await ozLinearVoting.finalizeStrategy(2);

      // Queue the proposals
      await usulVetoGuard.queueProposal(0);
      await usulVetoGuard.queueProposal(1);
      await usulVetoGuard.queueProposal(2);

      // Proposal is timelocked
      expect(await usulModule.state(0)).to.eq(2);
      expect(await usulModule.state(1)).to.eq(2);
      expect(await usulModule.state(2)).to.eq(2);

      expect(await vetoERC20Voting.isFrozen()).to.eq(false);

      // Voters both cast veto votes on the first proposal, and also cast freeze votes
      await vetoERC20Voting
        .connect(parentTokenHolder1)
        .castVetoVote(txHash1, true);

      await vetoERC20Voting
        .connect(parentTokenHolder2)
        .castVetoVote(txHash1, true);

      expect(await vetoERC20Voting.isFrozen()).to.eq(true);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await usulModule.state(0)).to.eq(4);
      expect(await usulModule.state(1)).to.eq(4);
      expect(await usulModule.state(2)).to.eq(4);

      // This proposal should fail due to veto
      await expect(
        usulModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData1,
          0
        )
      ).to.be.revertedWith("Transaction has been vetoed");

      // This proposal should fail due to freeze
      await expect(
        usulModule.executeProposalByIndex(
          1,
          childVotesToken.address,
          0,
          tokenTransferData2,
          0
        )
      ).to.be.revertedWith("DAO is frozen");

      // This proposal should fail due to freeze
      await expect(
        usulModule.executeProposalByIndex(
          2,
          childVotesToken.address,
          0,
          tokenTransferData3,
          0
        )
      ).to.be.revertedWith("DAO is frozen");
    });
  });

  it("A DAO can be frozen independently of a veto", async () => {
    // Create transaction to transfer tokens to the deployer
    const tokenTransferData1 = childVotesToken.interface.encodeFunctionData(
      "transfer",
      [deployer.address, 10]
    );

    const tokenTransferData2 = childVotesToken.interface.encodeFunctionData(
      "transfer",
      [deployer.address, 5]
    );

    const tokenTransferData3 = childVotesToken.interface.encodeFunctionData(
      "transfer",
      [deployer.address, 4]
    );

    // Get the tx hash to submit within the proposal
    const txHash1 = await usulModule.getTransactionHash(
      childVotesToken.address,
      0,
      tokenTransferData1,
      0
    );

    const txHash2 = await usulModule.getTransactionHash(
      childVotesToken.address,
      0,
      tokenTransferData2,
      0
    );

    const txHash3 = await usulModule.getTransactionHash(
      childVotesToken.address,
      0,
      tokenTransferData3,
      0
    );

    // Proposal is uninitialized
    expect(await usulModule.state(0)).to.eq(5);
    expect(await usulModule.state(1)).to.eq(5);
    expect(await usulModule.state(2)).to.eq(5);

    await usulModule.submitProposal([txHash1], ozLinearVoting.address, [0]);
    await usulModule.submitProposal([txHash2], ozLinearVoting.address, [0]);
    await usulModule.submitProposal([txHash3], ozLinearVoting.address, [0]);

    // 0 => Active
    // 1 => Canceled,
    // 2 => TimeLocked,
    // 3 => Executed,
    // 4 => Executing,
    // 5 => Uninitialized

    // Proposal is active
    expect(await usulModule.state(0)).to.eq(0);
    expect(await usulModule.state(1)).to.eq(0);
    expect(await usulModule.state(2)).to.eq(0);

    // Both users vote in support of proposals
    await ozLinearVoting.connect(childTokenHolder1).vote(0, 1, [0]);
    await ozLinearVoting.connect(childTokenHolder2).vote(0, 1, [0]);

    await ozLinearVoting.connect(childTokenHolder1).vote(1, 1, [0]);
    await ozLinearVoting.connect(childTokenHolder2).vote(1, 1, [0]);

    await ozLinearVoting.connect(childTokenHolder1).vote(2, 1, [0]);
    await ozLinearVoting.connect(childTokenHolder2).vote(2, 1, [0]);

    // Increase time so that voting period has ended
    await time.increase(time.duration.seconds(60));

    // Finalize the strategies
    await ozLinearVoting.finalizeStrategy(0);
    await ozLinearVoting.finalizeStrategy(1);
    await ozLinearVoting.finalizeStrategy(2);

    // Queue the proposals
    await usulVetoGuard.queueProposal(0);
    await usulVetoGuard.queueProposal(1);
    await usulVetoGuard.queueProposal(2);

    // Proposal is timelocked
    expect(await usulModule.state(0)).to.eq(2);
    expect(await usulModule.state(1)).to.eq(2);
    expect(await usulModule.state(2)).to.eq(2);

    expect(await vetoERC20Voting.isFrozen()).to.eq(false);

    // Voters both cast veto votes on the first proposal, and also cast freeze votes
    await vetoERC20Voting.connect(parentTokenHolder1).castFreezeVote();

    await vetoERC20Voting.connect(parentTokenHolder2).castFreezeVote();

    expect(await vetoERC20Voting.isFrozen()).to.eq(true);

    // Increase time so that timelock period has ended
    await time.increase(time.duration.seconds(60));

    // Proposal is ready to execute
    expect(await usulModule.state(0)).to.eq(4);
    expect(await usulModule.state(1)).to.eq(4);
    expect(await usulModule.state(2)).to.eq(4);

    // This proposal should fail due to freeze
    await expect(
      usulModule.executeProposalByIndex(
        0,
        childVotesToken.address,
        0,
        tokenTransferData1,
        0
      )
    ).to.be.revertedWith("DAO is frozen");

    // This proposal should fail due to freeze
    await expect(
      usulModule.executeProposalByIndex(
        1,
        childVotesToken.address,
        0,
        tokenTransferData2,
        0
      )
    ).to.be.revertedWith("DAO is frozen");

    // This proposal should fail due to freeze
    await expect(
      usulModule.executeProposalByIndex(
        2,
        childVotesToken.address,
        0,
        tokenTransferData3,
        0
      )
    ).to.be.revertedWith("DAO is frozen");
  });

  it("A proposal can still be executed if a freeze proposal has been created, but threshold has not been met", async () => {
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

    // Finalize the strategy
    await ozLinearVoting.finalizeStrategy(0);

    // Queue the proposal
    await usulVetoGuard.queueProposal(0);

    // Proposal is timelocked
    expect(await usulModule.state(0)).to.eq(2);

    expect(await vetoERC20Voting.isFrozen()).to.eq(false);

    // Voters both cast veto votes on the first proposal, and also cast freeze votes
    await vetoERC20Voting.connect(parentTokenHolder1).castFreezeVote();

    expect(await vetoERC20Voting.isFrozen()).to.eq(false);

    // Increase time so that timelock period has ended
    await time.increase(time.duration.seconds(60));

    // Proposal is ready to execute
    expect(await usulModule.state(0)).to.eq(4);

    expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(100);
    expect(await childVotesToken.balanceOf(deployer.address)).to.eq(0);

    // Execute the transaction
    await usulModule.executeProposalByIndex(
      0,
      childVotesToken.address,
      0,
      tokenTransferData,
      0
    );

    expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(90);
    expect(await childVotesToken.balanceOf(deployer.address)).to.eq(10);
  });

  it("A frozen DAO is automatically unfrozen after the freeze duration is over", async () => {
    // Create transaction to transfer tokens to the deployer
    const tokenTransferData1 = childVotesToken.interface.encodeFunctionData(
      "transfer",
      [deployer.address, 10]
    );

    const tokenTransferData2 = childVotesToken.interface.encodeFunctionData(
      "transfer",
      [deployer.address, 5]
    );

    // Get the tx hash to submit within the proposal
    const txHash1 = await usulModule.getTransactionHash(
      childVotesToken.address,
      0,
      tokenTransferData1,
      0
    );

    const txHash2 = await usulModule.getTransactionHash(
      childVotesToken.address,
      0,
      tokenTransferData2,
      0
    );

    // Proposal is uninitialized
    expect(await usulModule.state(0)).to.eq(5);
    expect(await usulModule.state(1)).to.eq(5);

    await usulModule.submitProposal([txHash1], ozLinearVoting.address, [0]);
    await usulModule.submitProposal([txHash2], ozLinearVoting.address, [0]);

    // 0 => Active
    // 1 => Canceled,
    // 2 => TimeLocked,
    // 3 => Executed,
    // 4 => Executing,
    // 5 => Uninitialized

    // Proposal is active
    expect(await usulModule.state(0)).to.eq(0);
    expect(await usulModule.state(1)).to.eq(0);

    // Both users vote in support of proposals
    await ozLinearVoting.connect(childTokenHolder1).vote(0, 1, [0]);
    await ozLinearVoting.connect(childTokenHolder2).vote(0, 1, [0]);

    await ozLinearVoting.connect(childTokenHolder1).vote(1, 1, [0]);
    await ozLinearVoting.connect(childTokenHolder2).vote(1, 1, [0]);

    // Increase time so that voting period has ended
    await time.increase(time.duration.seconds(60));

    // Queue the proposals
    await usulVetoGuard.queueProposal(0);
    await usulVetoGuard.queueProposal(1);

    // Proposal is timelocked
    expect(await usulModule.state(0)).to.eq(2);
    expect(await usulModule.state(1)).to.eq(2);

    expect(await vetoERC20Voting.isFrozen()).to.eq(false);

    // Voters both cast veto votes on the first proposal, and also cast freeze votes
    await vetoERC20Voting.connect(parentTokenHolder1).castFreezeVote();

    await vetoERC20Voting.connect(parentTokenHolder2).castFreezeVote();

    expect(await vetoERC20Voting.isFrozen()).to.eq(true);

    // Increase time so that timelock period has ended
    await time.increase(time.duration.seconds(60));

    // Proposal is ready to execute
    expect(await usulModule.state(0)).to.eq(4);
    expect(await usulModule.state(1)).to.eq(4);

    // This proposal should fail due to freeze
    await expect(
      usulModule.executeProposalByIndex(
        0,
        childVotesToken.address,
        0,
        tokenTransferData1,
        0
      )
    ).to.be.revertedWith("DAO is frozen");

    // This proposal should fail due to freeze
    await expect(
      usulModule.executeProposalByIndex(
        1,
        childVotesToken.address,
        0,
        tokenTransferData2,
        0
      )
    ).to.be.revertedWith("DAO is frozen");

    // Increase time so that freeze has ended
    for (let i = 0; i <= 100; i++) {
      await network.provider.send("evm_mine");
    }

    const tokenTransferData3 = childVotesToken.interface.encodeFunctionData(
      "transfer",
      [deployer.address, 4]
    );

    const txHash3 = await usulModule.getTransactionHash(
      childVotesToken.address,
      0,
      tokenTransferData3,
      0
    );

    // Proposal is uninitialized
    expect(await usulModule.state(2)).to.eq(5);

    await usulModule.submitProposal([txHash3], ozLinearVoting.address, [0]);

    expect(await usulModule.state(2)).to.eq(0);

    await ozLinearVoting.connect(childTokenHolder1).vote(2, 1, [0]);
    await ozLinearVoting.connect(childTokenHolder2).vote(2, 1, [0]);

    // Increase time so that voting period has ended
    await time.increase(time.duration.seconds(60));

    // Queue the proposal
    await usulVetoGuard.queueProposal(2);

    // Proposal is timelocked
    expect(await usulModule.state(2)).to.eq(2);

    // Increase time so that timelock period has ended
    await time.increase(time.duration.seconds(60));

    // Proposal is ready to execute
    expect(await usulModule.state(2)).to.eq(4);

    expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(100);
    expect(await childVotesToken.balanceOf(deployer.address)).to.eq(0);

    // Execute the transaction
    await usulModule.executeProposalByIndex(
      2,
      childVotesToken.address,
      0,
      tokenTransferData3,
      0
    );

    expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(96);
    expect(await childVotesToken.balanceOf(deployer.address)).to.eq(4);
  });

  it("A frozen DAO can be defrosted by its owner, and continue to execute TX's", async () => {
    // Create transaction to transfer tokens to the deployer
    const tokenTransferData1 = childVotesToken.interface.encodeFunctionData(
      "transfer",
      [deployer.address, 10]
    );

    const tokenTransferData2 = childVotesToken.interface.encodeFunctionData(
      "transfer",
      [deployer.address, 5]
    );

    const tokenTransferData3 = childVotesToken.interface.encodeFunctionData(
      "transfer",
      [deployer.address, 4]
    );

    // Get the tx hash to submit within the proposal
    const txHash1 = await usulModule.getTransactionHash(
      childVotesToken.address,
      0,
      tokenTransferData1,
      0
    );

    const txHash2 = await usulModule.getTransactionHash(
      childVotesToken.address,
      0,
      tokenTransferData2,
      0
    );

    const txHash3 = await usulModule.getTransactionHash(
      childVotesToken.address,
      0,
      tokenTransferData3,
      0
    );

    // Proposal is uninitialized
    expect(await usulModule.state(0)).to.eq(5);
    expect(await usulModule.state(1)).to.eq(5);
    expect(await usulModule.state(2)).to.eq(5);

    await usulModule.submitProposal([txHash1], ozLinearVoting.address, [0]);
    await usulModule.submitProposal([txHash2], ozLinearVoting.address, [0]);
    await usulModule.submitProposal([txHash3], ozLinearVoting.address, [0]);

    // 0 => Active
    // 1 => Canceled,
    // 2 => TimeLocked,
    // 3 => Executed,
    // 4 => Executing,
    // 5 => Uninitialized

    // Proposal is active
    expect(await usulModule.state(0)).to.eq(0);
    expect(await usulModule.state(1)).to.eq(0);
    expect(await usulModule.state(2)).to.eq(0);

    // Both users vote in support of proposals
    await ozLinearVoting.connect(childTokenHolder1).vote(0, 1, [0]);
    await ozLinearVoting.connect(childTokenHolder2).vote(0, 1, [0]);

    await ozLinearVoting.connect(childTokenHolder1).vote(1, 1, [0]);
    await ozLinearVoting.connect(childTokenHolder2).vote(1, 1, [0]);

    await ozLinearVoting.connect(childTokenHolder1).vote(2, 1, [0]);
    await ozLinearVoting.connect(childTokenHolder2).vote(2, 1, [0]);

    // Increase time so that voting period has ended
    await time.increase(time.duration.seconds(60));

    // Finalize the strategies
    await ozLinearVoting.finalizeStrategy(0);
    await ozLinearVoting.finalizeStrategy(1);
    await ozLinearVoting.finalizeStrategy(2);

    // Queue the proposals
    await usulVetoGuard.queueProposal(0);
    await usulVetoGuard.queueProposal(1);
    await usulVetoGuard.queueProposal(2);

    // Proposal is timelocked
    expect(await usulModule.state(0)).to.eq(2);
    expect(await usulModule.state(1)).to.eq(2);
    expect(await usulModule.state(2)).to.eq(2);

    expect(await vetoERC20Voting.isFrozen()).to.eq(false);

    // Voters both cast veto votes on the first proposal, and also cast freeze votes
    await vetoERC20Voting.connect(parentTokenHolder1).castFreezeVote();

    await vetoERC20Voting.connect(parentTokenHolder2).castFreezeVote();

    expect(await vetoERC20Voting.isFrozen()).to.eq(true);

    // Increase time so that timelock period has ended
    await time.increase(time.duration.seconds(60));

    // Proposal is ready to execute
    expect(await usulModule.state(0)).to.eq(4);
    expect(await usulModule.state(1)).to.eq(4);
    expect(await usulModule.state(2)).to.eq(4);

    // This proposal should fail due to freeze
    await expect(
      usulModule.executeProposalByIndex(
        0,
        childVotesToken.address,
        0,
        tokenTransferData1,
        0
      )
    ).to.be.revertedWith("DAO is frozen");

    // This proposal should fail due to freeze
    await expect(
      usulModule.executeProposalByIndex(
        1,
        childVotesToken.address,
        0,
        tokenTransferData2,
        0
      )
    ).to.be.revertedWith("DAO is frozen");

    // This proposal should fail due to freeze
    await expect(
      usulModule.executeProposalByIndex(
        2,
        childVotesToken.address,
        0,
        tokenTransferData3,
        0
      )
    ).to.be.revertedWith("DAO is frozen");

    // Parent DAO defrosts the child
    await vetoERC20Voting.connect(mockParentDAO).defrost();

    // Child DAO is now unfrozen
    expect(await vetoERC20Voting.isFrozen()).to.eq(false);

    expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(100);
    expect(await childVotesToken.balanceOf(deployer.address)).to.eq(0);

    // Execute the transaction
    await usulModule.executeProposalByIndex(
      0,
      childVotesToken.address,
      0,
      tokenTransferData1,
      0
    );

    expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(90);
    expect(await childVotesToken.balanceOf(deployer.address)).to.eq(10);
  });
});
