import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers, network } from "hardhat";
import time from "./time";

import {
  GnosisSafe,
  GnosisSafeProxyFactory,
  LinearERC20Voting,
  LinearERC20Voting__factory,
  Azorius,
  Azorius__factory,
  AzoriusFreezeGuard,
  AzoriusFreezeGuard__factory,
  ERC20FreezeVoting,
  ERC20FreezeVoting__factory,
  VotesERC20,
  VotesERC20__factory,
  ModuleProxyFactory,
  GnosisSafeL2__factory,
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

describe("Azorius Child DAO with Azorius Parent", () => {
  // Deployed contracts
  let childGnosisSafe: GnosisSafe;
  let freezeGuardMastercopy: AzoriusFreezeGuard;
  let freezeGuard: AzoriusFreezeGuard;
  let azoriusMastercopy: Azorius;
  let azoriusModule: Azorius;
  let linearERC20Voting: LinearERC20Voting;
  let linearERC20VotingMastercopy: LinearERC20Voting;
  let freezeVotingMastercopy: ERC20FreezeVoting;
  let freezeVoting: ERC20FreezeVoting;
  let votesERC20Mastercopy: VotesERC20;
  let parentVotesERC20: VotesERC20;
  let childVotesERC20: VotesERC20;
  let gnosisSafeProxyFactory: GnosisSafeProxyFactory;
  let moduleProxyFactory: ModuleProxyFactory;

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

  const saltNum = BigNumber.from(
    "0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c"
  );

  beforeEach(async () => {
    gnosisSafeProxyFactory = getGnosisSafeProxyFactory();
    moduleProxyFactory = getModuleProxyFactory();
    const gnosisSafeL2Singleton = getGnosisSafeL2Singleton();

    const abiCoder = new ethers.utils.AbiCoder();

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

    createGnosisSetupCalldata =
      // eslint-disable-next-line camelcase
      GnosisSafeL2__factory.createInterface().encodeFunctionData("setup", [
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
      createGnosisSetupCalldata,
      saltNum,
      gnosisSafeL2Singleton.address,
      gnosisSafeProxyFactory
    );

    // Deploy Gnosis Safe
    await gnosisSafeProxyFactory.createProxyWithNonce(
      gnosisSafeL2Singleton.address,
      createGnosisSetupCalldata,
      saltNum
    );

    // Get module proxy factory
    moduleProxyFactory = await ethers.getContractAt(
      "ModuleProxyFactory",
      moduleProxyFactory.address
    );

    childGnosisSafe = await ethers.getContractAt(
      "GnosisSafe",
      predictedGnosisSafeAddress
    );

    // Deploy Votes ERC20 Mastercopy
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
              childGnosisSafe.address,
            ],
            [100, 100, 100],
          ]
        ),
      ]);

    await moduleProxyFactory.deployModule(
      votesERC20Mastercopy.address,
      childVotesERC20SetupData,
      "10031021"
    );

    const predictedChildVotesERC20Address = calculateProxyAddress(
      moduleProxyFactory,
      votesERC20Mastercopy.address,
      childVotesERC20SetupData,
      "10031021"
    );

    childVotesERC20 = await ethers.getContractAt(
      "VotesERC20",
      predictedChildVotesERC20Address
    );

    // Parent Votes ERC-20
    parentVotesERC20 = await new VotesERC20__factory(deployer).deploy();

    const parentVotesERC20SetupData =
      // eslint-disable-next-line camelcase
      VotesERC20__factory.createInterface().encodeFunctionData("setUp", [
        abiCoder.encode(
          ["string", "string", "address[]", "uint256[]"],
          [
            "PARENT",
            "PARENT",
            [parentTokenHolder1.address, parentTokenHolder2.address],
            [100, 100],
          ]
        ),
      ]);

    await moduleProxyFactory.deployModule(
      votesERC20Mastercopy.address,
      parentVotesERC20SetupData,
      "10031021"
    );

    const predictedParentVotesERC20Address = calculateProxyAddress(
      moduleProxyFactory,
      votesERC20Mastercopy.address,
      parentVotesERC20SetupData,
      "10031021"
    );

    parentVotesERC20 = await ethers.getContractAt(
      "VotesERC20",
      predictedParentVotesERC20Address
    );

    // Token holders delegate their votes to themselves
    await childVotesERC20
      .connect(childTokenHolder1)
      .delegate(childTokenHolder1.address);
    await childVotesERC20
      .connect(childTokenHolder2)
      .delegate(childTokenHolder2.address);
    await parentVotesERC20
      .connect(parentTokenHolder1)
      .delegate(parentTokenHolder1.address);
    await parentVotesERC20
      .connect(parentTokenHolder2)
      .delegate(parentTokenHolder2.address);

    // Deploy Azorius module
    azoriusMastercopy = await new Azorius__factory(deployer).deploy();

    const azoriusSetupCalldata =
      // eslint-disable-next-line camelcase
      Azorius__factory.createInterface().encodeFunctionData("setUp", [
        abiCoder.encode(
          ["address", "address", "address", "address[]", "uint32", "uint32"],
          [
            mockParentDAO.address,
            childGnosisSafe.address,
            childGnosisSafe.address,
            [],
            60, // Timelock period in blocks
            60, // Execution period in blocks
          ]
        ),
      ]);

    await moduleProxyFactory.deployModule(
      azoriusMastercopy.address,
      azoriusSetupCalldata,
      "10031021"
    );

    const predictedAzoriusAddress = calculateProxyAddress(
      moduleProxyFactory,
      azoriusMastercopy.address,
      azoriusSetupCalldata,
      "10031021"
    );

    azoriusModule = await ethers.getContractAt(
      "Azorius",
      predictedAzoriusAddress
    );

    // Deploy Linear ERC-20 Voting Strategy
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
            mockParentDAO.address, // owner
            childVotesERC20.address, // governance token
            azoriusModule.address, // Azorius module
            60, // voting period in blocks
            0, // proposer weight
            500000, // quorom numerator, denominator is 1,000,000
            500000, // basis numerator, denominator is 1,000,000, so basis percentage is 50% (simple majority)
          ]
        ),
      ]);

    await moduleProxyFactory.deployModule(
      linearERC20VotingMastercopy.address,
      linearERC20VotingSetupCalldata,
      "10031021"
    );

    const predictedLinearERC20VotingAddress = calculateProxyAddress(
      moduleProxyFactory,
      linearERC20VotingMastercopy.address,
      linearERC20VotingSetupCalldata,
      "10031021"
    );

    linearERC20Voting = await ethers.getContractAt(
      "LinearERC20Voting",
      predictedLinearERC20VotingAddress
    );

    // Enable the Linear Token Voting strategy on Azorius
    await azoriusModule
      .connect(mockParentDAO)
      .enableStrategy(linearERC20Voting.address);

    // Deploy ERC20FreezeVoting contract
    freezeVotingMastercopy = await new ERC20FreezeVoting__factory(
      deployer
    ).deploy();

    const freezeVotingSetupCalldata =
      // eslint-disable-next-line camelcase
      ERC20FreezeVoting__factory.createInterface().encodeFunctionData("setUp", [
        abiCoder.encode(
          ["address", "uint256", "uint32", "uint32", "address"],
          [
            mockParentDAO.address, // owner
            150, // freeze votes threshold
            10, // freeze proposal duration in blocks
            100, // freeze duration in blocks
            parentVotesERC20.address,
          ]
        ),
      ]);

    await moduleProxyFactory.deployModule(
      freezeVotingMastercopy.address,
      freezeVotingSetupCalldata,
      "10031021"
    );

    const predictedFreezeVotingAddress = calculateProxyAddress(
      moduleProxyFactory,
      freezeVotingMastercopy.address,
      freezeVotingSetupCalldata,
      "10031021"
    );

    freezeVoting = await ethers.getContractAt(
      "ERC20FreezeVoting",
      predictedFreezeVotingAddress
    );

    // Deploy and setUp Azorius Freeze Guard contract
    freezeGuardMastercopy = await new AzoriusFreezeGuard__factory(
      deployer
    ).deploy();

    const freezeGuardSetupCalldata =
      // eslint-disable-next-line camelcase
      LinearERC20Voting__factory.createInterface().encodeFunctionData("setUp", [
        abiCoder.encode(
          ["address", "address"],
          [
            mockParentDAO.address, // Owner
            freezeVoting.address, // Freeze voting contract
          ]
        ),
      ]);

    await moduleProxyFactory.deployModule(
      freezeGuardMastercopy.address,
      freezeGuardSetupCalldata,
      "10031021"
    );

    const predictedFreezeGuardAddress = calculateProxyAddress(
      moduleProxyFactory,
      freezeGuardMastercopy.address,
      freezeGuardSetupCalldata,
      "10031021"
    );

    freezeGuard = await ethers.getContractAt(
      "AzoriusFreezeGuard",
      predictedFreezeGuardAddress
    );

    // Set the Azorius Freeze Guard as the Guard on the Azorius Module
    await azoriusModule.connect(mockParentDAO).setGuard(freezeGuard.address);

    // Create transaction on Gnosis Safe to setup Azorius module
    const enableAzoriusModuleData =
      childGnosisSafe.interface.encodeFunctionData("enableModule", [
        azoriusModule.address,
      ]);

    const enableAzoriusModuleTx = buildSafeTransaction({
      to: childGnosisSafe.address,
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

    // Gnosis Safe received the 1,000 tokens
    expect(await childVotesERC20.balanceOf(childGnosisSafe.address)).to.eq(100);
  });

  describe("FreezeGuard Functionality", () => {
    it("A proposal can be created and executed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = childVotesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 10]
      );

      const proposalTransaction = {
        to: childVotesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearERC20Voting.address,
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

      // Proposal is executable
      expect(await azoriusModule.proposalState(0)).to.eq(2);

      expect(await childVotesERC20.balanceOf(childGnosisSafe.address)).to.eq(
        100
      );
      expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azoriusModule.executeProposal(
        0,
        [childVotesERC20.address],
        [0],
        [tokenTransferData],
        [0]
      );

      // Proposal is executed
      expect(await azoriusModule.proposalState(0)).to.eq(3);

      expect(await childVotesERC20.balanceOf(childGnosisSafe.address)).to.eq(
        90
      );
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
          to: childVotesERC20.address,
          value: BigNumber.from(0),
          data: tokenTransferData1,
          operation: 0,
        },
        {
          to: childVotesERC20.address,
          value: BigNumber.from(0),
          data: tokenTransferData2,
          operation: 0,
        },
        {
          to: childVotesERC20.address,
          value: BigNumber.from(0),
          data: tokenTransferData3,
          operation: 0,
        },
      ];

      await azoriusModule.submitProposal(
        linearERC20Voting.address,
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

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is executable
      expect(await azoriusModule.proposalState(0)).to.eq(2);

      expect(await childVotesERC20.balanceOf(childGnosisSafe.address)).to.eq(
        100
      );
      expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azoriusModule.executeProposal(
        0,
        [
          childVotesERC20.address,
          childVotesERC20.address,
          childVotesERC20.address,
        ],
        [0, 0, 0],
        [tokenTransferData1, tokenTransferData2, tokenTransferData3],
        [0, 0, 0]
      );

      // Proposal is executed
      expect(await azoriusModule.proposalState(0)).to.eq(3);

      // Check that all three token transfer TX's were executed
      expect(await childVotesERC20.balanceOf(childGnosisSafe.address)).to.eq(
        94
      );
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
        to: childVotesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData1,
        operation: 0,
      };

      const proposalTransaction2 = {
        to: childVotesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData2,
        operation: 0,
      };

      const proposalTransaction3 = {
        to: childVotesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData3,
        operation: 0,
      };

      await azoriusModule.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction1],
        ""
      );
      await azoriusModule.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction2],
        ""
      );
      await azoriusModule.submitProposal(
        linearERC20Voting.address,
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

      // Voters cast freeze votes
      await freezeVoting.connect(parentTokenHolder1).castFreezeVote();

      await freezeVoting.connect(parentTokenHolder2).castFreezeVote();

      expect(await freezeVoting.isFrozen()).to.eq(true);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposals are executable
      expect(await azoriusModule.proposalState(0)).to.eq(2);
      expect(await azoriusModule.proposalState(1)).to.eq(2);
      expect(await azoriusModule.proposalState(2)).to.eq(2);

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposal(
          0,
          [childVotesERC20.address],
          [0],
          [tokenTransferData1],
          [0]
        )
      ).to.be.revertedWith("DAOFrozen()");

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposal(
          1,
          [childVotesERC20.address],
          [0],
          [tokenTransferData2],
          [0]
        )
      ).to.be.revertedWith("DAOFrozen()");

      // This proposal should fail due to freeze
      await expect(
        azoriusModule.executeProposal(
          2,
          [childVotesERC20.address],
          [0],
          [tokenTransferData3],
          [0]
        )
      ).to.be.revertedWith("DAOFrozen()");
    });
  });

  it("A proposal can still be executed if a freeze proposal has been created, but threshold has not been met", async () => {
    // Create transaction to transfer tokens to the deployer
    const tokenTransferData = childVotesERC20.interface.encodeFunctionData(
      "transfer",
      [deployer.address, 10]
    );

    const proposalTransaction = {
      to: childVotesERC20.address,
      value: BigNumber.from(0),
      data: tokenTransferData,
      operation: 0,
    };

    await azoriusModule.submitProposal(
      linearERC20Voting.address,
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

    // One voter casts freeze vote
    await freezeVoting.connect(parentTokenHolder1).castFreezeVote();

    expect(await freezeVoting.isFrozen()).to.eq(false);

    // Increase time so that timelock period has ended
    await time.advanceBlocks(60);

    // Proposal is ready to execute
    expect(await azoriusModule.proposalState(0)).to.eq(2);

    expect(await childVotesERC20.balanceOf(childGnosisSafe.address)).to.eq(100);
    expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(0);

    // Execute the transaction
    await azoriusModule.executeProposal(
      0,
      [childVotesERC20.address],
      [0],
      [tokenTransferData],
      [0]
    );

    // Proposal is executed
    expect(await azoriusModule.proposalState(0)).to.eq(3);

    expect(await childVotesERC20.balanceOf(childGnosisSafe.address)).to.eq(90);
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
      to: childVotesERC20.address,
      value: BigNumber.from(0),
      data: tokenTransferData1,
      operation: 0,
    };

    const proposalTransaction2 = {
      to: childVotesERC20.address,
      value: BigNumber.from(0),
      data: tokenTransferData2,
      operation: 0,
    };

    await azoriusModule.submitProposal(
      linearERC20Voting.address,
      "0x",
      [proposalTransaction1],
      ""
    );
    await azoriusModule.submitProposal(
      linearERC20Voting.address,
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
    await freezeVoting.connect(parentTokenHolder1).castFreezeVote();
    await freezeVoting.connect(parentTokenHolder2).castFreezeVote();

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
        [childVotesERC20.address],
        [0],
        [tokenTransferData1],
        [0]
      )
    ).to.be.revertedWith("DAOFrozen()");

    // This proposal should fail due to freeze
    await expect(
      azoriusModule.executeProposal(
        1,
        [childVotesERC20.address],
        [0],
        [tokenTransferData2],
        [0]
      )
    ).to.be.revertedWith("DAOFrozen()");

    // Increase time so that freeze has ended
    for (let i = 0; i <= 100; i++) {
      await network.provider.send("evm_mine");
    }

    const tokenTransferData3 = childVotesERC20.interface.encodeFunctionData(
      "transfer",
      [deployer.address, 4]
    );

    const proposalTransaction3 = {
      to: childVotesERC20.address,
      value: BigNumber.from(0),
      data: tokenTransferData3,
      operation: 0,
    };

    await azoriusModule.submitProposal(
      linearERC20Voting.address,
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

    expect(await childVotesERC20.balanceOf(childGnosisSafe.address)).to.eq(100);
    expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(0);

    // Execute the transaction
    await azoriusModule.executeProposal(
      2,
      [childVotesERC20.address],
      [0],
      [tokenTransferData3],
      [0]
    );

    // Proposal is executed
    expect(await azoriusModule.proposalState(2)).to.eq(3);

    expect(await childVotesERC20.balanceOf(childGnosisSafe.address)).to.eq(96);
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
      to: childVotesERC20.address,
      value: BigNumber.from(0),
      data: tokenTransferData1,
      operation: 0,
    };

    const proposalTransaction2 = {
      to: childVotesERC20.address,
      value: BigNumber.from(0),
      data: tokenTransferData2,
      operation: 0,
    };

    const proposalTransaction3 = {
      to: childVotesERC20.address,
      value: BigNumber.from(0),
      data: tokenTransferData3,
      operation: 0,
    };

    await azoriusModule.submitProposal(
      linearERC20Voting.address,
      "0x",
      [proposalTransaction1],
      ""
    );

    await azoriusModule.submitProposal(
      linearERC20Voting.address,
      "0x",
      [proposalTransaction2],
      ""
    );

    await azoriusModule.submitProposal(
      linearERC20Voting.address,
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
    await freezeVoting.connect(parentTokenHolder1).castFreezeVote();

    await freezeVoting.connect(parentTokenHolder2).castFreezeVote();

    expect(await freezeVoting.isFrozen()).to.eq(true);

    // Increase time so that timelock period has ended
    await time.advanceBlocks(60);

    // Proposal is executable
    expect(await azoriusModule.proposalState(0)).to.eq(2);
    expect(await azoriusModule.proposalState(1)).to.eq(2);
    expect(await azoriusModule.proposalState(2)).to.eq(2);

    // This proposal should fail due to freeze
    await expect(
      azoriusModule.executeProposal(
        0,
        [childVotesERC20.address],
        [0],
        [tokenTransferData1],
        [0]
      )
    ).to.be.revertedWith("DAOFrozen()");

    // This proposal should fail due to freeze
    await expect(
      azoriusModule.executeProposal(
        1,
        [childVotesERC20.address],
        [0],
        [tokenTransferData2],
        [0]
      )
    ).to.be.revertedWith("DAOFrozen()");

    // This proposal should fail due to freeze
    await expect(
      azoriusModule.executeProposal(
        2,
        [childVotesERC20.address],
        [0],
        [tokenTransferData3],
        [0]
      )
    ).to.be.revertedWith("DAOFrozen()");

    // Parent DAO unfreezes the child
    await freezeVoting.connect(mockParentDAO).unfreeze();

    // Child DAO is now unfrozen
    expect(await freezeVoting.isFrozen()).to.eq(false);

    expect(await childVotesERC20.balanceOf(childGnosisSafe.address)).to.eq(100);
    expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(0);

    // Execute the transaction
    await azoriusModule.executeProposal(
      0,
      [childVotesERC20.address],
      [0],
      [tokenTransferData1],
      [0]
    );

    expect(await childVotesERC20.balanceOf(childGnosisSafe.address)).to.eq(90);
    expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(10);
  });

  it("Freeze state values are updated correctly throughout the freeze process", async () => {
    // freeze votes threshold => 150
    // freeze proposal duration in blocks => 10
    // freeze duration in blocks => 100

    // One voter casts freeze vote
    await freezeVoting.connect(parentTokenHolder1).castFreezeVote();

    const firstFreezeProposalCreatedBlock = (
      await ethers.provider.getBlock("latest")
    ).number;
    expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
      firstFreezeProposalCreatedBlock
    );

    expect(await freezeVoting.freezeProposalVoteCount()).to.eq(100);

    expect(await freezeVoting.isFrozen()).to.eq(false);

    expect(
      await freezeVoting.userHasFreezeVoted(
        parentTokenHolder1.address,
        firstFreezeProposalCreatedBlock
      )
    ).to.eq(true);
    expect(
      await freezeVoting.userHasFreezeVoted(
        parentTokenHolder2.address,
        firstFreezeProposalCreatedBlock
      )
    ).to.eq(false);

    // Increase time so freeze proposal has ended
    await time.advanceBlocks(10);

    // One voter casts freeze vote, this should create a new freeze proposal
    await freezeVoting.connect(parentTokenHolder1).castFreezeVote();

    const secondFreezeProposalCreatedBlock = (
      await ethers.provider.getBlock("latest")
    ).number;

    expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
      secondFreezeProposalCreatedBlock
    );

    expect(await freezeVoting.freezeProposalVoteCount()).to.eq(100);

    expect(await freezeVoting.isFrozen()).to.eq(false);

    expect(
      await freezeVoting.userHasFreezeVoted(
        parentTokenHolder1.address,
        secondFreezeProposalCreatedBlock
      )
    ).to.eq(true);
    expect(
      await freezeVoting.userHasFreezeVoted(
        parentTokenHolder2.address,
        secondFreezeProposalCreatedBlock
      )
    ).to.eq(false);

    // First voter cannot vote again
    await expect(
      freezeVoting.connect(parentTokenHolder1).castFreezeVote()
    ).to.be.revertedWith("AlreadyVoted()");

    // Second voter casts freeze vote, should update state of current freeze proposal
    await freezeVoting.connect(parentTokenHolder2).castFreezeVote();

    expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
      secondFreezeProposalCreatedBlock
    );

    expect(await freezeVoting.freezeProposalVoteCount()).to.eq(200);

    expect(await freezeVoting.isFrozen()).to.eq(true);

    expect(
      await freezeVoting.userHasFreezeVoted(
        parentTokenHolder1.address,
        secondFreezeProposalCreatedBlock
      )
    ).to.eq(true);
    expect(
      await freezeVoting.userHasFreezeVoted(
        parentTokenHolder2.address,
        secondFreezeProposalCreatedBlock
      )
    ).to.eq(true);

    // Move time forward, freeze should still be active
    await time.advanceBlocks(90);

    expect(await freezeVoting.isFrozen()).to.eq(true);

    // Move time forward, freeze should end
    await time.advanceBlocks(10);

    expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
      secondFreezeProposalCreatedBlock
    );

    expect(await freezeVoting.freezeProposalVoteCount()).to.eq(200);

    expect(await freezeVoting.isFrozen()).to.eq(false);
  });

  it("A user with no freeze votes cannot cast freeze votes", async () => {
    // User has no freeze votes
    await expect(
      freezeVoting.connect(childTokenHolder1).castFreezeVote()
    ).to.be.revertedWith("NoVotes()");

    // Freeze proposal is created
    await freezeVoting.connect(parentTokenHolder1).castFreezeVote();

    // User has no freeze votes
    await expect(
      freezeVoting.connect(childTokenHolder1).castFreezeVote()
    ).to.be.revertedWith("NoVotes()");
  });
});
