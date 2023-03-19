import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
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
  VotesERC20,
  VotesERC20__factory,
  FreezeLock,
  FreezeLock__factory,
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
  let freezeGuard: AzoriusFreezeGuard;
  let azoriusModule: Azorius;
  let linearERC20Voting: LinearERC20Voting;
  let freezeLock: FreezeLock;
  let childVotesERC20: VotesERC20;
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
  let freezeVotingOwner: SignerWithAddress;

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
      freezeVotingOwner,
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

    // Child Votes ERC-20
    childVotesERC20 = await new VotesERC20__factory(deployer).deploy();

    const childVotesERC20SetupData = abiCoder.encode(
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

    await childVotesERC20.setUp(childVotesERC20SetupData);

    // Token holders delegate their votes to themselves
    await childVotesERC20
      .connect(childTokenHolder1)
      .delegate(childTokenHolder1.address);
    await childVotesERC20
      .connect(childTokenHolder2)
      .delegate(childTokenHolder2.address);

    // Deploy Azorius module
    azoriusModule = await new Azorius__factory(deployer).deploy();

    await azoriusModule.setUp(
      abiCoder.encode(
        ["address", "address", "address", "address[]", "uint256", "uint256"],
        [
          azoriusModuleOwner.address,
          childGnosisSafe.address,
          childGnosisSafe.address,
          [],
          60, // Timelock period in blocks
          60, // Execution period in blocks
        ]
      )
    );

    // Deploy Linear ERC-20 Voting Strategy
    linearERC20Voting = await new LinearERC20Voting__factory(deployer).deploy();

    await linearERC20Voting.setUp(
      abiCoder.encode(
        ["address", "address", "address", "uint256", "uint256"],
        [
          parentGnosisSafe.address, // owner
          childVotesERC20.address, // governance token
          azoriusModule.address, // Azorius module
          60, // voting period in blocks
          500000, // quorom numerator, denominator is 1,000,000
        ]
      )
    );

    // Enable the Linear Token Voting strategy on Azorius
    await azoriusModule
      .connect(azoriusModuleOwner)
      .enableStrategy(linearERC20Voting.address);

    freezeLock = await new FreezeLock__factory(deployer).deploy();

    await freezeLock.setUp(
      abiCoder.encode(
        ["address", "uint256"],
        [
          freezeVotingOwner.address, // owner
          200, // freeze duration in blocks
        ]
      )
    );

    // Deploy and setUp AzoriusFreezeGuard contract
    freezeGuard = await new AzoriusFreezeGuard__factory(deployer).deploy();

    await freezeGuard.setUp(
      abiCoder.encode(
        ["address", "address"],
        [
          freezeVotingOwner.address, // owner
          freezeLock.address, // freeze voting contract
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

    // Set the Azorius Freeze Guard as the Guard on the Azorius Module
    await azoriusModule
      .connect(azoriusModuleOwner)
      .setGuard(freezeGuard.address);

    // Gnosis Safe received the 100 tokens
    expect(await childVotesERC20.balanceOf(childGnosisSafe.address)).to.eq(100);
  });

  describe("AzoriusFreezeGuard Functionality", () => {
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
      await linearERC20Voting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearERC20Voting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is ready to execute
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
      await linearERC20Voting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearERC20Voting.connect(childTokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is ready to execute
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
      await linearERC20Voting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearERC20Voting.connect(childTokenHolder2).vote(0, 1, [0]);

      await linearERC20Voting.connect(childTokenHolder1).vote(1, 1, [0]);
      await linearERC20Voting.connect(childTokenHolder2).vote(1, 1, [0]);

      await linearERC20Voting.connect(childTokenHolder1).vote(2, 1, [0]);
      await linearERC20Voting.connect(childTokenHolder2).vote(2, 1, [0]);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);
      expect(await azoriusModule.proposalState(1)).to.eq(1);
      expect(await azoriusModule.proposalState(2)).to.eq(1);

      expect(await freezeLock.isFrozen()).to.eq(false);

      await freezeLock.connect(freezeVotingOwner).startFreeze();

      expect(await freezeLock.isFrozen()).to.eq(true);

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
      await linearERC20Voting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearERC20Voting.connect(childTokenHolder2).vote(0, 1, [0]);

      await linearERC20Voting.connect(childTokenHolder1).vote(1, 1, [0]);
      await linearERC20Voting.connect(childTokenHolder2).vote(1, 1, [0]);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);
      expect(await azoriusModule.proposalState(1)).to.eq(1);

      expect(await freezeLock.isFrozen()).to.eq(false);

      await freezeLock.connect(freezeVotingOwner).startFreeze();

      expect(await freezeLock.isFrozen()).to.eq(true);

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

      // Increase time so that freeze period has ended
      await time.advanceBlocks(200);

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

      await linearERC20Voting.connect(childTokenHolder1).vote(2, 1, [0]);
      await linearERC20Voting.connect(childTokenHolder2).vote(2, 1, [0]);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(2)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(2)).to.eq(2);

      expect(await childVotesERC20.balanceOf(childGnosisSafe.address)).to.eq(
        100
      );
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

      expect(await childVotesERC20.balanceOf(childGnosisSafe.address)).to.eq(
        96
      );
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
      await linearERC20Voting.connect(childTokenHolder1).vote(0, 1, [0]);
      await linearERC20Voting.connect(childTokenHolder2).vote(0, 1, [0]);

      await linearERC20Voting.connect(childTokenHolder1).vote(1, 1, [0]);
      await linearERC20Voting.connect(childTokenHolder2).vote(1, 1, [0]);

      await linearERC20Voting.connect(childTokenHolder1).vote(2, 1, [0]);
      await linearERC20Voting.connect(childTokenHolder2).vote(2, 1, [0]);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);
      expect(await azoriusModule.proposalState(1)).to.eq(1);
      expect(await azoriusModule.proposalState(2)).to.eq(1);

      expect(await freezeLock.isFrozen()).to.eq(false);

      await freezeLock.connect(freezeVotingOwner).startFreeze();

      expect(await freezeLock.isFrozen()).to.eq(true);

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
      await freezeLock.connect(freezeVotingOwner).unfreeze();

      // Child DAO is now unfrozen
      expect(await freezeLock.isFrozen()).to.eq(false);

      expect(await childVotesERC20.balanceOf(childGnosisSafe.address)).to.eq(
        100
      );
      expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azoriusModule.executeProposal(
        0,
        [childVotesERC20.address],
        [0],
        [tokenTransferData1],
        [0]
      );

      // Proposal is executed
      expect(await azoriusModule.proposalState(0)).to.eq(3);

      expect(await childVotesERC20.balanceOf(childGnosisSafe.address)).to.eq(
        90
      );
      expect(await childVotesERC20.balanceOf(deployer.address)).to.eq(10);
    });
  });
});
