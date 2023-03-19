import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, network } from "hardhat";
import time from "./time";

import {
  VotesERC20,
  VotesERC20__factory,
  MultisigFreezeGuard,
  MultisigFreezeGuard__factory,
  FreezeLock,
  FreezeLock__factory,
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

describe("Child Multisig DAO with Multisig Parent", () => {
  // Factories
  let gnosisFactory: Contract;

  // Deployed contracts
  let childGnosisSafe: Contract;
  let parentGnosisSafe: Contract;
  let freezeGuard: MultisigFreezeGuard;
  let freezeLock: FreezeLock;
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
      parentMultisigOwner1,
      parentMultisigOwner2,
      parentMultisigOwner3,
      childMultisigOwner1,
      childMultisigOwner2,
      childMultisigOwner3,
      freezeGuardOwner,
    ] = await ethers.getSigners();

    // Get deployed Gnosis Safe
    gnosisFactory = new ethers.Contract(gnosisFactoryAddress, abi, deployer);

    createParentGnosisSetupCalldata = ifaceSafe.encodeFunctionData("setup", [
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

    createChildGnosisSetupCalldata = ifaceSafe.encodeFunctionData("setup", [
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
      gnosisFactory.address,
      createParentGnosisSetupCalldata,
      saltNum,
      gnosisSingletonAddress,
      gnosisFactory
    );

    const predictedChildGnosisSafeAddress = await predictGnosisSafeAddress(
      gnosisFactory.address,
      createChildGnosisSetupCalldata,
      saltNum,
      gnosisSingletonAddress,
      gnosisFactory
    );

    // Deploy Parent Gnosis Safe
    await gnosisFactory.createProxyWithNonce(
      gnosisSingletonAddress,
      createParentGnosisSetupCalldata,
      saltNum
    );

    // Deploy Child Gnosis Safe
    await gnosisFactory.createProxyWithNonce(
      gnosisSingletonAddress,
      createChildGnosisSetupCalldata,
      saltNum
    );

    // Get Parent Gnosis Safe contract
    parentGnosisSafe = new ethers.Contract(
      predictedParentGnosisSafeAddress,
      abiSafe,
      deployer
    );

    // Get Child Gnosis Safe contract
    childGnosisSafe = new ethers.Contract(
      predictedChildGnosisSafeAddress,
      abiSafe,
      deployer
    );

    // Deploy token, allocate supply to two token vetoers and Gnosis Safe
    votesERC20 = await new VotesERC20__factory(deployer).deploy();

    const abiCoder = new ethers.utils.AbiCoder(); // encode data
    const votesERC20SetupData = abiCoder.encode(
      ["string", "string", "address[]", "uint256[]"],
      ["DCNT", "DCNT", [childGnosisSafe.address], [1000]]
    );

    await votesERC20.setUp(votesERC20SetupData);

    freezeLock = await new FreezeLock__factory(deployer).deploy();

    // Deploy MultisigFreezeGuard contract with a 60 block timelock period and 60 block execution period
    const freezeGuardSetupData = abiCoder.encode(
      ["uint256", "uint256", "address", "address", "address"],
      [
        60, // Timelock period
        60, // Execution period
        freezeGuardOwner.address,
        freezeLock.address,
        childGnosisSafe.address,
      ]
    );
    freezeGuard = await new MultisigFreezeGuard__factory(deployer).deploy();
    await freezeGuard.setUp(freezeGuardSetupData);

    const freezeVotingSetupData = abiCoder.encode(
      ["address", "uint256"],
      [
        freezeGuardOwner.address,
        200, // freeze duration in blocks
      ]
    );
    await freezeLock.setUp(freezeVotingSetupData);

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
      expect(await freezeLock.freezePeriod()).to.eq(200);
      expect(await freezeLock.owner()).to.eq(freezeGuardOwner.address);
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
        signatureBytes
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
          signatureBytes
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
        signatureBytes
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
        signatureBytes1
      );

      await freezeLock.connect(freezeGuardOwner).startFreeze();

      expect(await freezeLock.isFrozen()).to.eq(true);

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
        signatureBytes2
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
        signatureBytes1
      );

      await freezeLock.connect(freezeGuardOwner).startFreeze();

      // Check that the DAO has been frozen
      expect(await freezeLock.isFrozen()).to.eq(true);

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
        signatureBytes2
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

      expect(await freezeLock.isFrozen()).to.eq(true);

      // Move time forward to elapse freeze period
      await time.advanceBlocks(140);

      // Check that the DAO isn't frozen now
      expect(await freezeLock.isFrozen()).to.eq(false);
    });

    it("Previously Frozen DAOs may not execute TXs after execution period has elapsed", async () => {
      await freezeLock.connect(freezeGuardOwner).startFreeze();

      // Check that the DAO has been frozen
      expect(await freezeLock.isFrozen()).to.eq(true);

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
        signatureBytes1
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
      expect(await freezeLock.isFrozen()).to.eq(false);

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
      await freezeLock.connect(freezeGuardOwner).startFreeze();

      // Check that the DAO has been frozen
      expect(await freezeLock.isFrozen()).to.eq(true);
      await freezeLock.connect(freezeGuardOwner).unfreeze();
      expect(await freezeLock.isFrozen()).to.eq(false);

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
        signatureBytes1
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

    it("Only owner methods must be called by the owner", async () => {
      await expect(
        freezeLock.connect(childMultisigOwner1).unfreeze()
      ).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(
        freezeLock.connect(childMultisigOwner1).updateFreezePeriod(0)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
