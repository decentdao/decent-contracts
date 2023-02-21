import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, network } from "hardhat";
import time from "./time";

import {
  GnosisSafe,
  GnosisSafeProxyFactory,
  LinearTokenVoting,
  LinearTokenVoting__factory,
  Azorius,
  Azorius__factory,
  AzoriusVetoGuard,
  AzoriusVetoGuard__factory,
  VetoMultisigVoting,
  VetoMultisigVoting__factory,
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

describe("Azorius Child DAO with Multisig parent", () => {
  // Deployed contracts
  let parentGnosisSafe: Contract;
  let childGnosisSafe: GnosisSafe;
  let azoriusVetoGuard: AzoriusVetoGuard;
  let azoriusModule: Azorius;
  let linearTokenVoting: LinearTokenVoting;
  let vetoMultisigVoting: VetoMultisigVoting;
  let childVotesToken: VotesToken;
  let gnosisSafeProxyFactory: GnosisSafeProxyFactory;

  // Wallets
  let deployer: SignerWithAddress;
  let childSafeOwner: SignerWithAddress;
  let parentMultisigOwner1: SignerWithAddress;
  let parentMultisigOwner2: SignerWithAddress;
  let parentMultisigOwner3: SignerWithAddress;
  let childTokenHolder1: SignerWithAddress;
  let childTokenHolder2: SignerWithAddress;
  let azoriusModuleOwner: SignerWithAddress;
  let vetoMultisigVotingOwner: SignerWithAddress;

  // Gnosis
  let createChildGnosisSetupCalldata: string;
  let createParentGnosisSetupCalldata: string;

  const gnosisFactoryAddress = "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2";
  const gnosisSingletonAddress = "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552";
  const parentThreshold = 2;
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
      parentMultisigOwner1,
      parentMultisigOwner2,
      parentMultisigOwner3,
      childTokenHolder1,
      childTokenHolder2,
      azoriusModuleOwner,
      vetoMultisigVotingOwner,
    ] = await ethers.getSigners();

    // Deploy Gnosis Safe Proxy factory
    gnosisSafeProxyFactory = await ethers.getContractAt(
      "GnosisSafeProxyFactory",
      gnosisFactoryAddress
    );

    createParentGnosisSetupCalldata = ifaceSafe.encodeFunctionData("setup", [
      [
        parentMultisigOwner1.address,
        parentMultisigOwner2.address,
        parentMultisigOwner3.address,
      ],
      parentThreshold,
      ethers.constants.AddressZero,
      ethers.constants.HashZero,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      0,
      ethers.constants.AddressZero,
    ]);

    createChildGnosisSetupCalldata = ifaceSafe.encodeFunctionData("setup", [
      [childSafeOwner.address],
      1,
      ethers.constants.AddressZero,
      ethers.constants.HashZero,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      0,
      ethers.constants.AddressZero,
    ]);

    const predictedParentGnosisSafeAddress = await predictGnosisSafeAddress(
      gnosisSafeProxyFactory.address,
      createParentGnosisSetupCalldata,
      saltNum,
      gnosisSingletonAddress,
      gnosisSafeProxyFactory
    );

    const predictedChildGnosisSafeAddress = await predictGnosisSafeAddress(
      gnosisSafeProxyFactory.address,
      createChildGnosisSetupCalldata,
      saltNum,
      gnosisSingletonAddress,
      gnosisSafeProxyFactory
    );

    // Deploy Parent Gnosis Safe
    await gnosisSafeProxyFactory.createProxyWithNonce(
      gnosisSingletonAddress,
      createParentGnosisSetupCalldata,
      saltNum
    );

    // Deploy Child Gnosis Safe
    await gnosisSafeProxyFactory.createProxyWithNonce(
      gnosisSingletonAddress,
      createChildGnosisSetupCalldata,
      saltNum
    );

    // Get Parent Gnosis Safe
    parentGnosisSafe = await ethers.getContractAt(
      "GnosisSafe",
      predictedParentGnosisSafeAddress
    );

    // Get Child Gnosis Safe
    childGnosisSafe = await ethers.getContractAt(
      "GnosisSafe",
      predictedChildGnosisSafeAddress
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

    // Token holders delegate their votes to themselves
    await childVotesToken
      .connect(childTokenHolder1)
      .delegate(childTokenHolder1.address);
    await childVotesToken
      .connect(childTokenHolder2)
      .delegate(childTokenHolder2.address);

    // Deploy Azorius module
    azoriusModule = await new Azorius__factory(deployer).deploy(
      azoriusModuleOwner.address,
      childGnosisSafe.address,
      childGnosisSafe.address,
      [],
      60 // timelock period in seconds
    );

    // Deploy Linear Token Voting Strategy
    linearTokenVoting = await new LinearTokenVoting__factory(deployer).deploy(
      parentGnosisSafe.address, // owner
      childVotesToken.address, // governance token
      azoriusModule.address, // usul module
      60, // voting period in seconds
      500000, // quorom numerator, denominator is 1,000,000
      "Voting" // name
    );

    // Enable the OZ Linear Voting strategy on Azorius
    await azoriusModule
      .connect(azoriusModuleOwner)
      .enableStrategy(linearTokenVoting.address);

    // Deploy VetoMultisigVoting contract
    vetoMultisigVoting = await new VetoMultisigVoting__factory(
      deployer
    ).deploy();

    // Deploy and setUp Azorius Veto Guard contract
    azoriusVetoGuard = await new AzoriusVetoGuard__factory(deployer).deploy();

    await azoriusVetoGuard.setUp(
      abiCoder.encode(
        ["address", "address", "address", "address", "uint256"],
        [
          vetoMultisigVotingOwner.address, // owner
          vetoMultisigVoting.address, // veto voting contract
          linearTokenVoting.address, // OZ linear voting contract
          azoriusModule.address, // Azorius
          60, // Execution period in seconds
        ]
      )
    );

    // Setup vetoMultisigVoting contract
    await vetoMultisigVoting.setUp(
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
          vetoMultisigVotingOwner.address, // owner
          2, // veto votes threshold
          2, // freeze votes threshold
          10, // freeze proposal duration in blocks
          200, // freeze duration in blocks
          parentGnosisSafe.address,
          azoriusVetoGuard.address,
        ]
      )
    );

    // Create transaction on child Gnosis Safe to setup Azorius module
    const enableAzoriusModuleData =
      childGnosisSafe.interface.encodeFunctionData("enableModule", [
        azoriusModule.address,
      ]);

    const enableAzoriusModuleTx = buildSafeTransaction({
      to: childGnosisSafe.address,
      data: enableAzoriusModuleData,
      safeTxGas: 1000000,
      nonce: (await childGnosisSafe.nonce()).toNumber(),
    });

    const sigs = [
      await safeSignTypedData(
        childSafeOwner,
        childGnosisSafe,
        enableAzoriusModuleTx
      ),
    ];

    const signatureBytes = buildSignatureBytes(sigs);

    // Execute transaction that adds the Azorius module to the Safe
    await expect(
      childGnosisSafe.execTransaction(
        enableAzoriusModuleTx.to,
        enableAzoriusModuleTx.value,
        enableAzoriusModuleTx.data,
        enableAzoriusModuleTx.operation,
        enableAzoriusModuleTx.safeTxGas,
        enableAzoriusModuleTx.baseGas,
        enableAzoriusModuleTx.gasPrice,
        enableAzoriusModuleTx.gasToken,
        enableAzoriusModuleTx.refundReceiver,
        signatureBytes
      )
    ).to.emit(childGnosisSafe, "ExecutionSuccess");

    // todo: set this with gnosis parent tx
    // Set the Azorius Veto Guard as the Guard on the Azorius Module
    await azoriusModule
      .connect(azoriusModuleOwner)
      .setGuard(azoriusVetoGuard.address);

    // Gnosis Safe received the 100 tokens
    expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(100);
  });

  describe("VetoGuard Functionality", () => {
    it("Supports ERC-165", async () => {
      // Supports IAzoriusVetoGuard interface
      expect(await azoriusVetoGuard.supportsInterface("0xa04f1a4e")).to.eq(
        true
      );
      // Supports IGuard interface
      expect(await azoriusVetoGuard.supportsInterface("0xe6d7a83a")).to.eq(
        true
      );
      // Supports IERC-165 interface
      expect(await azoriusVetoGuard.supportsInterface("0x01ffc9a7")).to.eq(
        true
      );
      // Doesn't support random interface
      expect(await azoriusVetoGuard.supportsInterface("0x00000000")).to.eq(
        false
      );
    });

    it("A proposal can be created and executed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      const proposalTransaction = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategy
      await linearTokenVoting.timelockProposal(0);

      // Timelock the proposal
      await azoriusVetoGuard.timelockProposal(0);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);

      expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(
        100
      );
      expect(await childVotesToken.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azoriusModule.executeProposalByIndex(
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

      const proposalTransactions = [
        {
          to: childVotesToken.address,
          value: BigNumber.from(0),
          data: tokenTransferData1,
          operation: 0,
        },
        {
          to: childVotesToken.address,
          value: BigNumber.from(0),
          data: tokenTransferData2,
          operation: 0,
        },
        {
          to: childVotesToken.address,
          value: BigNumber.from(0),
          data: tokenTransferData3,
          operation: 0,
        },
      ];

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        proposalTransactions,
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategy
      await linearTokenVoting.timelockProposal(0);

      // Timelock the proposal
      await azoriusVetoGuard.timelockProposal(0);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);

      expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(
        100
      );
      expect(await childVotesToken.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azoriusModule.executeProposalBatch(
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

      const proposalTransaction = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Timelock the proposal
      await azoriusVetoGuard.timelockProposal(0);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);

      expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(
        100
      );
      expect(await childVotesToken.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azoriusModule.executeProposalByIndex(
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

      const proposalTransaction = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Timelock the proposal
      await azoriusVetoGuard.timelockProposal(0);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      // Increase time so that execution period has ended
      await time.increase(time.duration.seconds(130));

      // Execute the transaction
      await expect(
        azoriusModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData,
          0
        )
      ).to.be.revertedWith("Transaction execution period has ended");
    });

    it("A proposal cannot be timelocked again before its execution deadline has elapsed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      const proposalTransaction = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Timelock the proposal
      await azoriusVetoGuard.timelockProposal(0);

      // Attempt to timelock the proposal again
      await expect(azoriusVetoGuard.timelockProposal(0)).to.be.revertedWith(
        "Proposal has already been timelocked"
      );
    });

    it("A proposal cannot be re-timelocked if its execution deadline has elapsed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      const proposalTransaction = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Timelock the proposal
      await azoriusVetoGuard.timelockProposal(0);

      // Proposal execution deadline should equal current time + timelockPeriod + executionPeriod
      expect(await azoriusVetoGuard.getProposalExecutionDeadline(0)).to.eq(
        (await time.latest()) + 60 + 60
      );

      // Proposal timelocked block has been updated
      expect((await ethers.provider.getBlock("latest")).number).to.eq(
        (await azoriusVetoGuard.getProposalTimelockedBlock(0)).toNumber()
      );

      // // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(121));

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);

      // Execution deadline should now be in the past
      expect(await time.latest()).to.gt(
        await (
          await azoriusVetoGuard.getProposalExecutionDeadline(0)
        ).toNumber()
      );

      // Execute the transaction
      await expect(
        azoriusModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData,
          0
        )
      ).to.be.revertedWith("Transaction execution period has ended");

      // Attempt to re-timelocked the proposal
      await expect(azoriusVetoGuard.timelockProposal(0)).to.be.revertedWith(
        "Proposal timelock failed"
      );
    });

    it("A proposal cannot be executed if it has been finalized, but not timelocked", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      const proposalTransaction = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategy
      await linearTokenVoting.timelockProposal(0);

      // The proposal is not timelocked

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);

      // Execute the transaction
      await expect(
        azoriusModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData,
          0
        )
      ).to.be.revertedWith("Transaction has not been timelocked yet");
    });

    it("A transaction cannot be executed if it hasn't yet been timelocked", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      const proposalTransaction = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Execute the transaction
      await expect(
        azoriusModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData,
          0
        )
      ).to.be.revertedWith("Proposal must be in the executable state");
    });

    it("A proposal cannot be timelocked if quorum hasn't been reached", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      const proposalTransaction = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Attempt to finalize the proposal
      await expect(linearTokenVoting.timelockProposal(0)).to.be.revertedWith(
        "Proposal is not passed"
      );
    });

    it("A proposal cannot be timelocked if no votes exceed yes votes", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      const proposalTransaction = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 0, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 0, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Attempt to finalize proposal
      await expect(linearTokenVoting.timelockProposal(0)).to.be.revertedWith(
        "Proposal is not passed"
      );
    });

    it("A proposal cannot be timelocked if its voting period hasn't ended yet", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      const proposalTransaction = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Attempt to finalize the strategy
      await expect(linearTokenVoting.timelockProposal(0)).to.be.revertedWith(
        "Proposal is not passed"
      );
    });

    it("A proposal cannot be executed if it is still timelocked", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      const proposalTransaction = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategy
      await linearTokenVoting.timelockProposal(0);

      // Timelock the proposal
      await azoriusVetoGuard.timelockProposal(0);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      // Do not wait for timelock to end, but attempt to execute the transaction
      await expect(
        azoriusModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData,
          0
        )
      ).to.be.revertedWith("Proposal must be in the executable state");
    });

    it("A transaction cannot be executed if it has been vetoed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      // Get the tx hash to submit within the proposal
      const txHash = await azoriusModule.getTxHash(
        childVotesToken.address,
        0,
        tokenTransferData,
        0
      );

      const proposalTransaction = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategy
      await linearTokenVoting.timelockProposal(0);

      // Timelock the proposal
      await azoriusVetoGuard.timelockProposal(0);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      // Cast veto votes
      await vetoMultisigVoting
        .connect(parentMultisigOwner1)
        .castVetoVote(txHash, false);
      await vetoMultisigVoting
        .connect(parentMultisigOwner2)
        .castVetoVote(txHash, false);

      expect(await vetoMultisigVoting.getIsVetoed(txHash)).to.eq(true);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);

      // Execute the transaction
      await expect(
        azoriusModule.executeProposalByIndex(
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
      const txHash1 = await azoriusModule.getTxHash(
        childVotesToken.address,
        0,
        tokenTransferData1,
        0
      );

      const proposalTransactions = [
        {
          to: childVotesToken.address,
          value: BigNumber.from(0),
          data: tokenTransferData1,
          operation: 0,
        },
        {
          to: childVotesToken.address,
          value: BigNumber.from(0),
          data: tokenTransferData2,
          operation: 0,
        },
        {
          to: childVotesToken.address,
          value: BigNumber.from(0),
          data: tokenTransferData3,
          operation: 0,
        },
      ];

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        proposalTransactions,
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategy
      await linearTokenVoting.timelockProposal(0);

      // Timelock the proposal
      await azoriusVetoGuard.timelockProposal(0);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      // Cast veto votes
      await vetoMultisigVoting
        .connect(parentMultisigOwner1)
        .castVetoVote(txHash1, false);
      await vetoMultisigVoting
        .connect(parentMultisigOwner2)
        .castVetoVote(txHash1, false);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);

      // Execute the transaction
      await expect(
        azoriusModule.executeProposalBatch(
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
      const txHash = await azoriusModule.getTxHash(
        childVotesToken.address,
        0,
        tokenTransferData,
        0
      );

      const proposalTransaction = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategy
      await linearTokenVoting.timelockProposal(0);

      // Timelock the proposal
      await azoriusVetoGuard.timelockProposal(0);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      // Cast veto votes
      await vetoMultisigVoting
        .connect(parentMultisigOwner1)
        .castVetoVote(txHash, false);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);

      expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(
        100
      );
      expect(await childVotesToken.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azoriusModule.executeProposalByIndex(
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
      const txHash1 = await azoriusModule.getTxHash(
        childVotesToken.address,
        0,
        tokenTransferData1,
        0
      );

      const proposalTransaction1 = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData1,
        operation: 0,
      };

      const proposalTransaction2 = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData2,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction1],
        ""
      );

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction2],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);
      expect(await azoriusModule.proposalState(1)).to.eq(0);

      // Both users vote in support of proposals
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      await linearTokenVoting.connect(childTokenHolder1).vote(1, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(1, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategies
      await linearTokenVoting.timelockProposal(0);
      await linearTokenVoting.timelockProposal(1);

      // Timelock the proposals
      await azoriusVetoGuard.timelockProposal(0);
      await azoriusVetoGuard.timelockProposal(1);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);
      expect(await azoriusModule.proposalState(1)).to.eq(1);

      // Voters both cast veto votes on the first proposal
      await vetoMultisigVoting
        .connect(parentMultisigOwner1)
        .castVetoVote(txHash1, false);

      await vetoMultisigVoting
        .connect(parentMultisigOwner2)
        .castVetoVote(txHash1, false);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);
      expect(await azoriusModule.proposalState(1)).to.eq(2);

      expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(
        100
      );
      expect(await childVotesToken.balanceOf(deployer.address)).to.eq(0);

      // This proposal should fail due to veto
      await expect(
        azoriusModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData1,
          0
        )
      ).to.be.revertedWith("Transaction has been vetoed");

      // Execute the transaction
      await azoriusModule.executeProposalByIndex(
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
      const txHash = await azoriusModule.getTxHash(
        childVotesToken.address,
        0,
        tokenTransferData,
        0
      );

      const proposalTransaction = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategy
      await linearTokenVoting.timelockProposal(0);

      // Timelock the proposal
      await azoriusVetoGuard.timelockProposal(0);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      // Cast veto votes
      await vetoMultisigVoting
        .connect(parentMultisigOwner1)
        .castVetoVote(txHash, false);

      // User attempts to vote twice
      await expect(
        vetoMultisigVoting
          .connect(parentMultisigOwner1)
          .castVetoVote(txHash, false)
      ).to.be.revertedWith("User has already voted");
    });

    it("A veto vote cannot be cast if the transaction has not been timelocked yet", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      // Get the tx hash to submit within the proposal
      const txHash = await azoriusModule.getTxHash(
        childVotesToken.address,
        0,
        tokenTransferData,
        0
      );

      const proposalTransaction = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Cast veto votes
      await expect(
        vetoMultisigVoting
          .connect(parentMultisigOwner1)
          .castVetoVote(txHash, false)
      ).to.be.revertedWith("Transaction has not yet been timelocked");
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
      const txHash1 = await azoriusModule.getTxHash(
        childVotesToken.address,
        0,
        tokenTransferData1,
        0
      );

      const proposalTransaction1 = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData1,
        operation: 0,
      };

      const proposalTransaction2 = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData2,
        operation: 0,
      };

      const proposalTransaction3 = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData3,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction1],
        ""
      );
      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction2],
        ""
      );
      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction3],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);
      expect(await azoriusModule.proposalState(1)).to.eq(0);
      expect(await azoriusModule.proposalState(2)).to.eq(0);

      // Both users vote in support of proposals
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      await linearTokenVoting.connect(childTokenHolder1).vote(1, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(1, 1, [0]);

      await linearTokenVoting.connect(childTokenHolder1).vote(2, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(2, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategies
      await linearTokenVoting.timelockProposal(0);
      await linearTokenVoting.timelockProposal(1);
      await linearTokenVoting.timelockProposal(2);

      // Timelock the proposals
      await azoriusVetoGuard.timelockProposal(0);
      await azoriusVetoGuard.timelockProposal(1);
      await azoriusVetoGuard.timelockProposal(2);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);
      expect(await azoriusModule.proposalState(1)).to.eq(1);
      expect(await azoriusModule.proposalState(2)).to.eq(1);

      expect(await vetoMultisigVoting.isFrozen()).to.eq(false);

      // Voters both cast veto votes on the first proposal, and also cast freeze votes
      await vetoMultisigVoting
        .connect(parentMultisigOwner1)
        .castVetoVote(txHash1, true);

      await vetoMultisigVoting
        .connect(parentMultisigOwner2)
        .castVetoVote(txHash1, true);

      expect(await vetoMultisigVoting.isFrozen()).to.eq(true);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);
      expect(await azoriusModule.proposalState(1)).to.eq(2);
      expect(await azoriusModule.proposalState(2)).to.eq(2);

      // This proposal should fail due to veto
      await expect(
        azoriusModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData1,
          0
        )
      ).to.be.revertedWith("Transaction has been vetoed");

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposalByIndex(
          1,
          childVotesToken.address,
          0,
          tokenTransferData2,
          0
        )
      ).to.be.revertedWith("DAO is frozen");

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposalByIndex(
          2,
          childVotesToken.address,
          0,
          tokenTransferData3,
          0
        )
      ).to.be.revertedWith("DAO is frozen");
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

      const proposalTransaction1 = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData1,
        operation: 0,
      };

      const proposalTransaction2 = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData2,
        operation: 0,
      };

      const proposalTransaction3 = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData3,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction1],
        ""
      );

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction2],
        ""
      );

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction3],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);
      expect(await azoriusModule.proposalState(1)).to.eq(0);
      expect(await azoriusModule.proposalState(2)).to.eq(0);

      // Both users vote in support of proposals
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      await linearTokenVoting.connect(childTokenHolder1).vote(1, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(1, 1, [0]);

      await linearTokenVoting.connect(childTokenHolder1).vote(2, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(2, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategies
      await linearTokenVoting.timelockProposal(0);
      await linearTokenVoting.timelockProposal(1);
      await linearTokenVoting.timelockProposal(2);

      // Timelock the proposals
      await azoriusVetoGuard.timelockProposal(0);
      await azoriusVetoGuard.timelockProposal(1);
      await azoriusVetoGuard.timelockProposal(2);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);
      expect(await azoriusModule.proposalState(1)).to.eq(1);
      expect(await azoriusModule.proposalState(2)).to.eq(1);

      expect(await vetoMultisigVoting.isFrozen()).to.eq(false);

      // Voters both cast veto votes on the first proposal, and also cast freeze votes
      await vetoMultisigVoting.connect(parentMultisigOwner1).castFreezeVote();

      await vetoMultisigVoting.connect(parentMultisigOwner2).castFreezeVote();

      expect(await vetoMultisigVoting.isFrozen()).to.eq(true);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);
      expect(await azoriusModule.proposalState(1)).to.eq(2);
      expect(await azoriusModule.proposalState(2)).to.eq(2);

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData1,
          0
        )
      ).to.be.revertedWith("DAO is frozen");

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposalByIndex(
          1,
          childVotesToken.address,
          0,
          tokenTransferData2,
          0
        )
      ).to.be.revertedWith("DAO is frozen");

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposalByIndex(
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

      const proposalTransaction = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategy
      await linearTokenVoting.timelockProposal(0);

      // Timelock the proposal
      await azoriusVetoGuard.timelockProposal(0);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      expect(await vetoMultisigVoting.isFrozen()).to.eq(false);

      // Voters both cast veto votes on the first proposal, and also cast freeze votes
      await vetoMultisigVoting.connect(parentMultisigOwner1).castFreezeVote();

      expect(await vetoMultisigVoting.isFrozen()).to.eq(false);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);

      expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(
        100
      );
      expect(await childVotesToken.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azoriusModule.executeProposalByIndex(
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

      const proposalTransaction1 = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData1,
        operation: 0,
      };

      const proposalTransaction2 = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData2,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction1],
        ""
      );

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction2],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);
      expect(await azoriusModule.proposalState(1)).to.eq(0);

      // Both users vote in support of proposals
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      await linearTokenVoting.connect(childTokenHolder1).vote(1, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(1, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Timelock the proposals
      await azoriusVetoGuard.timelockProposal(0);
      await azoriusVetoGuard.timelockProposal(1);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);
      expect(await azoriusModule.proposalState(1)).to.eq(1);

      expect(await vetoMultisigVoting.isFrozen()).to.eq(false);

      // Voters both cast veto votes on the first proposal, and also cast freeze votes
      await vetoMultisigVoting.connect(parentMultisigOwner1).castFreezeVote();

      await vetoMultisigVoting.connect(parentMultisigOwner2).castFreezeVote();

      expect(await vetoMultisigVoting.isFrozen()).to.eq(true);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);
      expect(await azoriusModule.proposalState(1)).to.eq(2);

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData1,
          0
        )
      ).to.be.revertedWith("DAO is frozen");

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposalByIndex(
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

      const proposalTransaction3 = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData3,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction3],
        ""
      );

      expect(await azoriusModule.proposalState(2)).to.eq(0);

      await linearTokenVoting.connect(childTokenHolder1).vote(2, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(2, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Timelock the proposal
      await azoriusVetoGuard.timelockProposal(2);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(2)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(2)).to.eq(2);

      expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(
        100
      );
      expect(await childVotesToken.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azoriusModule.executeProposalByIndex(
        2,
        childVotesToken.address,
        0,
        tokenTransferData3,
        0
      );

      expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(
        96
      );
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

      const proposalTransaction1 = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData1,
        operation: 0,
      };

      const proposalTransaction2 = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData2,
        operation: 0,
      };

      const proposalTransaction3 = {
        to: childVotesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData3,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction1],
        ""
      );
      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction2],
        ""
      );
      await azoriusModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction3],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);
      expect(await azoriusModule.proposalState(1)).to.eq(0);
      expect(await azoriusModule.proposalState(2)).to.eq(0);

      // Both users vote in support of proposals
      await linearTokenVoting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(0, 1, [0]);

      await linearTokenVoting.connect(childTokenHolder1).vote(1, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(1, 1, [0]);

      await linearTokenVoting.connect(childTokenHolder1).vote(2, 1, [0]);
      await linearTokenVoting.connect(childTokenHolder2).vote(2, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategies
      await linearTokenVoting.timelockProposal(0);
      await linearTokenVoting.timelockProposal(1);
      await linearTokenVoting.timelockProposal(2);

      // Timelock the proposals
      await azoriusVetoGuard.timelockProposal(0);
      await azoriusVetoGuard.timelockProposal(1);
      await azoriusVetoGuard.timelockProposal(2);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);
      expect(await azoriusModule.proposalState(1)).to.eq(1);
      expect(await azoriusModule.proposalState(2)).to.eq(1);

      expect(await vetoMultisigVoting.isFrozen()).to.eq(false);

      // Voters both cast veto votes on the first proposal, and also cast freeze votes
      await vetoMultisigVoting.connect(parentMultisigOwner1).castFreezeVote();

      await vetoMultisigVoting.connect(parentMultisigOwner2).castFreezeVote();

      expect(await vetoMultisigVoting.isFrozen()).to.eq(true);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);
      expect(await azoriusModule.proposalState(1)).to.eq(2);
      expect(await azoriusModule.proposalState(2)).to.eq(2);

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposalByIndex(
          0,
          childVotesToken.address,
          0,
          tokenTransferData1,
          0
        )
      ).to.be.revertedWith("DAO is frozen");

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposalByIndex(
          1,
          childVotesToken.address,
          0,
          tokenTransferData2,
          0
        )
      ).to.be.revertedWith("DAO is frozen");

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposalByIndex(
          2,
          childVotesToken.address,
          0,
          tokenTransferData3,
          0
        )
      ).to.be.revertedWith("DAO is frozen");

      // Parent DAO defrosts the child
      await vetoMultisigVoting.connect(vetoMultisigVotingOwner).defrost();

      // Child DAO is now unfrozen
      expect(await vetoMultisigVoting.isFrozen()).to.eq(false);

      expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(
        100
      );
      expect(await childVotesToken.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azoriusModule.executeProposalByIndex(
        0,
        childVotesToken.address,
        0,
        tokenTransferData1,
        0
      );

      expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(
        90
      );
      expect(await childVotesToken.balanceOf(deployer.address)).to.eq(10);
    });
  });
});
