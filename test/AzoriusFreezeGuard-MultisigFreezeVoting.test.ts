import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "ethers";
import hre from "hardhat";
import time from "./time";

import {
  GnosisSafeProxyFactory,
  LinearERC20Voting,
  LinearERC20Voting__factory,
  Azorius,
  Azorius__factory,
  AzoriusFreezeGuard,
  AzoriusFreezeGuard__factory,
  MultisigFreezeVoting,
  MultisigFreezeVoting__factory,
  VotesERC20,
  VotesERC20__factory,
  ModuleProxyFactory,
  GnosisSafeL2__factory,
  GnosisSafeL2,
} from "../typechain-types";

import {
  buildSignatureBytes,
  buildSafeTransaction,
  safeSignTypedData,
  predictGnosisSafeAddress,
  calculateProxyAddress,
} from "./helpers";

import {
  getGnosisSafeL2Singleton,
  getGnosisSafeProxyFactory,
  getModuleProxyFactory,
} from "./GlobalSafeDeployments.test";

describe("Azorius Child DAO with Multisig parent", () => {
  // Deployed contracts
  let parentGnosisSafe: GnosisSafeL2;
  let childGnosisSafe: GnosisSafeL2;
  let freezeGuard: AzoriusFreezeGuard;
  let freezeGuardMastercopy: AzoriusFreezeGuard;
  let azoriusMastercopy: Azorius;
  let azoriusModule: Azorius;
  let linearERC20VotingMastercopy: LinearERC20Voting;
  let linearERC20Voting: LinearERC20Voting;
  let freezeVotingMastercopy: MultisigFreezeVoting;
  let freezeVoting: MultisigFreezeVoting;
  let votesERC20Mastercopy: VotesERC20;
  let childVotesERC20: VotesERC20;
  let gnosisSafeProxyFactory: GnosisSafeProxyFactory;
  let moduleProxyFactory: ModuleProxyFactory;

  // Wallets
  let deployer: SignerWithAddress;
  let childSafeOwner: SignerWithAddress;
  let parentMultisigOwner1: SignerWithAddress;
  let parentMultisigOwner2: SignerWithAddress;
  let parentMultisigOwner3: SignerWithAddress;
  let childTokenHolder1: SignerWithAddress;
  let childTokenHolder2: SignerWithAddress;
  let azoriusModuleOwner: SignerWithAddress;
  let freezeVotingOwner: SignerWithAddress;

  // Gnosis
  let createChildGnosisSetupCalldata: string;
  let createParentGnosisSetupCalldata: string;

  const parentThreshold = 2;
  const saltNum = BigInt(
    "0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c"
  );

  beforeEach(async () => {
    gnosisSafeProxyFactory = getGnosisSafeProxyFactory();
    moduleProxyFactory = getModuleProxyFactory();
    const gnosisSafeL2Singleton = getGnosisSafeL2Singleton();

    const abiCoder = new ethers.AbiCoder();

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
      freezeVotingOwner,
    ] = await hre.ethers.getSigners();

    createParentGnosisSetupCalldata =
      // eslint-disable-next-line camelcase
      GnosisSafeL2__factory.createInterface().encodeFunctionData("setup", [
        [
          parentMultisigOwner1.address,
          parentMultisigOwner2.address,
          parentMultisigOwner3.address,
        ],
        parentThreshold,
        ethers.ZeroAddress,
        ethers.ZeroHash,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        0,
        ethers.ZeroAddress,
      ]);

    createChildGnosisSetupCalldata =
      // eslint-disable-next-line camelcase
      GnosisSafeL2__factory.createInterface().encodeFunctionData("setup", [
        [childSafeOwner.address],
        1,
        ethers.ZeroAddress,
        ethers.ZeroHash,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        0,
        ethers.ZeroAddress,
      ]);

    const predictedParentGnosisSafeAddress = await predictGnosisSafeAddress(
      createParentGnosisSetupCalldata,
      saltNum,
      await gnosisSafeL2Singleton.getAddress(),
      gnosisSafeProxyFactory
    );

    const predictedChildGnosisSafeAddress = await predictGnosisSafeAddress(
      createChildGnosisSetupCalldata,
      saltNum,
      await gnosisSafeL2Singleton.getAddress(),
      gnosisSafeProxyFactory
    );

    // Deploy Parent Gnosis Safe
    await gnosisSafeProxyFactory.createProxyWithNonce(
      await gnosisSafeL2Singleton.getAddress(),
      createParentGnosisSetupCalldata,
      saltNum
    );

    // Deploy Child Gnosis Safe
    await gnosisSafeProxyFactory.createProxyWithNonce(
      await gnosisSafeL2Singleton.getAddress(),
      createChildGnosisSetupCalldata,
      saltNum
    );

    // Get Parent Gnosis Safe
    parentGnosisSafe = await hre.ethers.getContractAt(
      "GnosisSafeL2",
      predictedParentGnosisSafeAddress
    );

    // Get Child Gnosis Safe
    childGnosisSafe = await hre.ethers.getContractAt(
      "GnosisSafeL2",
      predictedChildGnosisSafeAddress
    );

    // Deploy Votes ERC-20 Mastercopy
    votesERC20Mastercopy = await new VotesERC20__factory(deployer).deploy();

    const childVotesERC20SetupData =
      // eslint-disable-next-line camelcase
      VotesERC20__factory.createInterface().encodeFunctionData("setUp", [
        abiCoder.encode(
          ["string", "string", "address[]", "uint256[]"],
          [
            "CHILD",
            "CHILD",
            [
              childTokenHolder1.address,
              childTokenHolder2.address,
              await childGnosisSafe.getAddress(),
            ],
            [100, 100, 100],
          ]
        ),
      ]);

    // await childVotesERC20.setUp(childVotesERC20SetupData);

    await moduleProxyFactory.deployModule(
      await votesERC20Mastercopy.getAddress(),
      childVotesERC20SetupData,
      "10031021"
    );

    const predictedChildVotesERC20Address = await calculateProxyAddress(
      moduleProxyFactory,
      await votesERC20Mastercopy.getAddress(),
      childVotesERC20SetupData,
      "10031021"
    );

    childVotesERC20 = await hre.ethers.getContractAt(
      "VotesERC20",
      predictedChildVotesERC20Address
    );

    // Token holders delegate their votes to themselves
    await childVotesERC20
      .connect(childTokenHolder1)
      .delegate(childTokenHolder1.address);
    await childVotesERC20
      .connect(childTokenHolder2)
      .delegate(childTokenHolder2.address);

    // Deploy Azorius module mastercopy
    azoriusMastercopy = await new Azorius__factory(deployer).deploy();

    const azoriusSetupCalldata =
      // eslint-disable-next-line camelcase
      Azorius__factory.createInterface().encodeFunctionData("setUp", [
        abiCoder.encode(
          ["address", "address", "address", "address[]", "uint32", "uint32"],
          [
            azoriusModuleOwner.address,
            await childGnosisSafe.getAddress(),
            await childGnosisSafe.getAddress(),
            [],
            60, // Timelock period in blocks
            60, // Execution period in blocks
          ]
        ),
      ]);

    await moduleProxyFactory.deployModule(
      await azoriusMastercopy.getAddress(),
      azoriusSetupCalldata,
      "10031021"
    );

    const predictedAzoriusAddress = await calculateProxyAddress(
      moduleProxyFactory,
      await azoriusMastercopy.getAddress(),
      azoriusSetupCalldata,
      "10031021"
    );

    azoriusModule = await hre.ethers.getContractAt(
      "Azorius",
      predictedAzoriusAddress
    );

    // Deploy Linear ERC-20 Voting Strategy Mastercopy
    linearERC20VotingMastercopy = await new LinearERC20Voting__factory(
      deployer
    ).deploy();

    const linearERC20VotingSetupCalldata =
      // eslint-disable-next-line camelcase
      LinearERC20Voting__factory.createInterface().encodeFunctionData("setUp", [
        abiCoder.encode(
          [
            "address",
            "address",
            "address",
            "uint32",
            "uint256",
            "uint256",
            "uint256",
          ],
          [
            await parentGnosisSafe.getAddress(), // owner
            await childVotesERC20.getAddress(), // governance token
            await azoriusModule.getAddress(), // Azorius module
            60, // voting period in blocks
            0, // proposer weight
            500000, // quorom numerator, denominator is 1,000,000
            500000, // basis numerator, denominator is 1,000,000, so basis percentage is 50% (simple majority)
          ]
        ),
      ]);

    await moduleProxyFactory.deployModule(
      await linearERC20VotingMastercopy.getAddress(),
      linearERC20VotingSetupCalldata,
      "10031021"
    );

    const predictedLinearERC20VotingAddress = await calculateProxyAddress(
      moduleProxyFactory,
      await linearERC20VotingMastercopy.getAddress(),
      linearERC20VotingSetupCalldata,
      "10031021"
    );

    linearERC20Voting = await hre.ethers.getContractAt(
      "LinearERC20Voting",
      predictedLinearERC20VotingAddress
    );

    // Enable the Linear Token Voting strategy on Azorius
    await azoriusModule
      .connect(azoriusModuleOwner)
      .enableStrategy(await linearERC20Voting.getAddress());

    // Deploy MultisigFreezeVoting mastercopy contract
    freezeVotingMastercopy = await new MultisigFreezeVoting__factory(
      deployer
    ).deploy();

    const freezeVotingSetupCalldata =
      // eslint-disable-next-line camelcase
      MultisigFreezeVoting__factory.createInterface().encodeFunctionData(
        "setUp",
        [
          abiCoder.encode(
            ["address", "uint256", "uint32", "uint32", "address"],
            [
              freezeVotingOwner.address, // owner
              2, // freeze votes threshold
              10, // freeze proposal duration in blocks
              200, // freeze duration in blocks
              await parentGnosisSafe.getAddress(),
            ]
          ),
        ]
      );

    await moduleProxyFactory.deployModule(
      await freezeVotingMastercopy.getAddress(),
      freezeVotingSetupCalldata,
      "10031021"
    );

    const predictedFreezeVotingAddress = await calculateProxyAddress(
      moduleProxyFactory,
      await freezeVotingMastercopy.getAddress(),
      freezeVotingSetupCalldata,
      "10031021"
    );

    freezeVoting = await hre.ethers.getContractAt(
      "MultisigFreezeVoting",
      predictedFreezeVotingAddress
    );

    // Deploy and setUp AzoriusFreezeGuard mastercopy contract
    freezeGuardMastercopy = await new AzoriusFreezeGuard__factory(
      deployer
    ).deploy();

    const freezeGuardSetupCalldata =
      // eslint-disable-next-line camelcase
      LinearERC20Voting__factory.createInterface().encodeFunctionData("setUp", [
        abiCoder.encode(
          ["address", "address"],
          [
            freezeVotingOwner.address, // owner
            await freezeVoting.getAddress(), // freeze voting contract
          ]
        ),
      ]);

    await moduleProxyFactory.deployModule(
      await freezeGuardMastercopy.getAddress(),
      freezeGuardSetupCalldata,
      "10031021"
    );

    const predictedFreezeGuardAddress = await calculateProxyAddress(
      moduleProxyFactory,
      await freezeGuardMastercopy.getAddress(),
      freezeGuardSetupCalldata,
      "10031021"
    );

    freezeGuard = await hre.ethers.getContractAt(
      "AzoriusFreezeGuard",
      predictedFreezeGuardAddress
    );

    // Create transaction on child Gnosis Safe to setup Azorius module
    const enableAzoriusModuleData =
      childGnosisSafe.interface.encodeFunctionData("enableModule", [
        await azoriusModule.getAddress(),
      ]);

    const enableAzoriusModuleTx = buildSafeTransaction({
      to: await childGnosisSafe.getAddress(),
      data: enableAzoriusModuleData,
      safeTxGas: 1000000,
      nonce: await childGnosisSafe.nonce(),
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

    // Set the Azorius Freeze Guard as the Guard on the Azorius Module
    await azoriusModule
      .connect(azoriusModuleOwner)
      .setGuard(await freezeGuard.getAddress());

    // Gnosis Safe received the 100 tokens
    expect(
      await childVotesERC20.balanceOf(await childGnosisSafe.getAddress())
    ).to.eq(100);
  });

  describe("AzoriusFreezeGuard Functionality", () => {
    it("A proposal can be created and executed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      const proposalTransaction = {
        to: await childVotesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        await linearERC20Voting.getAddress(),
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearERC20Voting.connect(childTokenHolder1).vote(0, 1);
      await linearERC20Voting.connect(childTokenHolder2).vote(0, 1);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);

      expect(
        await childVotesERC20.balanceOf(await childGnosisSafe.getAddress())
      ).to.eq(100);
      expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azoriusModule.executeProposal(
        0,
        [await childVotesERC20.getAddress()],
        [0],
        [tokenTransferData],
        [0]
      );

      expect(
        await childVotesERC20.balanceOf(await childGnosisSafe.getAddress())
      ).to.eq(90);
      expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(10);
    });

    it("A proposal containing multiple transactions can be created and executed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = childVotesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1]
      );

      const tokenTransferData2 = childVotesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 2]
      );

      const tokenTransferData3 = childVotesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 3]
      );

      const proposalTransactions = [
        {
          to: await childVotesERC20.getAddress(),
          value: 0n,
          data: tokenTransferData1,
          operation: 0,
        },
        {
          to: await childVotesERC20.getAddress(),
          value: 0n,
          data: tokenTransferData2,
          operation: 0,
        },
        {
          to: await childVotesERC20.getAddress(),
          value: 0n,
          data: tokenTransferData3,
          operation: 0,
        },
      ];

      await azoriusModule.submitProposal(
        await linearERC20Voting.getAddress(),
        "0x",
        proposalTransactions,
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearERC20Voting.connect(childTokenHolder1).vote(0, 1);
      await linearERC20Voting.connect(childTokenHolder2).vote(0, 1);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);

      expect(
        await childVotesERC20.balanceOf(await childGnosisSafe.getAddress())
      ).to.eq(100);
      expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azoriusModule.executeProposal(
        0,
        [
          await childVotesERC20.getAddress(),
          await childVotesERC20.getAddress(),
          await childVotesERC20.getAddress(),
        ],
        [0, 0, 0],
        [tokenTransferData1, tokenTransferData2, tokenTransferData3],
        [0, 0, 0]
      );

      // Check that all three token transfer TX's were executed
      expect(
        await childVotesERC20.balanceOf(await childGnosisSafe.getAddress())
      ).to.eq(94);
      expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(6);
    });

    it("A frozen DAO cannot execute any transaction", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = childVotesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      const tokenTransferData2 = childVotesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 5]
      );

      const tokenTransferData3 = childVotesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 4]
      );

      const proposalTransaction1 = {
        to: await childVotesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData1,
        operation: 0,
      };

      const proposalTransaction2 = {
        to: await childVotesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData2,
        operation: 0,
      };

      const proposalTransaction3 = {
        to: await childVotesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData3,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        await linearERC20Voting.getAddress(),
        "0x",
        [proposalTransaction1],
        ""
      );
      await azoriusModule.submitProposal(
        await linearERC20Voting.getAddress(),
        "0x",
        [proposalTransaction2],
        ""
      );
      await azoriusModule.submitProposal(
        await linearERC20Voting.getAddress(),
        "0x",
        [proposalTransaction3],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);
      expect(await azoriusModule.proposalState(1)).to.eq(0);
      expect(await azoriusModule.proposalState(2)).to.eq(0);

      // Both users vote in support of proposals
      await linearERC20Voting.connect(childTokenHolder1).vote(0, 1);
      await linearERC20Voting.connect(childTokenHolder2).vote(0, 1);

      await linearERC20Voting.connect(childTokenHolder1).vote(1, 1);
      await linearERC20Voting.connect(childTokenHolder2).vote(1, 1);

      await linearERC20Voting.connect(childTokenHolder1).vote(2, 1);
      await linearERC20Voting.connect(childTokenHolder2).vote(2, 1);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);
      expect(await azoriusModule.proposalState(1)).to.eq(1);
      expect(await azoriusModule.proposalState(2)).to.eq(1);

      expect(await freezeVoting.isFrozen()).to.eq(false);

      // Voters both cast freeze votes on the first proposal
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();

      await freezeVoting.connect(parentMultisigOwner2).castFreezeVote();

      expect(await freezeVoting.isFrozen()).to.eq(true);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);
      expect(await azoriusModule.proposalState(1)).to.eq(2);
      expect(await azoriusModule.proposalState(2)).to.eq(2);

      // Executing proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposal(
          0,
          [await childVotesERC20.getAddress()],
          [0],
          [tokenTransferData1],
          [0]
        )
      ).to.be.revertedWithCustomError(freezeGuard, "DAOFrozen()");

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposal(
          1,
          [await childVotesERC20.getAddress()],
          [0],
          [tokenTransferData2],
          [0]
        )
      ).to.be.revertedWithCustomError(freezeGuard, "DAOFrozen()");

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposal(
          2,
          [await childVotesERC20.getAddress()],
          [0],
          [tokenTransferData3],
          [0]
        )
      ).to.be.revertedWithCustomError(freezeGuard, "DAOFrozen()");
    });

    it("A proposal can still be executed if a freeze proposal has been created, but threshold has not been met", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      const proposalTransaction = {
        to: await childVotesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        await linearERC20Voting.getAddress(),
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);

      // Both users vote in support of proposal
      await linearERC20Voting.connect(childTokenHolder1).vote(0, 1);
      await linearERC20Voting.connect(childTokenHolder2).vote(0, 1);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      expect(await freezeVoting.isFrozen()).to.eq(false);

      // First voter casts freeze vote on the proposal
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();

      expect(await freezeVoting.isFrozen()).to.eq(false);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);

      expect(
        await childVotesERC20.balanceOf(await childGnosisSafe.getAddress())
      ).to.eq(100);
      expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azoriusModule.executeProposal(
        0,
        [await childVotesERC20.getAddress()],
        [0],
        [tokenTransferData],
        [0]
      );

      // Proposal is executed
      expect(await azoriusModule.proposalState(0)).to.eq(3);

      expect(
        await childVotesERC20.balanceOf(await childGnosisSafe.getAddress())
      ).to.eq(90);
      expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(10);
    });

    it("A frozen DAO is automatically unfrozen after the freeze duration is over", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = childVotesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      const tokenTransferData2 = childVotesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 5]
      );

      const proposalTransaction1 = {
        to: await childVotesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData1,
        operation: 0,
      };

      const proposalTransaction2 = {
        to: await childVotesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData2,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        await linearERC20Voting.getAddress(),
        "0x",
        [proposalTransaction1],
        ""
      );

      await azoriusModule.submitProposal(
        await linearERC20Voting.getAddress(),
        "0x",
        [proposalTransaction2],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);
      expect(await azoriusModule.proposalState(1)).to.eq(0);

      // Both users vote in support of proposals
      await linearERC20Voting.connect(childTokenHolder1).vote(0, 1);
      await linearERC20Voting.connect(childTokenHolder2).vote(0, 1);

      await linearERC20Voting.connect(childTokenHolder1).vote(1, 1);
      await linearERC20Voting.connect(childTokenHolder2).vote(1, 1);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);
      expect(await azoriusModule.proposalState(1)).to.eq(1);

      expect(await freezeVoting.isFrozen()).to.eq(false);

      // Voters both cast freeze votes
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();
      await freezeVoting.connect(parentMultisigOwner2).castFreezeVote();

      expect(await freezeVoting.isFrozen()).to.eq(true);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);
      expect(await azoriusModule.proposalState(1)).to.eq(2);

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposal(
          0,
          [await childVotesERC20.getAddress()],
          [0],
          [tokenTransferData1],
          [0]
        )
      ).to.be.revertedWithCustomError(freezeGuard, "DAOFrozen()");

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposal(
          1,
          [await childVotesERC20.getAddress()],
          [0],
          [tokenTransferData2],
          [0]
        )
      ).to.be.revertedWithCustomError(freezeGuard, "DAOFrozen()");

      // Increase time so that freeze period has ended
      await time.advanceBlocks(200);

      const tokenTransferData3 = childVotesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 4]
      );

      const proposalTransaction3 = {
        to: await childVotesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData3,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        await linearERC20Voting.getAddress(),
        "0x",
        [proposalTransaction3],
        ""
      );

      expect(await azoriusModule.proposalState(2)).to.eq(0);

      await linearERC20Voting.connect(childTokenHolder1).vote(2, 1);
      await linearERC20Voting.connect(childTokenHolder2).vote(2, 1);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(2)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(2)).to.eq(2);

      expect(
        await childVotesERC20.balanceOf(await childGnosisSafe.getAddress())
      ).to.eq(100);
      expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azoriusModule.executeProposal(
        2,
        [await childVotesERC20.getAddress()],
        [0],
        [tokenTransferData3],
        [0]
      );

      // Proposal is executed
      expect(await azoriusModule.proposalState(2)).to.eq(3);

      expect(
        await childVotesERC20.balanceOf(await childGnosisSafe.getAddress())
      ).to.eq(96);
      expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(4);
    });

    it("A frozen DAO can be unfrozen by its owner, and continue to execute TX's", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = childVotesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      const tokenTransferData2 = childVotesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 5]
      );

      const tokenTransferData3 = childVotesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 4]
      );

      const proposalTransaction1 = {
        to: await childVotesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData1,
        operation: 0,
      };

      const proposalTransaction2 = {
        to: await childVotesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData2,
        operation: 0,
      };

      const proposalTransaction3 = {
        to: await childVotesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData3,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        await linearERC20Voting.getAddress(),
        "0x",
        [proposalTransaction1],
        ""
      );
      await azoriusModule.submitProposal(
        await linearERC20Voting.getAddress(),
        "0x",
        [proposalTransaction2],
        ""
      );
      await azoriusModule.submitProposal(
        await linearERC20Voting.getAddress(),
        "0x",
        [proposalTransaction3],
        ""
      );

      // Proposal is active
      expect(await azoriusModule.proposalState(0)).to.eq(0);
      expect(await azoriusModule.proposalState(1)).to.eq(0);
      expect(await azoriusModule.proposalState(2)).to.eq(0);

      // Both users vote in support of proposals
      await linearERC20Voting.connect(childTokenHolder1).vote(0, 1);
      await linearERC20Voting.connect(childTokenHolder2).vote(0, 1);

      await linearERC20Voting.connect(childTokenHolder1).vote(1, 1);
      await linearERC20Voting.connect(childTokenHolder2).vote(1, 1);

      await linearERC20Voting.connect(childTokenHolder1).vote(2, 1);
      await linearERC20Voting.connect(childTokenHolder2).vote(2, 1);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);
      expect(await azoriusModule.proposalState(1)).to.eq(1);
      expect(await azoriusModule.proposalState(2)).to.eq(1);

      expect(await freezeVoting.isFrozen()).to.eq(false);

      // Voters both cast freeze votes
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();

      await freezeVoting.connect(parentMultisigOwner2).castFreezeVote();

      expect(await freezeVoting.isFrozen()).to.eq(true);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);
      expect(await azoriusModule.proposalState(1)).to.eq(2);
      expect(await azoriusModule.proposalState(2)).to.eq(2);

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposal(
          0,
          [await childVotesERC20.getAddress()],
          [0],
          [tokenTransferData1],
          [0]
        )
      ).to.be.revertedWithCustomError(freezeGuard, "DAOFrozen()");

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposal(
          1,
          [await childVotesERC20.getAddress()],
          [0],
          [tokenTransferData2],
          [0]
        )
      ).to.be.revertedWithCustomError(freezeGuard, "DAOFrozen()");

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposal(
          2,
          [await childVotesERC20.getAddress()],
          [0],
          [tokenTransferData3],
          [0]
        )
      ).to.be.revertedWithCustomError(freezeGuard, "DAOFrozen()");

      // Parent DAO unfreezes the child
      await freezeVoting.connect(freezeVotingOwner).unfreeze();

      // Child DAO is now unfrozen
      expect(await freezeVoting.isFrozen()).to.eq(false);

      expect(
        await childVotesERC20.balanceOf(await childGnosisSafe.getAddress())
      ).to.eq(100);
      expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azoriusModule.executeProposal(
        0,
        [await childVotesERC20.getAddress()],
        [0],
        [tokenTransferData1],
        [0]
      );

      // Proposal is executed
      expect(await azoriusModule.proposalState(0)).to.eq(3);

      expect(
        await childVotesERC20.balanceOf(await childGnosisSafe.getAddress())
      ).to.eq(90);
      expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(10);
    });

    it("Freeze state values are updated correctly throughout the freeze process", async () => {
      // freeze votes threshold => 2
      // freeze proposal duration in blocks => 10
      // freeze duration in blocks => 200

      // One voter casts freeze vote
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();

      const firstFreezeProposalCreatedBlock =
        (await hre.ethers.provider.getBlock("latest"))!.number;
      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
        firstFreezeProposalCreatedBlock
      );

      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(1);

      expect(await freezeVoting.isFrozen()).to.eq(false);

      expect(
        await freezeVoting.userHasFreezeVoted(
          parentMultisigOwner1.address,
          firstFreezeProposalCreatedBlock
        )
      ).to.eq(true);
      expect(
        await freezeVoting.userHasFreezeVoted(
          parentMultisigOwner2.address,
          firstFreezeProposalCreatedBlock
        )
      ).to.eq(false);

      // Increase time so freeze proposal has ended
      await time.advanceBlocks(10);

      // One voter casts freeze vote, this should create a new freeze proposal
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();

      const secondFreezeProposalCreatedBlock =
        (await hre.ethers.provider.getBlock("latest"))!.number;

      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
        secondFreezeProposalCreatedBlock
      );

      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(1);

      expect(await freezeVoting.isFrozen()).to.eq(false);

      expect(
        await freezeVoting.userHasFreezeVoted(
          parentMultisigOwner1.address,
          secondFreezeProposalCreatedBlock
        )
      ).to.eq(true);
      expect(
        await freezeVoting.userHasFreezeVoted(
          parentMultisigOwner2.address,
          secondFreezeProposalCreatedBlock
        )
      ).to.eq(false);

      // First voter cannot vote again
      await expect(
        freezeVoting.connect(parentMultisigOwner1).castFreezeVote()
      ).to.be.revertedWithCustomError(freezeVoting, "AlreadyVoted");

      // Second voter casts freeze vote, should update state of current freeze proposal
      await freezeVoting.connect(parentMultisigOwner2).castFreezeVote();

      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
        secondFreezeProposalCreatedBlock
      );

      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(2);

      expect(await freezeVoting.isFrozen()).to.eq(true);

      expect(
        await freezeVoting.userHasFreezeVoted(
          parentMultisigOwner1.address,
          secondFreezeProposalCreatedBlock
        )
      ).to.eq(true);
      expect(
        await freezeVoting.userHasFreezeVoted(
          parentMultisigOwner2.address,
          secondFreezeProposalCreatedBlock
        )
      ).to.eq(true);

      // Move time forward, freeze should still be active
      await time.advanceBlocks(90);

      expect(await freezeVoting.isFrozen()).to.eq(true);

      // Move time forward, freeze should end
      await time.advanceBlocks(200);

      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
        secondFreezeProposalCreatedBlock
      );

      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(2);

      expect(await freezeVoting.isFrozen()).to.eq(false);
    });
  });
});
