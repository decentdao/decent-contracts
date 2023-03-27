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
  MockVotingStrategy,
  MockVotingStrategy__factory,
  Azorius,
  Azorius__factory,
  VotesERC20,
  VotesERC20__factory,
} from "../typechain-types";

import {
  buildSignatureBytes,
  buildSafeTransaction,
  safeSignTypedData,
  ifaceSafe,
  predictGnosisSafeAddress,
} from "./helpers";

describe("Safe with Azorius module and linearERC20Voting", () => {
  // Deployed contracts
  let gnosisSafe: GnosisSafe;
  let azorius: Azorius;
  let linearERC20Voting: LinearERC20Voting;
  let mockVotingStrategy: MockVotingStrategy;
  let votesERC20: VotesERC20;
  let gnosisSafeProxyFactory: GnosisSafeProxyFactory;

  // Wallets
  let deployer: SignerWithAddress;
  let gnosisSafeOwner: SignerWithAddress;
  let tokenHolder1: SignerWithAddress;
  let tokenHolder2: SignerWithAddress;
  let tokenHolder3: SignerWithAddress;
  let mockStrategy1: SignerWithAddress;
  let mockStrategy2: SignerWithAddress;

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
      gnosisSafeOwner,
      tokenHolder1,
      tokenHolder2,
      tokenHolder3,
      mockStrategy1,
      mockStrategy2,
    ] = await ethers.getSigners();

    // Deploy Gnosis Safe Proxy factory
    gnosisSafeProxyFactory = await ethers.getContractAt(
      "GnosisSafeProxyFactory",
      gnosisFactoryAddress
    );

    createGnosisSetupCalldata = ifaceSafe.encodeFunctionData("setup", [
      [gnosisSafeOwner.address],
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

    gnosisSafe = await ethers.getContractAt(
      "GnosisSafe",
      predictedGnosisSafeAddress
    );

    // Votes ERC-20
    votesERC20 = await new VotesERC20__factory(deployer).deploy();

    const votesERC20SetupData = abiCoder.encode(
      ["string", "string", "address[]", "uint256[]"],
      [
        "DCNT",
        "DCNT",
        [
          tokenHolder1.address,
          tokenHolder2.address,
          tokenHolder3.address,
          gnosisSafe.address,
        ],
        [100, 200, 300, 600],
      ]
    );

    await votesERC20.setUp(votesERC20SetupData);

    // Token holders delegate votes
    // Token holder 1 delegates to token holder 2, so final vote counts should be:
    // tokenHolder1 => 0
    // tokenHolder2 => 300
    // tokenHolder3 => 300
    await votesERC20.connect(tokenHolder1).delegate(tokenHolder2.address);
    await votesERC20.connect(tokenHolder2).delegate(tokenHolder2.address);
    await votesERC20.connect(tokenHolder3).delegate(tokenHolder3.address);

    // Deploy Azorius module
    azorius = await new Azorius__factory(deployer).deploy();

    const azoriusSetupData = abiCoder.encode(
      ["address", "address", "address", "address[]", "uint256", "uint256"],
      [
        gnosisSafeOwner.address,
        gnosisSafe.address,
        gnosisSafe.address,
        [],
        60, // timelock period in blocks
        60, // execution period in blocks
      ]
    );

    await azorius.setUp(azoriusSetupData);

    // Deploy Linear ERC20 Voting Strategy
    linearERC20Voting = await new LinearERC20Voting__factory(deployer).deploy();

    const linearERC20VotingSetupData = abiCoder.encode(
      [
        "address",
        "address",
        "address",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
      ],
      [
        gnosisSafeOwner.address, // owner
        votesERC20.address, // governance token
        azorius.address, // Azorius module
        60, // voting period in blocks
        0, // proposer weight
        500000, // quorom numerator, denominator is 1,000,000, so quorum percentage is 50%
        500000, // basis numerator, denominator is 1,000,000, so basis percentage is 50% (simple majority)
      ]
    );

    await linearERC20Voting.setUp(linearERC20VotingSetupData);

    // Enable the Linear Voting strategy on Azorius
    await azorius
      .connect(gnosisSafeOwner)
      .enableStrategy(linearERC20Voting.address);

    // Create transaction on Gnosis Safe to setup Azorius module
    const enableAzoriusModuleData = gnosisSafe.interface.encodeFunctionData(
      "enableModule",
      [azorius.address]
    );

    const enableAzoriusModuleTx = buildSafeTransaction({
      to: gnosisSafe.address,
      data: enableAzoriusModuleData,
      safeTxGas: 1000000,
      nonce: (await gnosisSafe.nonce()).toNumber(),
    });

    const sigs = [
      await safeSignTypedData(
        gnosisSafeOwner,
        gnosisSafe,
        enableAzoriusModuleTx
      ),
    ];

    const signatureBytes = buildSignatureBytes(sigs);

    // Execute transaction that adds the Azorius module to the Safe
    await expect(
      gnosisSafe.execTransaction(
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
    ).to.emit(gnosisSafe, "ExecutionSuccess");

    // Gnosis Safe received the 1,000 tokens
    expect(await votesERC20.balanceOf(gnosisSafe.address)).to.eq(600);
  });

  describe("Safe with Azorius module and linearERC20Voting", () => {
    it("Gets correctly initialized", async () => {
      expect(await linearERC20Voting.owner()).to.eq(gnosisSafeOwner.address);
      expect(await linearERC20Voting.governanceToken()).to.eq(
        votesERC20.address
      );
      expect(await linearERC20Voting.azoriusModule()).to.eq(azorius.address);
      expect(await linearERC20Voting.votingPeriod()).to.eq(60);
      expect(await linearERC20Voting.quorumNumerator()).to.eq(500000);
    });

    it("A strategy cannot be enabled more than once", async () => {
      await expect(
        azorius
          .connect(gnosisSafeOwner)
          .enableStrategy(linearERC20Voting.address)
      ).to.be.revertedWith("StrategyEnabled()");
    });

    it("An invalid strategy cannot be enabled", async () => {
      await expect(
        azorius
          .connect(gnosisSafeOwner)
          .enableStrategy(ethers.constants.AddressZero)
      ).to.be.revertedWith("InvalidStrategy()");
    });

    it("An invalid strategy cannot be disabled", async () => {
      await expect(
        azorius
          .connect(gnosisSafeOwner)
          .disableStrategy(
            ethers.constants.AddressZero,
            ethers.constants.AddressZero
          )
      ).to.be.revertedWith("InvalidStrategy()");
    });

    it("Multiple strategies can be enabled, disabled, and returned", async () => {
      await azorius
        .connect(gnosisSafeOwner)
        .enableStrategy(mockStrategy1.address);

      await azorius
        .connect(gnosisSafeOwner)
        .enableStrategy(mockStrategy2.address);

      expect(
        (
          await azorius.getStrategies(
            "0x0000000000000000000000000000000000000001",
            3
          )
        )._strategies
      ).to.deep.eq([
        mockStrategy2.address,
        mockStrategy1.address,
        linearERC20Voting.address,
      ]);

      await azorius
        .connect(gnosisSafeOwner)
        .disableStrategy(mockStrategy2.address, mockStrategy1.address);

      expect(
        (
          await azorius.getStrategies(
            "0x0000000000000000000000000000000000000001",
            3
          )
        )._strategies
      ).to.deep.eq([mockStrategy2.address, linearERC20Voting.address]);
    });

    it("An invalid strategy cannot be disabled", async () => {
      await expect(
        azorius
          .connect(gnosisSafeOwner)
          .disableStrategy(ethers.constants.AddressZero, mockStrategy2.address)
      ).to.be.revertedWith("StrategyDisabled()");
    });

    it("The owner can change the Azorius Module on the Strategy", async () => {
      await linearERC20Voting
        .connect(gnosisSafeOwner)
        .setAzorius(deployer.address);

      expect(await linearERC20Voting.azoriusModule()).to.eq(deployer.address);
    });

    it("A non-owner cannot change the Azorius Module on the Strategy", async () => {
      await expect(
        linearERC20Voting.connect(tokenHolder1).setAzorius(deployer.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("The owner can update the voting period", async () => {
      expect(await linearERC20Voting.votingPeriod()).to.eq(60);
      await linearERC20Voting.connect(gnosisSafeOwner).updateVotingPeriod(120);

      expect(await linearERC20Voting.votingPeriod()).to.eq(120);
    });

    it("A non-owner cannot update the strategy voting period", async () => {
      await expect(
        linearERC20Voting.connect(tokenHolder1).updateVotingPeriod(120)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("The owner can update the timelock period", async () => {
      expect(await azorius.timelockPeriod()).to.eq(60);
      await azorius.connect(gnosisSafeOwner).updateTimelockPeriod(120);

      expect(await azorius.timelockPeriod()).to.eq(120);
    });

    it("A non-owner cannot update the strategy timelock period", async () => {
      await expect(
        azorius.connect(tokenHolder1).updateTimelockPeriod(120)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Getting proposal state on an invalid proposal ID reverts", async () => {
      await expect(azorius.proposalState(0)).to.be.revertedWith(
        "InvalidProposal()"
      );

      await expect(azorius.proposalState(0)).to.be.revertedWith(
        "InvalidProposal()"
      );
    });

    it("A proposal cannot be submitted if the specified strategy has not been enabled", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      // Use an incorrect address for the strategy
      await expect(
        azorius.submitProposal(
          votesERC20.address,
          "0x",
          [proposalTransaction],
          ""
        )
      ).to.be.revertedWith("StrategyDisabled()");
    });

    it("Proposal cannot be received by the strategy from address other than Azorius", async () => {
      // Submit call from address that isn't Azorius module
      await expect(linearERC20Voting.initializeProposal([])).to.be.revertedWith(
        "OnlyAzorius()"
      );
    });

    it("Votes cannot be cast on a proposal that hasn't been submitted yet", async () => {
      // User attempts to vote on proposal that has not yet been submitted
      await expect(
        linearERC20Voting.connect(tokenHolder2).vote(0, 1)
      ).to.be.revertedWith("InvalidProposal()");
    });

    it("Votes cannot be cast after the voting period has ended", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      // Increase blocks so that voting period has ended
      await time.advanceBlocks(60);

      // Users vote in support of proposal
      await expect(
        linearERC20Voting.connect(tokenHolder2).vote(0, 1)
      ).to.be.revertedWith("VotingEnded()");
    });

    it("A voter cannot vote more than once on a proposal", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      // Users vote in support of proposal
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await expect(
        linearERC20Voting.connect(tokenHolder2).vote(0, 1)
      ).to.be.revertedWith("AlreadyVoted()");
    });

    it("Correctly counts proposal Yes votes", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      expect((await linearERC20Voting.getProposalVotes(0)).yesVotes).to.eq(0);

      // Token holder 1 votes but does not have any voting weight
      await linearERC20Voting.connect(tokenHolder1).vote(0, 1);

      expect((await linearERC20Voting.getProposalVotes(0)).yesVotes).to.eq(0);

      // Token holder 2 votes with voting weight of 300
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);

      expect((await linearERC20Voting.getProposalVotes(0)).yesVotes).to.eq(300);

      // Token holder 3 votes with voting weight of 300
      await linearERC20Voting.connect(tokenHolder3).vote(0, 1);

      expect((await linearERC20Voting.getProposalVotes(0)).yesVotes).to.eq(600);
    });

    it("Correctly counts proposal No votes", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      expect((await linearERC20Voting.getProposalVotes(0)).noVotes).to.eq(0);

      // Token holder 1 votes but does not have any voting weight
      await linearERC20Voting.connect(tokenHolder1).vote(0, 0);

      expect((await linearERC20Voting.getProposalVotes(0)).noVotes).to.eq(0);

      // Token holder 2 votes with voting weight of 300
      await linearERC20Voting.connect(tokenHolder2).vote(0, 0);

      expect((await linearERC20Voting.getProposalVotes(0)).noVotes).to.eq(300);

      // Token holder 3 votes with voting weight of 300
      await linearERC20Voting.connect(tokenHolder3).vote(0, 0);

      expect((await linearERC20Voting.getProposalVotes(0)).noVotes).to.eq(600);
    });

    it("Correctly counts proposal Abstain votes", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      expect((await linearERC20Voting.getProposalVotes(0)).abstainVotes).to.eq(
        0
      );

      // Token holder 1 votes but does not have any voting weight
      await linearERC20Voting.connect(tokenHolder1).vote(0, 2);

      expect((await linearERC20Voting.getProposalVotes(0)).abstainVotes).to.eq(
        0
      );

      // Token holder 2 votes with voting weight of 300
      await linearERC20Voting.connect(tokenHolder2).vote(0, 2);

      expect((await linearERC20Voting.getProposalVotes(0)).abstainVotes).to.eq(
        300
      );

      // Token holder 3 votes with voting weight of 300
      await linearERC20Voting.connect(tokenHolder3).vote(0, 2);

      expect((await linearERC20Voting.getProposalVotes(0)).abstainVotes).to.eq(
        600
      );
    });

    it("A proposal is passed with enough Yes votes and quorum", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      await expect(await linearERC20Voting.isPassed(0)).to.be.false;

      // Users vote in support of proposal
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 1);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      await expect(await linearERC20Voting.isPassed(0)).to.be.true;

      // Proposal is timelocked
      await expect(await azorius.proposalState(0)).to.eq(1);
    });

    it("A proposal is not passed if there are more No votes than Yes votes", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      await expect(await linearERC20Voting.isPassed(0)).to.be.false;

      // Users vote against
      await linearERC20Voting.connect(tokenHolder2).vote(0, 0);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 0);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      await expect(await linearERC20Voting.isPassed(0)).to.be.false;

      // Proposal is in the failed state
      expect(await azorius.proposalState(0)).to.eq(5);

      await expect(
        azorius.executeProposal(
          0,
          [votesERC20.address],
          [0],
          [tokenTransferData],
          [0]
        )
      ).to.be.revertedWith("ProposalNotExecutable()");
    });

    it("A proposal is not passed if quorum is not reached", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      await expect(await linearERC20Voting.isPassed(0)).to.be.false;

      // User votes "Yes"
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      await expect(await linearERC20Voting.isPassed(0)).to.be.false;

      await expect(
        azorius.executeProposal(
          0,
          [votesERC20.address],
          [0],
          [tokenTransferData],
          [0]
        )
      ).to.be.revertedWith("ProposalNotExecutable()");

      // Proposal in the failed state
      expect(await azorius.proposalState(0)).to.eq(5);
    });

    it("A proposal is not passed if voting period is not over", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      await expect(await linearERC20Voting.isPassed(0)).to.be.false;

      // Users vote "Yes"
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 1);

      await expect(await linearERC20Voting.isPassed(0)).to.be.false;

      await expect(
        azorius.executeProposal(
          0,
          [votesERC20.address],
          [0],
          [tokenTransferData],
          [0]
        )
      ).to.be.revertedWith("ProposalNotExecutable()");

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);
    });

    it("Submitting a proposal emits the event with the associated proposal metadata", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      const proposalMetadata = "This is my amazing proposal!";

      const tx = await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        proposalMetadata
      );
      const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
      const data = receipt.logs[1].data;
      const topics = receipt.logs[1].topics;
      const event = azorius.interface.decodeEventLog(
        "ProposalCreated",
        data,
        topics
      );

      // Check that the event emits the correct values
      expect(event.transactions[0].to).to.be.equal(proposalTransaction.to);
      expect(event.transactions[0].value).to.be.equal(
        proposalTransaction.value
      );
      expect(event.transactions[0].data).to.be.equal(proposalTransaction.data);
      expect(event.transactions[0].operation).to.be.equal(
        proposalTransaction.operation
      );

      expect(event.metadata).to.be.equal(proposalMetadata);
    });

    it("A proposal can be created and executed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      const txHash = await azorius.getTxHash(
        votesERC20.address,
        BigNumber.from(0),
        tokenTransferData,
        0
      );

      const proposalTxHashes = await azorius.getProposalTxHashes(0);

      const proposalTxHash = await azorius.getProposalTxHash(0, 0);

      expect([txHash]).to.deep.eq(proposalTxHashes);

      expect(txHash).to.deep.eq(proposalTxHash);

      expect(await azorius.getProposal(0)).to.deep.eq([
        linearERC20Voting.address,
        [txHash],
        BigNumber.from("60"),
        BigNumber.from("60"),
        BigNumber.from("0"),
      ]);

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      // Users haven't voted yet
      expect(await linearERC20Voting.hasVoted(0, tokenHolder2.address)).to.eq(
        false
      );
      expect(await linearERC20Voting.hasVoted(0, tokenHolder3.address)).to.eq(
        false
      );

      // Users vote in support of proposal
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 1);

      // Users have voted
      expect(await linearERC20Voting.hasVoted(0, tokenHolder2.address)).to.eq(
        true
      );
      expect(await linearERC20Voting.hasVoted(0, tokenHolder3.address)).to.eq(
        true
      );

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azorius.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is executable
      expect(await azorius.proposalState(0)).to.eq(2);

      expect(await votesERC20.balanceOf(gnosisSafe.address)).to.eq(600);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azorius.executeProposal(
        0,
        [votesERC20.address],
        [0],
        [tokenTransferData],
        [0]
      );

      expect(await azorius.getProposal(0)).to.deep.eq([
        linearERC20Voting.address,
        [txHash],
        BigNumber.from("60"),
        BigNumber.from("60"),
        BigNumber.from("1"),
      ]);

      expect(await votesERC20.balanceOf(gnosisSafe.address)).to.eq(0);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(600);

      // Proposal is in the executed state
      expect(await azorius.proposalState(0)).to.eq(3);
    });

    it("Multiple transactions can be executed from a single proposal", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 100]
      );

      const tokenTransferData2 = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 200]
      );

      const tokenTransferData3 = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 300]
      );

      const proposalTransaction1 = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData1,
        operation: 0,
      };

      const proposalTransaction2 = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData2,
        operation: 0,
      };

      const proposalTransaction3 = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData3,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction1, proposalTransaction2, proposalTransaction3],
        ""
      );

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      // Users vote in support of proposal
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 1);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azorius.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is executable
      expect(await azorius.proposalState(0)).to.eq(2);

      expect(await votesERC20.balanceOf(gnosisSafe.address)).to.eq(600);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azorius.executeProposal(
        0,
        [votesERC20.address, votesERC20.address, votesERC20.address],
        [0, 0, 0],
        [tokenTransferData1, tokenTransferData2, tokenTransferData3],
        [0, 0, 0]
      );

      expect(await votesERC20.balanceOf(gnosisSafe.address)).to.eq(0);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(600);

      // Proposal is executed
      expect(await azorius.proposalState(0)).to.eq(3);
    });

    it("Executing a proposal reverts if the transaction cannot be executed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 700]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      // Users vote in support of proposal
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 1);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azorius.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is executable
      expect(await azorius.proposalState(0)).to.eq(2);

      expect(await votesERC20.balanceOf(gnosisSafe.address)).to.eq(600);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await expect(
        azorius.executeProposal(
          0,
          [votesERC20.address],
          [0],
          [tokenTransferData],
          [0]
        )
      ).to.be.revertedWith("TxFailed()");

      // Proposal is executable
      expect(await azorius.proposalState(0)).to.eq(2);

      expect(await votesERC20.balanceOf(gnosisSafe.address)).to.eq(600);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(0);
    });

    it("If a proposal is not executed during the execution period, it becomes expired", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      // Users vote in support of proposal
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 1);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azorius.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is executable
      expect(await azorius.proposalState(0)).to.eq(2);

      // Increase time so that execution period has ended
      await time.advanceBlocks(60);

      // Proposal is expired
      expect(await azorius.proposalState(0)).to.eq(4);

      // Execute the transaction
      await expect(
        azorius.executeProposal(
          0,
          [votesERC20.address],
          [0],
          [tokenTransferData],
          [0]
        )
      ).to.be.revertedWith("ProposalNotExecutable()");
    });

    it("A proposal with no transactions that passes goes immediately to executed", async () => {
      await azorius.submitProposal(linearERC20Voting.address, "0x", [], "");

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      await expect(await linearERC20Voting.isPassed(0)).to.be.false;

      // Users vote in support of proposal
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 1);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      await expect(await linearERC20Voting.isPassed(0)).to.be.true;

      // Proposal is executed
      await expect(await azorius.proposalState(0)).to.eq(3);
    });

    it("Only the owner can update the timelock period on Azorius", async () => {
      expect(await azorius.timelockPeriod()).to.eq(60);

      await azorius.connect(gnosisSafeOwner).updateTimelockPeriod(70);

      expect(await azorius.timelockPeriod()).to.eq(70);

      await expect(
        azorius.connect(tokenHolder1).updateTimelockPeriod(80)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Only the owner can update the execution period on Azorius", async () => {
      expect(await azorius.executionPeriod()).to.eq(60);

      await azorius.connect(gnosisSafeOwner).updateExecutionPeriod(100);

      expect(await azorius.executionPeriod()).to.eq(100);

      await expect(
        azorius.connect(tokenHolder1).updateExecutionPeriod(110)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Only the owner can update the quorum numerator on the ERC20LinearVoting", async () => {
      expect(await linearERC20Voting.quorumNumerator()).to.eq(500000);

      await linearERC20Voting
        .connect(gnosisSafeOwner)
        .updateQuorumNumerator(600000);

      expect(await linearERC20Voting.quorumNumerator()).to.eq(600000);

      await expect(
        linearERC20Voting.connect(tokenHolder1).updateQuorumNumerator(700000)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Quorum numerator cannot be updated to a value larger than the denominator", async () => {
      await expect(
        linearERC20Voting
          .connect(gnosisSafeOwner)
          .updateQuorumNumerator(1000001)
      ).to.be.revertedWith("InvalidQuorumNumerator()");
    });

    it("Only the owner can update the basis numerator on the ERC20LinearVoting", async () => {
      expect(await linearERC20Voting.basisNumerator()).to.eq(500000);

      await linearERC20Voting
        .connect(gnosisSafeOwner)
        .updateBasisNumerator(600000);

      expect(await linearERC20Voting.basisNumerator()).to.eq(600000);

      await expect(
        linearERC20Voting.connect(tokenHolder1).updateBasisNumerator(700000)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Basis numerator cannot be updated to a value larger than the denominator", async () => {
      await expect(
        linearERC20Voting.connect(gnosisSafeOwner).updateBasisNumerator(1000001)
      ).to.be.revertedWith("InvalidBasisNumerator()");
    });

    it("Only the owner can update the proposer weight on the ERC20LinearVoting", async () => {
      expect(await linearERC20Voting.proposerWeight()).to.eq(0);

      await linearERC20Voting.connect(gnosisSafeOwner).updateProposerWeight(1);

      expect(await linearERC20Voting.proposerWeight()).to.eq(1);

      await expect(
        linearERC20Voting.connect(tokenHolder1).updateProposerWeight(2)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Linear ERC20 voting contract cannot be setup with an invalid governance token address", async () => {
      const abiCoder = new ethers.utils.AbiCoder();

      // Deploy Linear ERC20 Voting Strategy
      linearERC20Voting = await new LinearERC20Voting__factory(
        deployer
      ).deploy();

      const linearERC20VotingSetupData = abiCoder.encode(
        [
          "address",
          "address",
          "address",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
        ],
        [
          gnosisSafeOwner.address, // owner
          ethers.constants.AddressZero, // governance token
          azorius.address, // Azorius module
          60, // voting period in blocks
          0, // proposer weight
          500000, // quorom numerator, denominator is 1,000,000, so quorum percentage is 50%
          500000, // basis numerator, denominator is 1,000,000, so basis percentage is 50% (simple majority)
        ]
      );

      await expect(
        linearERC20Voting.setUp(linearERC20VotingSetupData)
      ).to.be.revertedWith("InvalidTokenAddress()");
    });

    it("An invalid vote type cannot be cast", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      // Users cast invalid vote types
      await expect(
        linearERC20Voting.connect(tokenHolder2).vote(0, 3)
      ).to.be.revertedWith("InvalidVote()");
      await expect(
        linearERC20Voting.connect(tokenHolder2).vote(0, 4)
      ).to.be.revertedWith("InvalidVote()");
      await expect(
        linearERC20Voting.connect(tokenHolder2).vote(0, 5)
      ).to.be.revertedWith("InvalidVote()");
    });

    it("Azorius can be setup with multiple strategies", async () => {
      const abiCoder = new ethers.utils.AbiCoder();

      // Deploy Azorius module
      azorius = await new Azorius__factory(deployer).deploy();

      const azoriusSetupData = abiCoder.encode(
        ["address", "address", "address", "address[]", "uint256", "uint256"],
        [
          gnosisSafeOwner.address,
          gnosisSafe.address,
          gnosisSafe.address,
          [tokenHolder1.address, tokenHolder2.address, tokenHolder3.address],
          60, // timelock period in blocks
          60, // execution period in blocks
        ]
      );

      await azorius.setUp(azoriusSetupData);

      expect(await azorius.isStrategyEnabled(tokenHolder1.address)).to.eq(true);
      expect(await azorius.isStrategyEnabled(tokenHolder2.address)).to.eq(true);
      expect(await azorius.isStrategyEnabled(tokenHolder3.address)).to.eq(true);
    });

    it("Only a valid proposer can submit proposals", async () => {
      const abiCoder = new ethers.utils.AbiCoder();

      // Deploy Mock Voting Strategy
      mockVotingStrategy = await new MockVotingStrategy__factory(
        deployer
      ).deploy();

      const mockVotingStrategySetupData = abiCoder.encode(
        ["address"],
        [
          tokenHolder1.address, // tokenHolder1 is the only valid proposer
        ]
      );

      await mockVotingStrategy.setUp(mockVotingStrategySetupData);

      // Enable the Mock Voting strategy on Azorius
      await azorius
        .connect(gnosisSafeOwner)
        .enableStrategy(mockVotingStrategy.address);

      expect(await mockVotingStrategy.isProposer(tokenHolder1.address)).to.eq(
        true
      );
      expect(await mockVotingStrategy.isProposer(tokenHolder2.address)).to.eq(
        false
      );

      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      // This user was setup as the proposer on the MockVotingStrategy, so should be able to submit a proposal
      await azorius
        .connect(tokenHolder1)
        .submitProposal(
          mockVotingStrategy.address,
          "0x",
          [proposalTransaction],
          ""
        );

      // This user was not setup as the proposer, and so should not be able to submit a proposal
      await expect(
        azorius
          .connect(tokenHolder2)
          .submitProposal(
            mockVotingStrategy.address,
            "0x",
            [proposalTransaction],
            ""
          )
      ).to.be.revertedWith("InvalidProposer()");

      expect(await mockVotingStrategy.isPassed(0)).to.eq(false);
      expect(await mockVotingStrategy.votingEndBlock(0)).to.eq(0);
    });

    it("A proposal cannot be executed if targets array length is zero", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      const txHash = await azorius.getTxHash(
        votesERC20.address,
        BigNumber.from(0),
        tokenTransferData,
        0
      );

      const proposalTxHashes = await azorius.getProposalTxHashes(0);

      const proposalTxHash = await azorius.getProposalTxHash(0, 0);

      expect([txHash]).to.deep.eq(proposalTxHashes);

      expect(txHash).to.deep.eq(proposalTxHash);

      expect(await azorius.getProposal(0)).to.deep.eq([
        linearERC20Voting.address,
        [txHash],
        BigNumber.from("60"),
        BigNumber.from("60"),
        BigNumber.from("0"),
      ]);

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      // Users haven't voted yet
      expect(await linearERC20Voting.hasVoted(0, tokenHolder2.address)).to.eq(
        false
      );
      expect(await linearERC20Voting.hasVoted(0, tokenHolder3.address)).to.eq(
        false
      );

      // Users vote in support of proposal
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 1);

      // Users have voted
      expect(await linearERC20Voting.hasVoted(0, tokenHolder2.address)).to.eq(
        true
      );
      expect(await linearERC20Voting.hasVoted(0, tokenHolder3.address)).to.eq(
        true
      );

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azorius.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is executable
      expect(await azorius.proposalState(0)).to.eq(2);

      expect(await votesERC20.balanceOf(gnosisSafe.address)).to.eq(600);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await expect(
        azorius.executeProposal(0, [], [], [], [])
      ).to.be.revertedWith("InvalidTxs()");
    });

    it("A proposal cannot be executed if unequal array lengths are passed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      const txHash = await azorius.getTxHash(
        votesERC20.address,
        BigNumber.from(0),
        tokenTransferData,
        0
      );

      const proposalTxHashes = await azorius.getProposalTxHashes(0);

      const proposalTxHash = await azorius.getProposalTxHash(0, 0);

      expect([txHash]).to.deep.eq(proposalTxHashes);

      expect(txHash).to.deep.eq(proposalTxHash);

      expect(await azorius.getProposal(0)).to.deep.eq([
        linearERC20Voting.address,
        [txHash],
        BigNumber.from("60"),
        BigNumber.from("60"),
        BigNumber.from("0"),
      ]);

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      // Users haven't voted yet
      expect(await linearERC20Voting.hasVoted(0, tokenHolder2.address)).to.eq(
        false
      );
      expect(await linearERC20Voting.hasVoted(0, tokenHolder3.address)).to.eq(
        false
      );

      // Users vote in support of proposal
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 1);

      // Users have voted
      expect(await linearERC20Voting.hasVoted(0, tokenHolder2.address)).to.eq(
        true
      );
      expect(await linearERC20Voting.hasVoted(0, tokenHolder3.address)).to.eq(
        true
      );

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azorius.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is executable
      expect(await azorius.proposalState(0)).to.eq(2);

      expect(await votesERC20.balanceOf(gnosisSafe.address)).to.eq(600);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await expect(
        azorius.executeProposal(0, [votesERC20.address], [], [], [0])
      ).to.be.revertedWith("InvalidArrayLengths()");
    });

    it("A proposal cannot be executed if too many TXs are passed to it", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      const txHash = await azorius.getTxHash(
        votesERC20.address,
        BigNumber.from(0),
        tokenTransferData,
        0
      );

      const proposalTxHashes = await azorius.getProposalTxHashes(0);

      const proposalTxHash = await azorius.getProposalTxHash(0, 0);

      expect([txHash]).to.deep.eq(proposalTxHashes);

      expect(txHash).to.deep.eq(proposalTxHash);

      expect(await azorius.getProposal(0)).to.deep.eq([
        linearERC20Voting.address,
        [txHash],
        BigNumber.from("60"),
        BigNumber.from("60"),
        BigNumber.from("0"),
      ]);

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      // Users haven't voted yet
      expect(await linearERC20Voting.hasVoted(0, tokenHolder2.address)).to.eq(
        false
      );
      expect(await linearERC20Voting.hasVoted(0, tokenHolder3.address)).to.eq(
        false
      );

      // Users vote in support of proposal
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 1);

      // Users have voted
      expect(await linearERC20Voting.hasVoted(0, tokenHolder2.address)).to.eq(
        true
      );
      expect(await linearERC20Voting.hasVoted(0, tokenHolder3.address)).to.eq(
        true
      );

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azorius.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is executable
      expect(await azorius.proposalState(0)).to.eq(2);

      expect(await votesERC20.balanceOf(gnosisSafe.address)).to.eq(600);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await expect(
        azorius.executeProposal(
          0,
          [votesERC20.address, votesERC20.address],
          [0, 0],
          [tokenTransferData, tokenTransferData],
          [0, 0]
        )
      ).to.be.revertedWith("InvalidTxs()");
    });

    it("A proposal cannot be executed with the wrong TXs passed to it", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const tokenTransferData2 = votesERC20.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 700]
      );

      const proposalTransaction = {
        to: votesERC20.address,
        value: BigNumber.from(0),
        data: tokenTransferData1,
        operation: 0,
      };

      await azorius.submitProposal(
        linearERC20Voting.address,
        "0x",
        [proposalTransaction],
        ""
      );

      // Users vote in support of proposal
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 1);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is executable
      expect(await azorius.proposalState(0)).to.eq(2);

      // Execute the transaction
      await expect(
        azorius.executeProposal(
          0,
          [votesERC20.address],
          [0],
          [tokenTransferData2],
          [0]
        )
      ).to.be.revertedWith("InvalidTxHash()");
    });
  });
});
