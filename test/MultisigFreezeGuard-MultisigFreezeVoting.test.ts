import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import time from "./time";

import {
  VotesERC20,
  VotesERC20__factory,
  MultisigFreezeVoting,
  MultisigFreezeVoting__factory,
  MultisigFreezeGuard,
  MultisigFreezeGuard__factory,
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

describe("Child Multisig DAO with Multisig Parent", () => {
  // Deployed contracts
  let childGnosisSafe: GnosisSafeL2;
  let freezeGuard: MultisigFreezeGuard;
  let freezeVotingMastercopy: MultisigFreezeVoting;
  let freezeVoting: MultisigFreezeVoting;
  let votesERC20Mastercopy: VotesERC20;
  let votesERC20: VotesERC20;

  // Wallets
  let deployer: SignerWithAddress;
  let parentMultisigOwner1: SignerWithAddress;
  let parentMultisigOwner2: SignerWithAddress;
  let parentMultisigOwner3: SignerWithAddress;
  let childMultisigOwner1: SignerWithAddress;
  let childMultisigOwner2: SignerWithAddress;
  let childMultisigOwner3: SignerWithAddress;
  let freezeGuardOwner: SignerWithAddress;

  // Gnosis
  let createParentGnosisSetupCalldata: string;
  let createChildGnosisSetupCalldata: string;

  const threshold = 2;
  const saltNum = BigNumber.from(
    "0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c"
  );

  beforeEach(async () => {
    [
      deployer,
      parentMultisigOwner1,
      parentMultisigOwner2,
      parentMultisigOwner3,
      childMultisigOwner1,
      childMultisigOwner2,
      childMultisigOwner3,
      freezeGuardOwner,
    ] = await ethers.getSigners();

    const gnosisSafeProxyFactory = getGnosisSafeProxyFactory();
    const moduleProxyFactory = getModuleProxyFactory();
    const gnosisSafeL2Singleton = getGnosisSafeL2Singleton();

    createParentGnosisSetupCalldata =
      // eslint-disable-next-line camelcase
      GnosisSafeL2__factory.createInterface().encodeFunctionData("setup", [
        [
          parentMultisigOwner1.address,
          parentMultisigOwner2.address,
          parentMultisigOwner3.address,
        ],
        threshold,
        ethers.constants.AddressZero,
        ethers.constants.HashZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        0,
        ethers.constants.AddressZero,
      ]);

    createChildGnosisSetupCalldata =
      // eslint-disable-next-line camelcase
      GnosisSafeL2__factory.createInterface().encodeFunctionData("setup", [
        [
          childMultisigOwner1.address,
          childMultisigOwner2.address,
          childMultisigOwner3.address,
        ],
        threshold,
        ethers.constants.AddressZero,
        ethers.constants.HashZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        0,
        ethers.constants.AddressZero,
      ]);

    const predictedParentGnosisSafeAddress = await predictGnosisSafeAddress(
      createParentGnosisSetupCalldata,
      saltNum,
      gnosisSafeL2Singleton.address,
      gnosisSafeProxyFactory
    );

    const predictedChildGnosisSafeAddress = await predictGnosisSafeAddress(
      createChildGnosisSetupCalldata,
      saltNum,
      gnosisSafeL2Singleton.address,
      gnosisSafeProxyFactory
    );

    // Deploy Parent Gnosis Safe
    await gnosisSafeProxyFactory.createProxyWithNonce(
      gnosisSafeL2Singleton.address,
      createParentGnosisSetupCalldata,
      saltNum
    );

    // Deploy Child Gnosis Safe
    await gnosisSafeProxyFactory.createProxyWithNonce(
      gnosisSafeL2Singleton.address,
      createChildGnosisSetupCalldata,
      saltNum
    );

    // Get Parent Gnosis Safe contract
    // eslint-disable-next-line camelcase
    const parentGnosisSafe = GnosisSafeL2__factory.connect(
      predictedParentGnosisSafeAddress,
      deployer
    );

    // Get Child Gnosis Safe contract
    // eslint-disable-next-line camelcase
    childGnosisSafe = GnosisSafeL2__factory.connect(
      predictedChildGnosisSafeAddress,
      deployer
    );

    // Deploy token mastercopy
    votesERC20Mastercopy = await new VotesERC20__factory(deployer).deploy();

    const abiCoder = new ethers.utils.AbiCoder(); // encode data
    const votesERC20SetupData =
      // eslint-disable-next-line camelcase
      VotesERC20__factory.createInterface().encodeFunctionData("setUp", [
        abiCoder.encode(
          ["string", "string", "address[]", "uint256[]"],
          ["DCNT", "DCNT", [childGnosisSafe.address], [1000]]
        ),
      ]);

    await moduleProxyFactory.deployModule(
      votesERC20Mastercopy.address,
      votesERC20SetupData,
      "10031021"
    );

    const predictedVotesERC20Address = calculateProxyAddress(
      moduleProxyFactory,
      votesERC20Mastercopy.address,
      votesERC20SetupData,
      "10031021"
    );

    votesERC20 = await ethers.getContractAt(
      "VotesERC20",
      predictedVotesERC20Address
    );

    // Deploy MultisigFreezeVoting mastercopy contract
    freezeVotingMastercopy = await new MultisigFreezeVoting__factory(
      deployer
    ).deploy();

    // Initialize MultisigFreezeVoting contract
    const freezeVotingSetupData =
      // eslint-disable-next-line camelcase
      MultisigFreezeVoting__factory.createInterface().encodeFunctionData(
        "setUp",
        [
          abiCoder.encode(
            ["address", "uint256", "uint32", "uint32", "address"],
            [
              freezeGuardOwner.address,
              2, // freeze votes threshold
              10, // freeze proposal duration in blocks
              200, // freeze duration in blocks
              parentGnosisSafe.address,
            ]
          ),
        ]
      );
    await moduleProxyFactory.deployModule(
      freezeVotingMastercopy.address,
      freezeVotingSetupData,
      "10031021"
    );

    const predictedFreezeVotingAddress = calculateProxyAddress(
      moduleProxyFactory,
      freezeVotingMastercopy.address,
      freezeVotingSetupData,
      "10031021"
    );

    freezeVoting = await ethers.getContractAt(
      "ERC20FreezeVoting",
      predictedFreezeVotingAddress
    );

    // Deploy FreezeGuard mastercopy contract
    const freezeGuardMastercopy = await new MultisigFreezeGuard__factory(
      deployer
    ).deploy();

    // Deploy MultisigFreezeGuard contract with a 60 block timelock period and 60 block execution period
    const freezeGuardSetupData =
      // eslint-disable-next-line camelcase
      MultisigFreezeGuard__factory.createInterface().encodeFunctionData(
        "setUp",
        [
          abiCoder.encode(
            ["uint32", "uint32", "address", "address", "address"],
            [
              60, // Timelock period
              60, // Execution period
              freezeGuardOwner.address,
              freezeVoting.address,
              childGnosisSafe.address,
            ]
          ),
        ]
      );

    await moduleProxyFactory.deployModule(
      freezeGuardMastercopy.address,
      freezeGuardSetupData,
      "10031021"
    );

    const predictedFreezeGuardAddress = calculateProxyAddress(
      moduleProxyFactory,
      freezeGuardMastercopy.address,
      freezeGuardSetupData,
      "10031021"
    );

    freezeGuard = await ethers.getContractAt(
      "MultisigFreezeGuard",
      predictedFreezeGuardAddress
    );

    // Create transaction to set the guard address
    const setGuardData = childGnosisSafe.interface.encodeFunctionData(
      "setGuard",
      [freezeGuard.address]
    );

    const tx = buildSafeTransaction({
      to: childGnosisSafe.address,
      data: setGuardData,
      safeTxGas: 1000000,
      nonce: await childGnosisSafe.nonce(),
    });
    const sigs = [
      await safeSignTypedData(childMultisigOwner1, childGnosisSafe, tx),
      await safeSignTypedData(childMultisigOwner2, childGnosisSafe, tx),
    ];
    const signatureBytes = buildSignatureBytes(sigs);

    // Execute transaction that adds the freeze guard to the Safe
    await expect(
      childGnosisSafe.execTransaction(
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
    ).to.emit(childGnosisSafe, "ExecutionSuccess");

    // Gnosis Safe received the 1,000 tokens
    expect(await votesERC20.balanceOf(childGnosisSafe.address)).to.eq(1000);
  });

  describe("MultisigFreezeGuard with MultisigFreezeVoting", () => {
    it("Freeze vars set properly during init", async () => {
      // Frozen Params init correctly
      expect(await freezeVoting.freezeVotesThreshold()).to.eq(2);
      expect(await freezeVoting.freezeProposalPeriod()).to.eq(10);
      expect(await freezeVoting.freezePeriod()).to.eq(200);
      expect(await freezeVoting.owner()).to.eq(freezeGuardOwner.address);
    });

    it("Updates state properly due to freeze actions", async () => {
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(0);
      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(0);

      // Vetoer 1 casts 1 freeze vote
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();
      expect(await freezeVoting.isFrozen()).to.eq(false);
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(1);
      const latestBlock = await ethers.provider.getBlock("latest");
      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
        latestBlock.number
      );

      await freezeVoting.connect(parentMultisigOwner2).castFreezeVote();
      expect(await freezeVoting.isFrozen()).to.eq(true);
    });

    it("A transaction can be timelocked and executed", async () => {
      // Create transaction to set the guard address
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx = buildSafeTransaction({
        to: votesERC20.address,
        data: tokenTransferData,
        safeTxGas: 1000000,
        nonce: await childGnosisSafe.nonce(),
      });

      const sigs = [
        await safeSignTypedData(childMultisigOwner1, childGnosisSafe, tx),
        await safeSignTypedData(childMultisigOwner2, childGnosisSafe, tx),
      ];
      const signatureBytes = buildSignatureBytes(sigs);

      await freezeGuard.timelockTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatureBytes,
        tx.nonce
      );

      // Move time forward to elapse timelock period
      await time.advanceBlocks(60);

      await childGnosisSafe.execTransaction(
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

      expect(await votesERC20.balanceOf(childGnosisSafe.address)).to.eq(0);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(1000);
    });

    it("The same transaction must be timelocked separately if being executed more than once", async () => {
      // Create transaction to set the guard address
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx = buildSafeTransaction({
        to: votesERC20.address,
        data: tokenTransferData,
        safeTxGas: 1000000,
        nonce: await childGnosisSafe.nonce(),
      });

      const sigs = [
        await safeSignTypedData(childMultisigOwner1, childGnosisSafe, tx),
        await safeSignTypedData(childMultisigOwner2, childGnosisSafe, tx),
      ];
      const signatureBytes = buildSignatureBytes(sigs);

      await freezeGuard.timelockTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatureBytes,
        tx.nonce
      );

      // Move time forward to elapse timelock period
      await time.advanceBlocks(60);

      await childGnosisSafe.execTransaction(
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

      expect(await votesERC20.balanceOf(childGnosisSafe.address)).to.eq(0);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(1000);

      await expect(
        childGnosisSafe.execTransaction(
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
      ).to.be.revertedWith("GS026");
    });

    it("The same transaction can be executed twice if it is timelocked separately", async () => {
      // Create transaction to set the guard address
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 500]
      );

      const tx1 = buildSafeTransaction({
        to: votesERC20.address,
        data: tokenTransferData,
        safeTxGas: 1000000,
        nonce: BigNumber.from(1),
      });

      const sigs1 = [
        await safeSignTypedData(childMultisigOwner1, childGnosisSafe, tx1),
        await safeSignTypedData(childMultisigOwner2, childGnosisSafe, tx1),
      ];
      const signatureBytes1 = buildSignatureBytes(sigs1);

      const tx2 = buildSafeTransaction({
        to: votesERC20.address,
        data: tokenTransferData,
        safeTxGas: 1000000,
        nonce: BigNumber.from(2),
      });

      const sigs2 = [
        await safeSignTypedData(childMultisigOwner1, childGnosisSafe, tx2),
        await safeSignTypedData(childMultisigOwner2, childGnosisSafe, tx2),
      ];
      const signatureBytes2 = buildSignatureBytes(sigs2);

      await freezeGuard.timelockTransaction(
        tx1.to,
        tx1.value,
        tx1.data,
        tx1.operation,
        tx1.safeTxGas,
        tx1.baseGas,
        tx1.gasPrice,
        tx1.gasToken,
        tx1.refundReceiver,
        signatureBytes1,
        tx1.nonce
      );

      await freezeGuard.timelockTransaction(
        tx2.to,
        tx2.value,
        tx2.data,
        tx2.operation,
        tx2.safeTxGas,
        tx2.baseGas,
        tx2.gasPrice,
        tx2.gasToken,
        tx2.refundReceiver,
        signatureBytes2,
        tx2.nonce
      );

      // Move time forward to elapse timelock period
      await time.advanceBlocks(60);

      // Execute the first transaction
      await childGnosisSafe.execTransaction(
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

      // Execute the second transaction
      await childGnosisSafe.execTransaction(
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

      expect(await votesERC20.balanceOf(childGnosisSafe.address)).to.eq(0);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(1000);
    });

    it("A transaction cannot be executed if it hasn't yet been timelocked", async () => {
      // Create transaction to set the guard address
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx = buildSafeTransaction({
        to: votesERC20.address,
        data: tokenTransferData,
        safeTxGas: 1000000,
        nonce: await childGnosisSafe.nonce(),
      });

      const sigs = [
        await safeSignTypedData(childMultisigOwner1, childGnosisSafe, tx),
        await safeSignTypedData(childMultisigOwner2, childGnosisSafe, tx),
      ];
      const signatureBytes = buildSignatureBytes(sigs);

      await expect(
        childGnosisSafe.execTransaction(
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
      ).to.be.revertedWith("NotTimelocked()");
    });

    it("A transaction cannot be timelocked if the signatures aren't valid", async () => {
      // Create transaction to set the guard address
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx = buildSafeTransaction({
        to: votesERC20.address,
        data: tokenTransferData,
        safeTxGas: 1000000,
        nonce: await childGnosisSafe.nonce(),
      });

      // Only 1 signer signs, while the threshold is 2
      const sigs = [
        await safeSignTypedData(childMultisigOwner1, childGnosisSafe, tx),
      ];
      const signatureBytes = buildSignatureBytes(sigs);

      await expect(
        freezeGuard.timelockTransaction(
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
          tx.safeTxGas,
          tx.baseGas,
          tx.gasPrice,
          tx.gasToken,
          tx.refundReceiver,
          signatureBytes,
          tx.nonce
        )
      ).to.be.revertedWith("GS020");
    });

    it("A transaction cannot be executed if the timelock period has not ended yet", async () => {
      // Create transaction to set the guard address
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx = buildSafeTransaction({
        to: votesERC20.address,
        data: tokenTransferData,
        safeTxGas: 1000000,
        nonce: await childGnosisSafe.nonce(),
      });

      const sigs = [
        await safeSignTypedData(childMultisigOwner1, childGnosisSafe, tx),
        await safeSignTypedData(childMultisigOwner2, childGnosisSafe, tx),
      ];
      const signatureBytes = buildSignatureBytes(sigs);

      await freezeGuard.timelockTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatureBytes,
        tx.nonce
      );

      await expect(
        childGnosisSafe.execTransaction(
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
      ).to.be.revertedWith("Timelocked()");
    });

    it("A frozen DAO cannot execute any transactions", async () => {
      // Create transaction to set the guard address
      const tokenTransferData1 = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tokenTransferData2 = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 999]
      );

      const tx1 = buildSafeTransaction({
        to: votesERC20.address,
        data: tokenTransferData1,
        safeTxGas: 1000000,
        nonce: await childGnosisSafe.nonce(),
      });

      const tx2 = buildSafeTransaction({
        to: votesERC20.address,
        data: tokenTransferData2,
        safeTxGas: 1000000,
        nonce: await childGnosisSafe.nonce(),
      });

      const sigs1 = [
        await safeSignTypedData(childMultisigOwner1, childGnosisSafe, tx1),
        await safeSignTypedData(childMultisigOwner2, childGnosisSafe, tx1),
      ];
      const signatureBytes1 = buildSignatureBytes(sigs1);

      const sigs2 = [
        await safeSignTypedData(childMultisigOwner1, childGnosisSafe, tx2),
        await safeSignTypedData(childMultisigOwner2, childGnosisSafe, tx2),
      ];
      const signatureBytes2 = buildSignatureBytes(sigs2);

      await freezeGuard.timelockTransaction(
        tx1.to,
        tx1.value,
        tx1.data,
        tx1.operation,
        tx1.safeTxGas,
        tx1.baseGas,
        tx1.gasPrice,
        tx1.gasToken,
        tx1.refundReceiver,
        signatureBytes1,
        tx1.nonce
      );

      // Vetoer 1 casts 1 freeze vote
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();

      // Vetoer 2 casts 1 freeze vote
      await freezeVoting.connect(parentMultisigOwner2).castFreezeVote();

      // 2 freeze votes have been cast
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(2);

      // Check that the DAO has been frozen
      expect(await freezeVoting.isFrozen()).to.eq(true);

      // Move time forward to elapse timelock period
      await time.advanceBlocks(60);

      await expect(
        childGnosisSafe.execTransaction(
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
      ).to.be.revertedWith("DAOFrozen()");

      // Timelock tx2
      await freezeGuard.timelockTransaction(
        tx2.to,
        tx2.value,
        tx2.data,
        tx2.operation,
        tx2.safeTxGas,
        tx2.baseGas,
        tx2.gasPrice,
        tx2.gasToken,
        tx2.refundReceiver,
        signatureBytes2,
        tx2.nonce
      );

      // Move time forward to elapse timelock period
      await time.advanceBlocks(60);

      await expect(
        childGnosisSafe.execTransaction(
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
      ).to.be.revertedWith("DAOFrozen()");
    });

    it("A frozen DAO automatically unfreezes after the freeze period has ended", async () => {
      // Create transaction to set the guard address
      const tokenTransferData1 = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tokenTransferData2 = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 999]
      );

      const tx1 = buildSafeTransaction({
        to: votesERC20.address,
        data: tokenTransferData1,
        safeTxGas: 1000000,
        nonce: await childGnosisSafe.nonce(),
      });

      const tx2 = buildSafeTransaction({
        to: votesERC20.address,
        data: tokenTransferData2,
        safeTxGas: 1000000,
        nonce: await childGnosisSafe.nonce(),
      });

      const sigs1 = [
        await safeSignTypedData(childMultisigOwner1, childGnosisSafe, tx1),
        await safeSignTypedData(childMultisigOwner2, childGnosisSafe, tx1),
      ];
      const signatureBytes1 = buildSignatureBytes(sigs1);

      const sigs2 = [
        await safeSignTypedData(childMultisigOwner1, childGnosisSafe, tx2),
        await safeSignTypedData(childMultisigOwner2, childGnosisSafe, tx2),
      ];
      const signatureBytes2 = buildSignatureBytes(sigs2);

      await freezeGuard.timelockTransaction(
        tx1.to,
        tx1.value,
        tx1.data,
        tx1.operation,
        tx1.safeTxGas,
        tx1.baseGas,
        tx1.gasPrice,
        tx1.gasToken,
        tx1.refundReceiver,
        signatureBytes1,
        tx1.nonce
      );

      // Vetoer 1 casts 1 freeze vote
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();

      // Vetoer 2 casts 1 freeze vote
      await freezeVoting.connect(parentMultisigOwner2).castFreezeVote();

      // 2 freeze votes have been cast
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(2);

      // Check that the DAO has been frozen
      expect(await freezeVoting.isFrozen()).to.eq(true);

      // Move time forward to elapse timelock period
      await time.advanceBlocks(60);

      await expect(
        childGnosisSafe.execTransaction(
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
      ).to.be.revertedWith("DAOFrozen()");

      // Timelock tx2
      await freezeGuard.timelockTransaction(
        tx2.to,
        tx2.value,
        tx2.data,
        tx2.operation,
        tx2.safeTxGas,
        tx2.baseGas,
        tx2.gasPrice,
        tx2.gasToken,
        tx2.refundReceiver,
        signatureBytes2,
        tx2.nonce
      );

      // Move time forward to elapse timelock period
      await time.advanceBlocks(60);

      await expect(
        childGnosisSafe.execTransaction(
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
      ).to.be.revertedWith("DAOFrozen()");

      expect(await freezeVoting.isFrozen()).to.eq(true);

      // Move time forward to elapse freeze period
      await time.advanceBlocks(140);

      // Check that the DAO isn't frozen now
      expect(await freezeVoting.isFrozen()).to.eq(false);
    });

    it("A DAO may execute txs during a freeze proposal period if the freeze threshold is not met", async () => {
      // Vetoer 1 casts 1 freeze vote
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();

      // Check that the DAO has not been frozen
      expect(await freezeVoting.isFrozen()).to.eq(false);

      // Create transaction to set the guard address
      const tokenTransferData1 = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx1 = buildSafeTransaction({
        to: votesERC20.address,
        data: tokenTransferData1,
        safeTxGas: 1000000,
        nonce: await childGnosisSafe.nonce(),
      });

      const sigs1 = [
        await safeSignTypedData(childMultisigOwner1, childGnosisSafe, tx1),
        await safeSignTypedData(childMultisigOwner2, childGnosisSafe, tx1),
      ];
      const signatureBytes1 = buildSignatureBytes(sigs1);

      await freezeGuard.timelockTransaction(
        tx1.to,
        tx1.value,
        tx1.data,
        tx1.operation,
        tx1.safeTxGas,
        tx1.baseGas,
        tx1.gasPrice,
        tx1.gasToken,
        tx1.refundReceiver,
        signatureBytes1,
        tx1.nonce
      );

      // Move time forward to elapse timelock period
      await time.advanceBlocks(60);

      await expect(
        childGnosisSafe.execTransaction(
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
      ).to.emit(childGnosisSafe, "ExecutionSuccess");
    });

    it("Casting a vote after the freeze voting period resets state", async () => {
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(0);
      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(0);

      // Vetoer 1 casts 1 freeze vote
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();
      expect(await freezeVoting.isFrozen()).to.eq(false);
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(1);
      let latestBlock = await ethers.provider.getBlock("latest");
      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
        latestBlock.number
      );

      // Move time forward to elapse freeze proposal period
      await time.advanceBlocks(20);

      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(1);
      latestBlock = await ethers.provider.getBlock("latest");
      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
        latestBlock.number
      );
      expect(await freezeVoting.isFrozen()).to.eq(false);
    });

    it("A user cannot vote twice to freeze a DAO during the same voting period", async () => {
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();
      await expect(
        freezeVoting.connect(parentMultisigOwner1).castFreezeVote()
      ).to.be.revertedWith("AlreadyVoted()");
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(1);
    });

    it("Previously Frozen DAOs may not execute TXs after execution period has elapsed", async () => {
      // Vetoer 1 casts 1 freeze vote
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();
      // Vetoer 2 casts 1 freeze vote
      await freezeVoting.connect(parentMultisigOwner2).castFreezeVote();

      // Check that the DAO has been frozen
      expect(await freezeVoting.isFrozen()).to.eq(true);

      // Create transaction to set the guard address
      const tokenTransferData1 = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx1 = buildSafeTransaction({
        to: votesERC20.address,
        data: tokenTransferData1,
        safeTxGas: 1000000,
        nonce: await childGnosisSafe.nonce(),
      });

      const sigs1 = [
        await safeSignTypedData(childMultisigOwner1, childGnosisSafe, tx1),
        await safeSignTypedData(childMultisigOwner2, childGnosisSafe, tx1),
      ];
      const signatureBytes1 = buildSignatureBytes(sigs1);

      await freezeGuard.timelockTransaction(
        tx1.to,
        tx1.value,
        tx1.data,
        tx1.operation,
        tx1.safeTxGas,
        tx1.baseGas,
        tx1.gasPrice,
        tx1.gasToken,
        tx1.refundReceiver,
        signatureBytes1,
        tx1.nonce
      );

      // Move time forward to elapse timelock period
      await time.advanceBlocks(60);

      await expect(
        childGnosisSafe.execTransaction(
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
      ).to.be.revertedWith("DAOFrozen()");

      // Move time forward to elapse freeze period
      await time.advanceBlocks(140);

      // Check that the DAO has been unFrozen
      expect(await freezeVoting.isFrozen()).to.eq(false);

      // Transaction cannot be executed now, since transaction execution period has ended
      await expect(
        childGnosisSafe.execTransaction(
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
      ).to.be.revertedWith("Expired()");
    });

    it("Unfrozen DAOs may execute txs", async () => {
      // Vetoer 1 casts 1 freeze vote
      await freezeVoting.connect(parentMultisigOwner1).castFreezeVote();
      // Vetoer 2 casts 1 freeze vote
      await freezeVoting.connect(parentMultisigOwner2).castFreezeVote();

      // Check that the DAO has been frozen
      expect(await freezeVoting.isFrozen()).to.eq(true);
      await freezeVoting.connect(freezeGuardOwner).unfreeze();
      expect(await freezeVoting.isFrozen()).to.eq(false);

      // Create transaction to set the guard address
      const tokenTransferData1 = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx1 = buildSafeTransaction({
        to: votesERC20.address,
        data: tokenTransferData1,
        safeTxGas: 1000000,
        nonce: await childGnosisSafe.nonce(),
      });

      const sigs1 = [
        await safeSignTypedData(childMultisigOwner1, childGnosisSafe, tx1),
        await safeSignTypedData(childMultisigOwner2, childGnosisSafe, tx1),
      ];
      const signatureBytes1 = buildSignatureBytes(sigs1);

      await freezeGuard.timelockTransaction(
        tx1.to,
        tx1.value,
        tx1.data,
        tx1.operation,
        tx1.safeTxGas,
        tx1.baseGas,
        tx1.gasPrice,
        tx1.gasToken,
        tx1.refundReceiver,
        signatureBytes1,
        tx1.nonce
      );

      // Move time forward to elapse timelock period
      await time.advanceBlocks(60);

      // Check that the DAO has been unFrozen
      await expect(
        childGnosisSafe.execTransaction(
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
      ).to.emit(childGnosisSafe, "ExecutionSuccess");
    });

    it("A transaction cannot be timelocked twice", async () => {
      // Create transaction to set the guard address
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 1000]
      );

      const tx = buildSafeTransaction({
        to: votesERC20.address,
        data: tokenTransferData,
        safeTxGas: 1000000,
        nonce: await childGnosisSafe.nonce(),
      });

      const sigs = [
        await safeSignTypedData(childMultisigOwner1, childGnosisSafe, tx),
        await safeSignTypedData(childMultisigOwner2, childGnosisSafe, tx),
      ];
      const signatureBytes = buildSignatureBytes(sigs);

      await freezeGuard.timelockTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatureBytes,
        tx.nonce
      );

      await expect(
        freezeGuard.timelockTransaction(
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
          tx.safeTxGas,
          tx.baseGas,
          tx.gasPrice,
          tx.gasToken,
          tx.refundReceiver,
          signatureBytes,
          tx.nonce
        )
      ).to.be.revertedWith("AlreadyTimelocked()");
    });

    it("You must be a parent multisig owner to cast a freeze vote", async () => {
      await expect(
        freezeVoting.connect(freezeGuardOwner).castFreezeVote()
      ).to.be.revertedWith("NotOwner()");
    });

    it("Only owner methods must be called by the owner", async () => {
      await expect(
        freezeVoting.connect(childMultisigOwner1).unfreeze()
      ).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(
        freezeVoting.connect(childMultisigOwner1).updateFreezeVotesThreshold(0)
      ).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(
        freezeVoting.connect(childMultisigOwner1).updateFreezeProposalPeriod(0)
      ).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(
        freezeVoting.connect(childMultisigOwner1).updateFreezePeriod(0)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
