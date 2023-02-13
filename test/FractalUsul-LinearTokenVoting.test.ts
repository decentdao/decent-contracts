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
  FractalUsul,
  FractalUsul__factory,
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

describe("Safe with FractalUsul module and LinearTokenVoting", () => {
  // Deployed contracts
  let gnosisSafe: GnosisSafe;
  let usulModule: FractalUsul;
  let linearTokenVoting: LinearTokenVoting;
  let votesToken: VotesToken;
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

    // Votes Token
    votesToken = await new VotesToken__factory(deployer).deploy();

    const votesTokenSetupData = abiCoder.encode(
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

    await votesToken.setUp(votesTokenSetupData);

    // Token holders delegate votes
    // Token holder 1 delegates to token holder 2, so final vote counts should be:
    // tokenHolder1 => 0
    // tokenHolder2 => 300
    // tokenHolder3 => 300
    await votesToken.connect(tokenHolder1).delegate(tokenHolder2.address);
    await votesToken.connect(tokenHolder2).delegate(tokenHolder2.address);
    await votesToken.connect(tokenHolder3).delegate(tokenHolder3.address);

    // Deploy Usul module
    usulModule = await new FractalUsul__factory(deployer).deploy(
      gnosisSafeOwner.address,
      gnosisSafe.address,
      gnosisSafe.address,
      []
    );

    // Deploy Linear Token Voting Strategy
    linearTokenVoting = await new LinearTokenVoting__factory(deployer).deploy(
      gnosisSafeOwner.address, // owner
      votesToken.address, // governance token
      usulModule.address, // usul module
      60, // voting period in seconds
      500000, // quorom numerator, denominator is 1,000,000, so quorum percentage is 50%
      60, // timelock period in seconds
      "Voting" // name
    );

    // Enable the Linear Voting strategy on Usul
    await usulModule
      .connect(gnosisSafeOwner)
      .enableStrategy(linearTokenVoting.address);

    // Create transaction on Gnosis Safe to setup Usul module
    const enableUsulModuleData = gnosisSafe.interface.encodeFunctionData(
      "enableModule",
      [usulModule.address]
    );

    const enableUsulModuleTx = buildSafeTransaction({
      to: gnosisSafe.address,
      data: enableUsulModuleData,
      safeTxGas: 1000000,
      nonce: (await gnosisSafe.nonce()).toNumber(),
    });

    const sigs = [
      await safeSignTypedData(gnosisSafeOwner, gnosisSafe, enableUsulModuleTx),
    ];

    const signatureBytes = buildSignatureBytes(sigs);

    // Execute transaction that adds the veto guard to the Safe
    await expect(
      gnosisSafe.execTransaction(
        enableUsulModuleTx.to,
        enableUsulModuleTx.value,
        enableUsulModuleTx.data,
        enableUsulModuleTx.operation,
        enableUsulModuleTx.safeTxGas,
        enableUsulModuleTx.baseGas,
        enableUsulModuleTx.gasPrice,
        enableUsulModuleTx.gasToken,
        enableUsulModuleTx.refundReceiver,
        signatureBytes
      )
    ).to.emit(gnosisSafe, "ExecutionSuccess");

    // Gnosis Safe received the 1,000 tokens
    expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(600);
  });

  describe("Safe with FractalUsul module and LinearTokenVoting", () => {
    it("Gets correctly initialized", async () => {
      expect(await linearTokenVoting.owner()).to.eq(gnosisSafeOwner.address);
      expect(await linearTokenVoting.governanceToken()).to.eq(
        votesToken.address
      );
      expect(await linearTokenVoting.usulModule()).to.eq(usulModule.address);
      expect(await linearTokenVoting.votingPeriod()).to.eq(60);
      expect(await linearTokenVoting.quorumNumerator()).to.eq(500000);
      expect(await linearTokenVoting.timelockPeriod()).to.eq(60);
      expect(await linearTokenVoting.name()).to.eq("Voting");
    });

    it("A strategy cannot be enabled more than once", async () => {
      await expect(
        usulModule
          .connect(gnosisSafeOwner)
          .enableStrategy(linearTokenVoting.address)
      ).to.be.revertedWith("Strategy already enabled");
    });

    it("Multiple strategies can be enabled, disabled, and returned", async () => {
      await usulModule
        .connect(gnosisSafeOwner)
        .enableStrategy(mockStrategy1.address);

      await usulModule
        .connect(gnosisSafeOwner)
        .enableStrategy(mockStrategy2.address);

      expect(
        (
          await usulModule.getStrategies(
            "0x0000000000000000000000000000000000000001",
            3
          )
        ).strategiesArray
      ).to.deep.eq([
        mockStrategy2.address,
        mockStrategy1.address,
        linearTokenVoting.address,
      ]);
    });

    it("The owner can change the Usul Module on the Strategy", async () => {
      await linearTokenVoting
        .connect(gnosisSafeOwner)
        .setUsul(deployer.address);

      expect(await linearTokenVoting.usulModule()).to.eq(deployer.address);
    });

    it("A non-owner cannot change the Usul Module on the Strategy", async () => {
      await expect(
        linearTokenVoting.connect(tokenHolder1).setUsul(deployer.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("The owner can update the voting period", async () => {
      expect(await linearTokenVoting.votingPeriod()).to.eq(60);
      await linearTokenVoting.connect(gnosisSafeOwner).updateVotingPeriod(120);

      expect(await linearTokenVoting.votingPeriod()).to.eq(120);
    });

    it("A non-owner cannot update the strategy voting period", async () => {
      await expect(
        linearTokenVoting.connect(tokenHolder1).updateVotingPeriod(120)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("The owner can update the timelock period", async () => {
      expect(await linearTokenVoting.timelockPeriod()).to.eq(60);
      await linearTokenVoting
        .connect(gnosisSafeOwner)
        .updateTimelockPeriod(120);

      expect(await linearTokenVoting.timelockPeriod()).to.eq(120);
    });

    it("A non-owner cannot update the strategy timelock period", async () => {
      await expect(
        linearTokenVoting.connect(tokenHolder1).updateTimelockPeriod(120)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("A proposal cannot be submitted if the specified strategy has not been enabled", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      // Use an incorrect address for the strategy
      await expect(
        usulModule.submitProposal(
          votesToken.address,
          "0x",
          [proposalTransaction],
          "",
          "",
          ""
        )
      ).to.be.revertedWith("Voting strategy is not enabled");
    });

    it("A proposal cannot be submitted if it contains zero transactions", async () => {
      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      // Submit transactions as empty array
      await expect(
        usulModule.submitProposal(
          linearTokenVoting.address,
          "0x",
          [],
          "",
          "",
          ""
        )
      ).to.be.revertedWith("Proposal must contain at least one transaction");
    });

    it("Proposal cannot be received by the strategy from address other than UsulModule", async () => {
      // Submit call from address that isn't Usul module
      await expect(linearTokenVoting.receiveProposal([])).to.be.revertedWith(
        "Only callable by Usul module"
      );
    });

    it("Votes cannot be cast on a proposal that hasn't been submitted yet", async () => {
      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      // User attempts to vote on proposal that has not yet been submitted
      await expect(
        linearTokenVoting.connect(tokenHolder2).vote(0, 1, [0])
      ).to.be.revertedWith("Proposal has not been submitted yet");
    });

    it("Votes cannot be cast after the voting period has ended", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        "",
        "",
        ""
      );

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Users vote in support of proposal
      await expect(
        linearTokenVoting.connect(tokenHolder2).vote(0, 1, [0])
      ).to.be.revertedWith("Voting period has passed");
    });

    it("A voter cannot vote more than once on a proposal", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        "",
        "",
        ""
      );

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      // Users vote in support of proposal
      await linearTokenVoting.connect(tokenHolder2).vote(0, 1, [0]);
      await expect(
        linearTokenVoting.connect(tokenHolder2).vote(0, 1, [0])
      ).to.be.revertedWith("Voter has already voted");
    });

    it("Correctly counts proposal Yes votes", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        "",
        "",
        ""
      );

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      expect((await linearTokenVoting.getProposal(0)).yesVotes).to.eq(0);

      // Token holder 1 votes but does not have any voting weight
      await linearTokenVoting.connect(tokenHolder1).vote(0, 1, [0]);

      expect((await linearTokenVoting.getProposal(0)).yesVotes).to.eq(0);

      // Token holder 2 votes with voting weight of 300
      await linearTokenVoting.connect(tokenHolder2).vote(0, 1, [0]);

      expect((await linearTokenVoting.getProposal(0)).yesVotes).to.eq(300);

      // Token holder 3 votes with voting weight of 300
      await linearTokenVoting.connect(tokenHolder3).vote(0, 1, [0]);

      expect((await linearTokenVoting.getProposal(0)).yesVotes).to.eq(600);
    });

    it("Correctly counts proposal No votes", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        "",
        "",
        ""
      );

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      expect((await linearTokenVoting.getProposal(0)).noVotes).to.eq(0);

      // Token holder 1 votes but does not have any voting weight
      await linearTokenVoting.connect(tokenHolder1).vote(0, 0, [0]);

      expect((await linearTokenVoting.getProposal(0)).noVotes).to.eq(0);

      // Token holder 2 votes with voting weight of 300
      await linearTokenVoting.connect(tokenHolder2).vote(0, 0, [0]);

      expect((await linearTokenVoting.getProposal(0)).noVotes).to.eq(300);

      // Token holder 3 votes with voting weight of 300
      await linearTokenVoting.connect(tokenHolder3).vote(0, 0, [0]);

      expect((await linearTokenVoting.getProposal(0)).noVotes).to.eq(600);
    });

    it("Correctly counts proposal Abstain votes", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        "",
        "",
        ""
      );

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      expect((await linearTokenVoting.getProposal(0)).abstainVotes).to.eq(0);

      // Token holder 1 votes but does not have any voting weight
      await linearTokenVoting.connect(tokenHolder1).vote(0, 2, [0]);

      expect((await linearTokenVoting.getProposal(0)).abstainVotes).to.eq(0);

      // Token holder 2 votes with voting weight of 300
      await linearTokenVoting.connect(tokenHolder2).vote(0, 2, [0]);

      expect((await linearTokenVoting.getProposal(0)).abstainVotes).to.eq(300);

      // Token holder 3 votes with voting weight of 300
      await linearTokenVoting.connect(tokenHolder3).vote(0, 2, [0]);

      expect((await linearTokenVoting.getProposal(0)).abstainVotes).to.eq(600);
    });

    it("A proposal is passed with enough Yes votes and quorum", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        "",
        "",
        ""
      );

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      await expect(linearTokenVoting.isPassed(0)).to.be.revertedWith(
        "Majority yesVotes not reached"
      );

      // Users vote in support of proposal
      await linearTokenVoting.connect(tokenHolder2).vote(0, 1, [0]);
      await linearTokenVoting.connect(tokenHolder3).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      expect(await linearTokenVoting.isPassed(0)).to.eq(true);
    });

    it("A proposal is not passed if there are more No votes than Yes votes", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        "",
        "",
        ""
      );

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      await expect(linearTokenVoting.isPassed(0)).to.be.revertedWith(
        "Majority yesVotes not reached"
      );

      // Users vote against
      await linearTokenVoting.connect(tokenHolder2).vote(0, 0, [0]);
      await linearTokenVoting.connect(tokenHolder3).vote(0, 0, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      await expect(linearTokenVoting.isPassed(0)).to.be.revertedWith(
        "Majority yesVotes not reached"
      );

      await expect(linearTokenVoting.timelockProposal(0)).to.be.revertedWith(
        "Majority yesVotes not reached"
      );

      await expect(
        usulModule.executeProposalBatch(
          0,
          [votesToken.address],
          [0],
          [tokenTransferData],
          [0]
        )
      ).to.be.revertedWith("Proposal must be in the executable state");
    });

    it("A proposal is not passed if quorum is not reached", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        "",
        "",
        ""
      );

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      await expect(linearTokenVoting.isPassed(0)).to.be.revertedWith(
        "Majority yesVotes not reached"
      );

      // User votes "Yes"
      await linearTokenVoting.connect(tokenHolder2).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      await expect(linearTokenVoting.isPassed(0)).to.be.revertedWith(
        "Quorum has not been reached for the proposal"
      );

      await expect(linearTokenVoting.timelockProposal(0)).to.be.revertedWith(
        "Quorum has not been reached for the proposal"
      );

      await expect(
        usulModule.executeProposalBatch(
          0,
          [votesToken.address],
          [0],
          [tokenTransferData],
          [0]
        )
      ).to.be.revertedWith("Proposal must be in the executable state");
    });

    it("A proposal is not passed if voting period is not over", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        "",
        "",
        ""
      );

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      await expect(linearTokenVoting.isPassed(0)).to.be.revertedWith(
        "Majority yesVotes not reached"
      );

      // Users vote "Yes"
      await linearTokenVoting.connect(tokenHolder2).vote(0, 1, [0]);
      await linearTokenVoting.connect(tokenHolder3).vote(0, 1, [0]);

      await expect(linearTokenVoting.isPassed(0)).to.be.revertedWith(
        "Voting period is not over"
      );

      await expect(linearTokenVoting.timelockProposal(0)).to.be.revertedWith(
        "Voting period is not over"
      );

      await expect(
        usulModule.executeProposalBatch(
          0,
          [votesToken.address],
          [0],
          [tokenTransferData],
          [0]
        )
      ).to.be.revertedWith("Proposal must be in the executable state");
    });

    it("Submitting a proposal emits the event with the associated proposal metadata", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      const proposalTitle = "This is my amazing proposal!";
      const proposalDescription = "And this is my super amazing description";
      const proposalDocumentationUrl = "https://example.com/amazing-proposal";

      const tx = await usulModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        proposalTitle,
        proposalDescription,
        proposalDocumentationUrl
      );
      const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
      const data = receipt.logs[1].data;
      const topics = receipt.logs[1].topics;
      const event = usulModule.interface.decodeEventLog(
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

      expect(event.title).to.be.equal(proposalTitle);
      expect(event.description).to.be.equal(proposalDescription);
      expect(event.documentationUrl).to.be.equal(proposalDocumentationUrl);
    });

    it("A proposal can be created and executed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 600]
      );

      const proposalTransaction = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        "",
        "",
        ""
      );

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      // Users vote in support of proposal
      await linearTokenVoting.connect(tokenHolder2).vote(0, 1, [0]);
      await linearTokenVoting.connect(tokenHolder3).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategy
      await linearTokenVoting.timelockProposal(0);

      // Proposal is timelocked
      expect(await usulModule.state(0)).to.eq(2);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await usulModule.state(0)).to.eq(4);

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(600);
      expect(await votesToken.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await usulModule.executeProposalBatch(
        0,
        [votesToken.address],
        [0],
        [tokenTransferData],
        [0]
      );

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(0);
      expect(await votesToken.balanceOf(deployer.address)).to.eq(600);
    });

    it("Multiple transactions can be executed from a single proposal", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 100]
      );

      const tokenTransferData2 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 200]
      );

      const tokenTransferData3 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 300]
      );

      const proposalTransaction1 = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData1,
        operation: 0,
      };

      const proposalTransaction2 = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData2,
        operation: 0,
      };

      const proposalTransaction3 = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData3,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction1, proposalTransaction2, proposalTransaction3],
        "",
        "",
        ""
      );

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      // Users vote in support of proposal
      await linearTokenVoting.connect(tokenHolder2).vote(0, 1, [0]);
      await linearTokenVoting.connect(tokenHolder3).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategy
      await linearTokenVoting.timelockProposal(0);

      // Proposal is timelocked
      expect(await usulModule.state(0)).to.eq(2);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await usulModule.state(0)).to.eq(4);

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(600);
      expect(await votesToken.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await usulModule.executeProposalBatch(
        0,
        [votesToken.address, votesToken.address, votesToken.address],
        [0, 0, 0],
        [tokenTransferData1, tokenTransferData2, tokenTransferData3],
        [0, 0, 0]
      );

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(0);
      expect(await votesToken.balanceOf(deployer.address)).to.eq(600);
    });

    it("Multiple transactions can be executed from a single proposal one at a time", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 100]
      );

      const tokenTransferData2 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 200]
      );

      const tokenTransferData3 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 300]
      );

      const proposalTransaction1 = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData1,
        operation: 0,
      };

      const proposalTransaction2 = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData2,
        operation: 0,
      };

      const proposalTransaction3 = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData3,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction1, proposalTransaction2, proposalTransaction3],
        "",
        "",
        ""
      );

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      // Users vote in support of proposal
      await linearTokenVoting.connect(tokenHolder2).vote(0, 1, [0]);
      await linearTokenVoting.connect(tokenHolder3).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategy
      await linearTokenVoting.timelockProposal(0);

      // Proposal is timelocked
      expect(await usulModule.state(0)).to.eq(2);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await usulModule.state(0)).to.eq(4);

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(600);
      expect(await votesToken.balanceOf(deployer.address)).to.eq(0);

      // Execute the first transaction
      await usulModule.executeProposalByIndex(
        0,
        votesToken.address,
        0,
        tokenTransferData1,
        0
      );

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(500);
      expect(await votesToken.balanceOf(deployer.address)).to.eq(100);

      // Execute the second transaction
      await usulModule.executeProposalByIndex(
        0,
        votesToken.address,
        0,
        tokenTransferData2,
        0
      );

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(300);
      expect(await votesToken.balanceOf(deployer.address)).to.eq(300);

      // Execute the third transaction
      await usulModule.executeProposalByIndex(
        0,
        votesToken.address,
        0,
        tokenTransferData3,
        0
      );

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(0);
      expect(await votesToken.balanceOf(deployer.address)).to.eq(600);
    });

    it("Transactions in a proposal cannot be executed out of order", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 100]
      );

      const tokenTransferData2 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 200]
      );

      const tokenTransferData3 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 300]
      );

      const tokenTransferData4 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 400]
      );

      const proposalTransaction1 = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData1,
        operation: 0,
      };

      const proposalTransaction2 = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData2,
        operation: 0,
      };

      const proposalTransaction3 = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData3,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      // Submit proposal, transaction 4 is not included
      await usulModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction1, proposalTransaction2, proposalTransaction3],
        "",
        "",
        ""
      );

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      // Users vote in support of proposal
      await linearTokenVoting.connect(tokenHolder2).vote(0, 1, [0]);
      await linearTokenVoting.connect(tokenHolder3).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategy
      await linearTokenVoting.timelockProposal(0);

      // Proposal is timelocked
      expect(await usulModule.state(0)).to.eq(2);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await usulModule.state(0)).to.eq(4);

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(600);
      expect(await votesToken.balanceOf(deployer.address)).to.eq(0);

      // Attempt to execute the second transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          votesToken.address,
          0,
          tokenTransferData2,
          0
        )
      ).to.be.revertedWith("Transaction hash does not match the indexed hash");

      // Attempt to execute the third transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          votesToken.address,
          0,
          tokenTransferData3,
          0
        )
      ).to.be.revertedWith("Transaction hash does not match the indexed hash");

      // Attempt to execute the fourth transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          votesToken.address,
          0,
          tokenTransferData4,
          0
        )
      ).to.be.revertedWith("Transaction hash does not match the indexed hash");

      expect(await usulModule.isTxExecuted(0, 0)).to.eq(false);
      expect(await usulModule.isTxExecuted(0, 1)).to.eq(false);
      expect(await usulModule.isTxExecuted(0, 2)).to.eq(false);

      // Execute the first transaction
      await usulModule.executeProposalByIndex(
        0,
        votesToken.address,
        0,
        tokenTransferData1,
        0
      );

      expect(await usulModule.isTxExecuted(0, 0)).to.eq(true);
      expect(await usulModule.isTxExecuted(0, 1)).to.eq(false);
      expect(await usulModule.isTxExecuted(0, 2)).to.eq(false);

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(500);
      expect(await votesToken.balanceOf(deployer.address)).to.eq(100);

      // Attempt to execute the first transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          votesToken.address,
          0,
          tokenTransferData1,
          0
        )
      ).to.be.revertedWith("Transaction hash does not match the indexed hash");

      // Attempt to execute the third transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          votesToken.address,
          0,
          tokenTransferData3,
          0
        )
      ).to.be.revertedWith("Transaction hash does not match the indexed hash");

      // Attempt to execute the fourth transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          votesToken.address,
          0,
          tokenTransferData4,
          0
        )
      ).to.be.revertedWith("Transaction hash does not match the indexed hash");

      // Execute the second transaction
      await usulModule.executeProposalByIndex(
        0,
        votesToken.address,
        0,
        tokenTransferData2,
        0
      );

      expect(await usulModule.isTxExecuted(0, 0)).to.eq(true);
      expect(await usulModule.isTxExecuted(0, 1)).to.eq(true);
      expect(await usulModule.isTxExecuted(0, 2)).to.eq(false);

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(300);
      expect(await votesToken.balanceOf(deployer.address)).to.eq(300);

      // Attempt to execute the first transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          votesToken.address,
          0,
          tokenTransferData1,
          0
        )
      ).to.be.revertedWith("Transaction hash does not match the indexed hash");

      // Attempt to execute the second transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          votesToken.address,
          0,
          tokenTransferData2,
          0
        )
      ).to.be.revertedWith("Transaction hash does not match the indexed hash");

      // Attempt to execute the fourth transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          votesToken.address,
          0,
          tokenTransferData4,
          0
        )
      ).to.be.revertedWith("Transaction hash does not match the indexed hash");

      // Execute the third transaction
      await usulModule.executeProposalByIndex(
        0,
        votesToken.address,
        0,
        tokenTransferData3,
        0
      );

      expect(await usulModule.isTxExecuted(0, 0)).to.eq(true);
      expect(await usulModule.isTxExecuted(0, 1)).to.eq(true);
      expect(await usulModule.isTxExecuted(0, 2)).to.eq(true);

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(0);
      expect(await votesToken.balanceOf(deployer.address)).to.eq(600);

      // Attempt to execute the first transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          votesToken.address,
          0,
          tokenTransferData1,
          0
        )
      ).to.be.revertedWith("Proposal must be in the executable state");

      // Attempt to execute the second transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          votesToken.address,
          0,
          tokenTransferData2,
          0
        )
      ).to.be.revertedWith("Proposal must be in the executable state");

      // Attempt to execute the third transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          votesToken.address,
          0,
          tokenTransferData3,
          0
        )
      ).to.be.revertedWith("Proposal must be in the executable state");

      // Attempt to execute the fourth transaction
      await expect(
        usulModule.executeProposalByIndex(
          0,
          votesToken.address,
          0,
          tokenTransferData4,
          0
        )
      ).to.be.revertedWith("Proposal must be in the executable state");
    });

    it("Executing a proposal reverts if the transaction cannot be executed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 700]
      );

      const proposalTransaction = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction],
        "",
        "",
        ""
      );

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      // Users vote in support of proposal
      await linearTokenVoting.connect(tokenHolder2).vote(0, 1, [0]);
      await linearTokenVoting.connect(tokenHolder3).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategy
      await linearTokenVoting.timelockProposal(0);

      // Proposal is timelocked
      expect(await usulModule.state(0)).to.eq(2);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await usulModule.state(0)).to.eq(4);

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(600);
      expect(await votesToken.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await expect(
        usulModule.executeProposalBatch(
          0,
          [votesToken.address],
          [0],
          [tokenTransferData],
          [0]
        )
      ).to.be.revertedWith("Module transaction failed");

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(600);
      expect(await votesToken.balanceOf(deployer.address)).to.eq(0);
    });

    it("A proposal that has been cancelled cannot be executed", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 100]
      );

      const proposalTransaction1 = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData1,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction1],
        "",
        "",
        ""
      );

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      // Users vote in support of proposal
      await linearTokenVoting.connect(tokenHolder2).vote(0, 1, [0]);
      await linearTokenVoting.connect(tokenHolder3).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Finalize the strategy
      await linearTokenVoting.timelockProposal(0);

      // Proposal is timelocked
      expect(await usulModule.state(0)).to.eq(2);

      // Increase time so that timelock period has ended
      await time.increase(time.duration.seconds(60));

      // Proposal is ready to execute
      expect(await usulModule.state(0)).to.eq(4);

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(600);
      expect(await votesToken.balanceOf(deployer.address)).to.eq(0);

      // Cancel the proposal
      await usulModule.connect(gnosisSafeOwner).cancelProposals([0]);

      // Attempt to execute the transaction
      await expect(
        usulModule.executeProposalBatch(
          0,
          [votesToken.address],
          [0],
          [tokenTransferData1],
          [0]
        )
      ).to.be.revertedWith("Proposal must be in the executable state");

      expect(await votesToken.balanceOf(gnosisSafe.address)).to.eq(600);
      expect(await votesToken.balanceOf(deployer.address)).to.eq(0);
    });

    it("A proposal cannot be timelocked if it has been cancelled", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = votesToken.interface.encodeFunctionData(
        "transfer",
        [deployer.address, 100]
      );

      const proposalTransaction1 = {
        to: votesToken.address,
        value: BigNumber.from(0),
        data: tokenTransferData1,
        operation: 0,
      };

      // Proposal is uninitialized
      expect(await usulModule.state(0)).to.eq(5);

      await usulModule.submitProposal(
        linearTokenVoting.address,
        "0x",
        [proposalTransaction1],
        "",
        "",
        ""
      );

      // Proposal is active
      expect(await usulModule.state(0)).to.eq(0);

      // Users vote in support of proposal
      await linearTokenVoting.connect(tokenHolder2).vote(0, 1, [0]);
      await linearTokenVoting.connect(tokenHolder3).vote(0, 1, [0]);

      // Increase time so that voting period has ended
      await time.increase(time.duration.seconds(60));

      // Cancel the proposal
      await usulModule.connect(gnosisSafeOwner).cancelProposals([0]);

      // Attempt to finalize the strategy
      await expect(linearTokenVoting.timelockProposal(0)).to.be.revertedWith(
        "Proposal must be in the active state"
      );
    });
  });
});
