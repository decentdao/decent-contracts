import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers, network } from "hardhat";
import time from "./time";

import {
  GnosisSafe,
  GnosisSafeProxyFactory,
  LinearTokenVoting,
  LinearTokenVoting__factory,
  Azorius,
  Azorius__factory,
  AzoriusFreezeGuard,
  AzoriusFreezeGuard__factory,
  ERC20FreezeVoting,
  ERC20FreezeVoting__factory,
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

describe("Azorius Child DAO with Azorius Parent", () => {
  // Deployed contracts
  let childGnosisSafe: GnosisSafe;
  let freezeGuard: AzoriusFreezeGuard;
  let azoriusModule: Azorius;
  let linearTokenVoting: LinearTokenVoting;
  let freezeVoting: ERC20FreezeVoting;
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

    // Deploy Azorius module
    azoriusModule = await new Azorius__factory(deployer).deploy();

    await azoriusModule.setUp(
      abiCoder.encode(
        ["address", "address", "address", "address[]", "uint256", "uint256"],
        [
          mockParentDAO.address,
          childGnosisSafe.address,
          childGnosisSafe.address,
          [],
          60, // Timelock period in seconds
          60, // Execution period in seconds
        ]
      )
    );

    // Deploy Linear Token Voting Strategy
    linearTokenVoting = await new LinearTokenVoting__factory(deployer).deploy();

    await linearTokenVoting.setUp(
      abiCoder.encode(
        ["address", "address", "address", "uint256", "uint256", "string"],
        [
          mockParentDAO.address, // owner
          childVotesToken.address, // governance token
          azoriusModule.address, // Azorius module
          60, // voting period in seconds
          500000, // quorom numerator, denominator is 1,000,000
          "Voting", // name
        ]
      )
    );

    // Enable the Linear Token Voting strategy on Azorius
    await azoriusModule
      .connect(mockParentDAO)
      .enableStrategy(linearTokenVoting.address);

    // Deploy ERC20FreezeVoting contract
    freezeVoting = await new ERC20FreezeVoting__factory(deployer).deploy();

    await freezeVoting.setUp(
      abiCoder.encode(
        ["address", "uint256", "uint256", "uint256", "address"],
        [
          mockParentDAO.address, // owner
          150, // freeze votes threshold
          10, // freeze proposal duration in seconds
          100, // freeze duration in seconds
          parentVotesToken.address,
        ]
      )
    );

    // Deploy and setUp Azorius Freeze Guard contract
    freezeGuard = await new AzoriusFreezeGuard__factory(deployer).deploy();

    await freezeGuard.setUp(
      abiCoder.encode(
        ["address", "address"],
        [
          mockParentDAO.address, // Owner
          freezeVoting.address, // Freeze voting contract
        ]
      )
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

    // Execute transaction that adds the Azoruis module to the Safe
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
    expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(100);
  });

  describe("FreezeGuard Functionality", () => {
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
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is executable
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

      // Proposal is executed
      expect(await azoriusModule.proposalState(0)).to.eq(3);

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
      await time.advanceBlocks(60);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is executable
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

      // Proposal is executed
      expect(await azoriusModule.proposalState(0)).to.eq(3);

      // Check that all three token transfer TX's were executed
      expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(
        94
      );
      expect(await childVotesToken.balanceOf(deployer.address)).to.eq(6);
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

    expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(100);
    expect(await childVotesToken.balanceOf(deployer.address)).to.eq(0);

    // Execute the transaction
    await azoriusModule.executeProposalByIndex(
      0,
      childVotesToken.address,
      0,
      tokenTransferData,
      0
    );

    // Proposal is executed
    expect(await azoriusModule.proposalState(0)).to.eq(3);

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
    await time.advanceBlocks(60);

    // Proposal is timelocked
    expect(await azoriusModule.proposalState(2)).to.eq(1);

    // Increase time so that timelock period has ended
    await time.advanceBlocks(60);

    // Proposal is ready to execute
    expect(await azoriusModule.proposalState(2)).to.eq(2);

    expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(100);
    expect(await childVotesToken.balanceOf(deployer.address)).to.eq(0);

    // Execute the transaction
    await azoriusModule.executeProposalByIndex(
      2,
      childVotesToken.address,
      0,
      tokenTransferData3,
      0
    );

    // Proposal is executed
    expect(await azoriusModule.proposalState(2)).to.eq(3);

    expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(96);
    expect(await childVotesToken.balanceOf(deployer.address)).to.eq(4);
  });

  it("A frozen DAO can be unfrozen by its owner, and continue to execute TX's", async () => {
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

    // Parent DAO unfreezes the child
    await freezeVoting.connect(mockParentDAO).unfreeze();

    // Child DAO is now unfrozen
    expect(await freezeVoting.isFrozen()).to.eq(false);

    expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(100);
    expect(await childVotesToken.balanceOf(deployer.address)).to.eq(0);

    // Execute the transaction
    await azoriusModule.executeProposalByIndex(
      0,
      childVotesToken.address,
      0,
      tokenTransferData1,
      0
    );

    expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(90);
    expect(await childVotesToken.balanceOf(deployer.address)).to.eq(10);
  });

  it("Freeze state values are updated correctly throughout the freeze process", async () => {
    // freeze votes threshold => 150
    // freeze proposal duration in seconds => 10
    // freeze duration in seconds => 100

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
    ).to.be.revertedWith("User has already voted");

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
});
