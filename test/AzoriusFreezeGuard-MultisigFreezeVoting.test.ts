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
  AzoriusFreezeGuard,
  AzoriusFreezeGuard__factory,
  MultisigFreezeVoting,
  MultisigFreezeVoting__factory,
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
  let freezeGuard: AzoriusFreezeGuard;
  let azoriusModule: Azorius;
  let linearTokenVoting: LinearTokenVoting;
  let freezeVoting: MultisigFreezeVoting;
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
    azoriusModule = await new Azorius__factory(deployer).deploy();

    await azoriusModule.setUp(
      abiCoder.encode(
        ["address", "address", "address", "address[]", "uint256", "uint256"],
        [
          azoriusModuleOwner.address,
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
          parentGnosisSafe.address, // owner
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
      .connect(azoriusModuleOwner)
      .enableStrategy(linearTokenVoting.address);

    // Deploy MultisigFreezeVoting contract
    freezeVoting = await new MultisigFreezeVoting__factory(deployer).deploy();

    // Setup MultisigFreezeVoting contract
    await freezeVoting.setUp(
      abiCoder.encode(
        ["address", "uint256", "uint256", "uint256", "address"],
        [
          freezeVotingOwner.address, // owner
          2, // freeze votes threshold
          10, // freeze proposal duration in seconds
          200, // freeze duration in seconds
          parentGnosisSafe.address,
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
          freezeVoting.address, // freeze voting contract
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
    expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(100);
  });

  describe("AzoriusFreezeGuard Functionality", () => {
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
      await time.increase(time.duration.seconds(60));

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
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await azoriusModule.proposalState(0)).to.eq(2);
      expect(await azoriusModule.proposalState(1)).to.eq(2);
      expect(await azoriusModule.proposalState(2)).to.eq(2);

      // Executing proposal should fail due to freeze
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

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);

      expect(await freezeVoting.isFrozen()).to.eq(false);

      // First voter casts freeze vote on the proposal
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();

      expect(await freezeVoting.isFrozen()).to.eq(false);

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

      // Proposal is executed
      expect(await azoriusModule.proposalState(0)).to.eq(3);

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

      // Proposal is timelocked
      expect(await azoriusModule.proposalState(0)).to.eq(1);
      expect(await azoriusModule.proposalState(1)).to.eq(1);

      expect(await freezeVoting.isFrozen()).to.eq(false);

      // Voters both cast freeze votes
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();
      await freezeVoting.connect(parentMultisigOwner2).castFreezeVote();

      expect(await freezeVoting.isFrozen()).to.eq(true);

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

      // Increase time so that freeze period has ended
      await time.increase(time.duration.seconds(200));

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

      // Proposal is executed
      expect(await azoriusModule.proposalState(2)).to.eq(3);

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
      await freezeVoting.connect(freezeVotingOwner).defrost();

      // Child DAO is now unfrozen
      expect(await freezeVoting.isFrozen()).to.eq(false);

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

      // Proposal is executed
      expect(await azoriusModule.proposalState(0)).to.eq(3);

      expect(await childVotesToken.balanceOf(childGnosisSafe.address)).to.eq(
        90
      );
      expect(await childVotesToken.balanceOf(deployer.address)).to.eq(10);
    });

    it("Freeze state values are updated correctly throughout the freeze process", async () => {
      // freeze votes threshold => 2
      // freeze proposal duration in seconds => 10
      // freeze duration in seconds => 200

      // One voter casts freeze vote
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();

      const firstFreezeProposalCreatedBlock = (
        await ethers.provider.getBlock("latest")
      ).number;
      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
        firstFreezeProposalCreatedBlock
      );

      expect(await freezeVoting.freezeProposalCreatedTime()).to.eq(
        await time.latest()
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
      await time.increase(time.duration.seconds(10));

      // One voter casts freeze vote, this should create a new freeze proposal
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();

      const secondFreezeProposalCreatedBlock = (
        await ethers.provider.getBlock("latest")
      ).number;
      const secondFreezeProposalCreatedTime = await time.latest();

      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
        secondFreezeProposalCreatedBlock
      );

      expect(await freezeVoting.freezeProposalCreatedTime()).to.eq(
        secondFreezeProposalCreatedTime
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
      ).to.be.revertedWith("User has already voted");

      // Second voter casts freeze vote, should update state of current freeze proposal
      await freezeVoting.connect(parentMultisigOwner2).castFreezeVote();

      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
        secondFreezeProposalCreatedBlock
      );

      expect(await freezeVoting.freezeProposalCreatedTime()).to.eq(
        secondFreezeProposalCreatedTime
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
      await time.increase(time.duration.seconds(90));

      expect(await freezeVoting.isFrozen()).to.eq(true);

      // Move time forward, freeze should end
      await time.increase(time.duration.seconds(200));

      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
        secondFreezeProposalCreatedBlock
      );

      expect(await freezeVoting.freezeProposalCreatedTime()).to.eq(
        secondFreezeProposalCreatedTime
      );

      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(2);

      expect(await freezeVoting.isFrozen()).to.eq(false);
    });
  });
});
