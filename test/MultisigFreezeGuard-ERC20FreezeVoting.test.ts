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

describe("Child Multisig DAO with Azorius Parent", () => {
  // Factories
  let gnosisFactory: Contract;

  // Deployed contracts
  let gnosisSafe: Contract;
  let freezeGuard: MultisigFreezeGuard;
  let freezeLock: FreezeLock;
  let votesERC20: VotesERC20;

  // Wallets
  let deployer: SignerWithAddress;
  let owner1: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;
  let tokenVetoer1: SignerWithAddress;
  let tokenVetoer2: SignerWithAddress;
  let freezeGuardOwner: SignerWithAddress;

  // Gnosis
  let createGnosisSetupCalldata: string;

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
      owner1,
      owner2,
      owner3,
      tokenVetoer1,
      tokenVetoer2,
      freezeGuardOwner,
    ] = await ethers.getSigners();

    // Get deployed Gnosis Safe
    gnosisFactory = new ethers.Contract(gnosisFactoryAddress, abi, deployer);

    createGnosisSetupCalldata = ifaceSafe.encodeFunctionData("setup", [
      [owner1.address, owner2.address, owner3.address],
      threshold,
      ethers.constants.AddressZero,
      ethers.constants.HashZero,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      0,
      ethers.constants.AddressZero,
    ]);

    const predictedGnosisSafeAddress = await predictGnosisSafeAddress(
      gnosisFactory.address,
      createGnosisSetupCalldata,
      saltNum,
      gnosisSingletonAddress,
      gnosisFactory
    );

    // Deploy Gnosis Safe
    await gnosisFactory.createProxyWithNonce(
      gnosisSingletonAddress,
      createGnosisSetupCalldata,
      saltNum
    );

    // Get Gnosis Safe contract
    gnosisSafe = new ethers.Contract(
      predictedGnosisSafeAddress,
      abiSafe,
      deployer
    );

    // Deploy token, allocate supply to two token vetoers and Gnosis Safe
    votesERC20 = await new VotesERC20__factory(deployer).deploy();

    const abiCoder = new ethers.utils.AbiCoder(); // encode data
    const votesERC20SetupData = abiCoder.encode(
      ["string", "string", "address[]", "uint256[]"],
      [
        "DCNT",
        "DCNT",
        [tokenVetoer1.address, tokenVetoer2.address, gnosisSafe.address],
        [500, 600, 1000],
      ]
    );

    await votesERC20.setUp(votesERC20SetupData);

    // Vetoers delegate their votes to themselves
    await votesERC20.connect(tokenVetoer1).delegate(tokenVetoer1.address);
    await votesERC20.connect(tokenVetoer2).delegate(tokenVetoer2.address);

    // Deploy ERC20FreezeVoting contract
    freezeLock = await new FreezeLock__factory(deployer).deploy();

    // Deploy MultisigFreezeGuard contract with a 60 block timelock period, and a 60 block execution period
    const freezeGuardSetupData = abiCoder.encode(
      ["uint256", "uint256", "address", "address", "address"],
      [
        60, // Timelock period
        60, // Execution period
        freezeGuardOwner.address,
        freezeLock.address,
        gnosisSafe.address,
      ]
    );
    freezeGuard = await new MultisigFreezeGuard__factory(deployer).deploy();
    await freezeGuard.setUp(freezeGuardSetupData);

    // Initialize FreezeVoting contract
    const freezeVotingSetupData = abiCoder.encode(
      ["address", "uint256"],
      [
        freezeGuardOwner.address,
        200, // freeze period
      ]
    );
    await freezeLock.setUp(freezeVotingSetupData);

    // Create transaction to set the guard address
    const setGuardData = gnosisSafe.interface.encodeFunctionData("setGuard", [
      freezeGuard.address,
    ]);

    const tx = buildSafeTransaction({
      to: gnosisSafe.address,
      data: setGuardData,
      safeTxGas: 1000000,
      nonce: await gnosisSafe.nonce(),
    });
    const sigs = [
      await safeSignTypedData(owner1, gnosisSafe, tx),
      await safeSignTypedData(owner2, gnosisSafe, tx),
    ];
    const signatureBytes = buildSignatureBytes(sigs);

    // Execute transaction that adds the veto guard to the Safe
    await expect(
      gnosisSafe.execTransaction(
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
    ).to.emit(gnosisSafe, "ExecutionSuccess");

    // Gnosis Safe received the 1,000 tokens
    expect(await votesERC20.balanceOf(gnosisSafe.address)).to.eq(1000);
  });

  describe("FreezeGuard Functionality", () => {
    it("Freeze parameters correctly setup", async () => {
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
        nonce: await gnosisSafe.nonce(),
      });

      const sigs = [
        await safeSignTypedData(owner1, gnosisSafe, tx),
        await safeSignTypedData(owner2, gnosisSafe, tx),
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

      await gnosisSafe.execTransaction(
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

      expect(await votesERC20.balanceOf(gnosisSafe.address)).to.eq(0);
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
        nonce: await gnosisSafe.nonce(),
      });

      const sigs = [
        await safeSignTypedData(owner1, gnosisSafe, tx),
        await safeSignTypedData(owner2, gnosisSafe, tx),
      ];
      const signatureBytes = buildSignatureBytes(sigs);

      await expect(
        gnosisSafe.execTransaction(
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
        nonce: await gnosisSafe.nonce(),
      });

      // Only 1 signer signs, while the threshold is 2
      const sigs = [await safeSignTypedData(owner1, gnosisSafe, tx)];
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
        nonce: await gnosisSafe.nonce(),
      });

      const sigs = [
        await safeSignTypedData(owner1, gnosisSafe, tx),
        await safeSignTypedData(owner2, gnosisSafe, tx),
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
        gnosisSafe.execTransaction(
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

    it("An unfrozen DAO may not execute a previously passed transaction", async () => {
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
        nonce: await gnosisSafe.nonce(),
      });

      const sigs1 = [
        await safeSignTypedData(owner1, gnosisSafe, tx1),
        await safeSignTypedData(owner2, gnosisSafe, tx1),
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
        gnosisSafe.execTransaction(
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
      await expect(
        gnosisSafe.execTransaction(
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
        nonce: await gnosisSafe.nonce(),
      });

      const sigs1 = [
        await safeSignTypedData(owner1, gnosisSafe, tx1),
        await safeSignTypedData(owner2, gnosisSafe, tx1),
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
        gnosisSafe.execTransaction(
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
      ).to.emit(gnosisSafe, "ExecutionSuccess");
    });

    it("Only owner methods must be called by vetoGuard owner", async () => {
      await expect(
        freezeLock.connect(tokenVetoer1).unfreeze()
      ).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(
        freezeLock.connect(tokenVetoer1).updateFreezePeriod(0)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
