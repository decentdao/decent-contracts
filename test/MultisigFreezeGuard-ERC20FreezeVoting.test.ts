import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, network } from "hardhat";
import time from "./time";
import {
  VotesERC20,
  VotesERC20__factory,
  ERC20FreezeVoting,
  ERC20FreezeVoting__factory,
  MultisigFreezeGuard,
  MultisigFreezeGuard__factory,
  ModuleProxyFactory,
} from "../typechain-types";
import {
  buildSignatureBytes,
  buildSafeTransaction,
  safeSignTypedData,
  ifaceSafe,
  abi,
  predictGnosisSafeAddress,
  abiSafe,
  calculateProxyAddress,
  SAFE_FACTORY_ADDRESS,
  SAFE_SINGLETON_ADDRESS,
} from "./helpers";

describe("Child Multisig DAO with Azorius Parent", () => {
  // Factories
  let gnosisFactory: Contract;

  // Deployed contracts
  let gnosisSafe: Contract;
  let freezeGuardMastercopy: MultisigFreezeGuard;
  let freezeGuard: MultisigFreezeGuard;
  let freezeVotingMastercopy: ERC20FreezeVoting;
  let freezeVoting: ERC20FreezeVoting;
  let votesERC20Mastercopy: VotesERC20;
  let votesERC20: VotesERC20;
  let moduleProxyFactory: ModuleProxyFactory;

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

  const moduleProxyFactoryAddress =
    "0x00000000000DC7F163742Eb4aBEf650037b1f588";
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
    gnosisFactory = new ethers.Contract(SAFE_FACTORY_ADDRESS, abi, deployer);

    // Get module proxy factory
    moduleProxyFactory = await ethers.getContractAt(
      "ModuleProxyFactory",
      moduleProxyFactoryAddress
    );

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
      SAFE_SINGLETON_ADDRESS,
      gnosisFactory
    );

    // Deploy Gnosis Safe
    await gnosisFactory.createProxyWithNonce(
      SAFE_SINGLETON_ADDRESS,
      createGnosisSetupCalldata,
      saltNum
    );

    // Get Gnosis Safe contract
    gnosisSafe = new ethers.Contract(
      predictedGnosisSafeAddress,
      abiSafe,
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
          [
            "DCNT",
            "DCNT",
            [tokenVetoer1.address, tokenVetoer2.address, gnosisSafe.address],
            [500, 600, 1000],
          ]
        ),
      ]);

    await moduleProxyFactory.deployModule(
      votesERC20Mastercopy.address,
      votesERC20SetupData,
      "10031021"
    );

    const predictedVotesERC20Address = await calculateProxyAddress(
      moduleProxyFactory,
      votesERC20Mastercopy.address,
      votesERC20SetupData,
      "10031021"
    );

    votesERC20 = await ethers.getContractAt(
      "VotesERC20",
      predictedVotesERC20Address
    );

    // Vetoers delegate their votes to themselves
    await votesERC20.connect(tokenVetoer1).delegate(tokenVetoer1.address);
    await votesERC20.connect(tokenVetoer2).delegate(tokenVetoer2.address);

    // Deploy ERC20FreezeVoting mastercopy contract
    freezeVotingMastercopy = await new ERC20FreezeVoting__factory(
      deployer
    ).deploy();

    // Initialize FreezeVoting contract
    const freezeVotingSetupData =
      // eslint-disable-next-line camelcase
      ERC20FreezeVoting__factory.createInterface().encodeFunctionData("setUp", [
        abiCoder.encode(
          ["address", "uint256", "uint32", "uint32", "address"],
          [
            freezeGuardOwner.address,
            1090, // freeze votes threshold
            10, // freeze proposal period
            200, // freeze period
            votesERC20.address,
          ]
        ),
      ]);

    await moduleProxyFactory.deployModule(
      freezeVotingMastercopy.address,
      freezeVotingSetupData,
      "10031021"
    );

    const predictedFreezeVotingAddress = await calculateProxyAddress(
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
    freezeGuardMastercopy = await new MultisigFreezeGuard__factory(
      deployer
    ).deploy();

    // Deploy MultisigFreezeGuard contract with a 60 block timelock period, and a 60 block execution period
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
              gnosisSafe.address,
            ]
          ),
        ]
      );

    await moduleProxyFactory.deployModule(
      freezeGuardMastercopy.address,
      freezeGuardSetupData,
      "10031021"
    );

    const predictedFreezeGuardAddress = await calculateProxyAddress(
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
      expect(await freezeVoting.freezeVotesThreshold()).to.eq(1090);
      expect(await freezeVoting.freezeProposalPeriod()).to.eq(10);
      expect(await freezeVoting.freezePeriod()).to.eq(200);
      expect(await freezeVoting.owner()).to.eq(freezeGuardOwner.address);
    });

    it("Updates state properly due to freeze actions", async () => {
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(0);
      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(0);

      // Vetoer 1 casts 500 freeze votes
      await freezeVoting.connect(tokenVetoer1).castFreezeVote();
      expect(await freezeVoting.isFrozen()).to.eq(false);
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(500);
      const latestBlock = await ethers.provider.getBlock("latest");
      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
        latestBlock.number
      );

      await freezeVoting.connect(tokenVetoer2).castFreezeVote();
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
        signatureBytes,
        tx.nonce
      );

      const latestBlock = await ethers.provider.getBlock("latest");

      const signaturesHash = ethers.utils.solidityKeccak256(
        ["bytes"],
        [signatureBytes]
      );

      expect(
        await freezeGuard.getTransactionTimelockedBlock(signaturesHash)
      ).to.eq(latestBlock.number);

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
        signatureBytes,
        tx.nonce
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

    it("A DAO may execute txs during a the freeze proposal period if the freeze threshold is not met", async () => {
      // Vetoer 1 casts 500 freeze votes
      await freezeVoting.connect(tokenVetoer1).castFreezeVote();

      // Check that the DAO has been frozen
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
        signatureBytes1,
        tx1.nonce
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
      ).to.emit(gnosisSafe, "ExecutionSuccess");
    });

    it("Casting a vote after the freeze voting period resets state", async () => {
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(0);
      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(0);

      // Vetoer 1 casts 500 freeze votes
      await freezeVoting.connect(tokenVetoer1).castFreezeVote();
      expect(await freezeVoting.isFrozen()).to.eq(false);
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(500);
      let latestBlock = await ethers.provider.getBlock("latest");
      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
        latestBlock.number
      );

      // Move time forward to elapse freeze proposal period
      await time.advanceBlocks(10);

      await freezeVoting.connect(tokenVetoer1).castFreezeVote();
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(500);
      latestBlock = await ethers.provider.getBlock("latest");
      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(
        latestBlock.number
      );
      expect(await freezeVoting.isFrozen()).to.eq(false);
    });

    it("A user cannot vote twice to freeze a dao during the same voting period", async () => {
      await freezeVoting.connect(tokenVetoer1).castFreezeVote();
      await expect(
        freezeVoting.connect(tokenVetoer1).castFreezeVote()
      ).to.be.revertedWith("AlreadyVoted()");
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(500);
    });

    it("An unfrozen DAO may not execute a previously passed transaction", async () => {
      // Vetoer 1 casts 500 freeze votes
      await freezeVoting.connect(tokenVetoer1).castFreezeVote();
      // Vetoer 2 casts 600 freeze votes
      await freezeVoting.connect(tokenVetoer2).castFreezeVote();

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
        signatureBytes1,
        tx1.nonce
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
      expect(await freezeVoting.isFrozen()).to.eq(false);
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
      // Vetoer 1 casts 500 freeze votes
      await freezeVoting.connect(tokenVetoer1).castFreezeVote();
      // Vetoer 2 casts 600 freeze votes
      await freezeVoting.connect(tokenVetoer2).castFreezeVote();

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
        signatureBytes1,
        tx1.nonce
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

    it("You must have voting weight to cast a freeze vote", async () => {
      await expect(
        freezeVoting.connect(freezeGuardOwner).castFreezeVote()
      ).to.be.revertedWith("NoVotes()");
      freezeVoting.connect(tokenVetoer1).castFreezeVote();
      await expect(
        freezeVoting.connect(freezeGuardOwner).castFreezeVote()
      ).to.be.revertedWith("NoVotes()");
    });

    it("Only owner methods must be called by vetoGuard owner", async () => {
      await expect(
        freezeVoting.connect(tokenVetoer1).unfreeze()
      ).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(
        freezeVoting.connect(tokenVetoer1).updateFreezeVotesThreshold(0)
      ).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(
        freezeVoting.connect(tokenVetoer1).updateFreezeProposalPeriod(0)
      ).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(
        freezeVoting.connect(tokenVetoer1).updateFreezePeriod(0)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Only the freeze voting owner can update the freeze votes threshold", async () => {
      expect(await freezeVoting.freezeVotesThreshold()).to.eq(1090);

      await freezeVoting
        .connect(freezeGuardOwner)
        .updateFreezeVotesThreshold(2000);

      expect(await freezeVoting.freezeVotesThreshold()).to.eq(2000);

      await expect(
        freezeVoting.connect(tokenVetoer1).updateFreezeVotesThreshold(3000)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Only the freeze voting owner can update the freeze proposal period", async () => {
      expect(await freezeVoting.freezeProposalPeriod()).to.eq(10);

      await freezeVoting
        .connect(freezeGuardOwner)
        .updateFreezeProposalPeriod(12);

      expect(await freezeVoting.freezeProposalPeriod()).to.eq(12);

      await expect(
        freezeVoting.connect(tokenVetoer1).updateFreezeProposalPeriod(14)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Only the freeze voting owner can update the freeze period", async () => {
      expect(await freezeVoting.freezePeriod()).to.eq(200);

      await freezeVoting.connect(freezeGuardOwner).updateFreezePeriod(300);

      expect(await freezeVoting.freezePeriod()).to.eq(300);

      await expect(
        freezeVoting.connect(tokenVetoer1).updateFreezePeriod(400)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Only the freeze guard owner can update the timelock period", async () => {
      expect(await freezeGuard.timelockPeriod()).to.eq(60);

      await freezeGuard.connect(freezeGuardOwner).updateTimelockPeriod(70);

      expect(await freezeGuard.timelockPeriod()).to.eq(70);

      await expect(
        freezeGuard.connect(tokenVetoer1).updateTimelockPeriod(80)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Only the freeze guard owner can update the execution period", async () => {
      expect(await freezeGuard.executionPeriod()).to.eq(60);

      await freezeGuard.connect(freezeGuardOwner).updateExecutionPeriod(80);

      expect(await freezeGuard.executionPeriod()).to.eq(80);

      await expect(
        freezeGuard.connect(tokenVetoer1).updateExecutionPeriod(90)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
