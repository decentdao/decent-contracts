import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, network } from "hardhat";
import {
  ifaceSafe,
  abi,
  abiSafe,
  calculateProxyAddress,
  abiFactory,
  predictGnosisSafeAddress,
  buildContractCall,
  MetaTransaction,
  multisendABI,
  encodeMultiSend,
  ifaceMultiSend,
  usuliface,
  getRandomBytes,
} from "./helpers";
import {
  FractalUsul,
  FractalUsul__factory,
  VotesToken__factory,
  OZLinearVoting__factory,
  OZLinearVoting,
} from "../typechain-types";
import VotesMasterCopyDeployment from "../deployments/goerli/VotesToken.json";

const { solidityKeccak256, getCreate2Address } = ethers.utils;

describe("Fractal Usul", () => {
  // Factories
  let gnosisFactory: Contract;

  // Deployed contracts
  let gnosisSafe: Contract;
  let moduleFactory: Contract;
  let multiSend: Contract;
  let votesMasterCopy: Contract;
  let fractalUsulMasterCopy: FractalUsul;
  let linearVotingMasterCopyContract: OZLinearVoting;

  // Wallets
  let deployer: SignerWithAddress;
  let owner1: SignerWithAddress;
  let owner2: SignerWithAddress;

  const abiCoder = new ethers.utils.AbiCoder(); // encode data
  let createGnosisSetupCalldata: string;
  let sigs: string;

  const gnosisFactoryAddress = "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2";
  const gnosisSingletonAddress = "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552";
  const votesMasterCopyAddress = VotesMasterCopyDeployment.address;
  const linearVotingMasterCopyAddress =
    "0x948db5691cc97AEcb4fF5FfcAEb72594B74D9D52";

  const saltNum = BigNumber.from(
    "0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c"
  );

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    setTimeout(function () {}, 500); // This timeout is to prevent API rate limit errors
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

    [deployer, owner1, owner2] = await ethers.getSigners();
    multiSend = new ethers.Contract(
      "0x40A2aCCbd92BCA938b02010E17A5b8929b49130D",
      multisendABI,
      deployer
    );
    gnosisFactory = new ethers.Contract(gnosisFactoryAddress, abi, deployer); // Gnosis Factory
    moduleFactory = new ethers.Contract(
      "0x00000000000DC7F163742Eb4aBEf650037b1f588",
      abiFactory,
      deployer
    );

    // eslint-disable-next-line camelcase
    votesMasterCopy = VotesToken__factory.connect(
      votesMasterCopyAddress,
      deployer
    );
    // eslint-disable-next-line camelcase
    linearVotingMasterCopyContract = OZLinearVoting__factory.connect(
      linearVotingMasterCopyAddress,
      deployer
    );
    // eslint-disable-next-line camelcase
    fractalUsulMasterCopy = await new FractalUsul__factory(deployer).deploy(
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000001",
      ["0x0000000000000000000000000000000000000002"]
    );

    /// ////////////////// GNOSIS //////////////////
    // SETUP GnosisSafe
    createGnosisSetupCalldata = ifaceSafe.encodeFunctionData("setup", [
      [multiSend.address],
      1,
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

    // Get Gnosis Safe contract
    gnosisSafe = new ethers.Contract(
      predictedGnosisSafeAddress,
      abiSafe,
      deployer
    );

    // TX Array
    sigs =
      "0x000000000000000000000000" +
      multiSend.address.slice(2) +
      "0000000000000000000000000000000000000000000000000000000000000000" +
      "01";
  });

  it("Submit Proposal with MetaData emits ProposalMetadataCreated event", async () => {
    const tokenGovernanceDaoData = {
      tokenName: "FractalUsulToken",
      tokenSymbol: "FRUT",
      votingPeriod: 10000,
      quorum: 20,
      executionDelay: 0,
    };
    const tokenAllocationsOwners = [
      owner1.address,
      owner2.address,
      gnosisSafe.address,
    ];
    const tokenAllocationsValues = [
      BigNumber.from(1000000),
      BigNumber.from(1000000),
      BigNumber.from(500000),
    ];
    const encodedInitTokenData = abiCoder.encode(
      ["string", "string", "address[]", "uint256[]"],
      [
        tokenGovernanceDaoData.tokenName,
        tokenGovernanceDaoData.tokenSymbol,
        tokenAllocationsOwners,
        tokenAllocationsValues,
      ]
    );

    const encodedSetUpTokenData = votesMasterCopy.interface.encodeFunctionData(
      "setUp",
      [encodedInitTokenData]
    );
    const tokenByteCodeLinear =
      "0x602d8060093d393df3363d3d373d3d3d363d73" +
      votesMasterCopy.address.slice(2) +
      "5af43d82803e903d91602b57fd5bf3";
    const tokenNonce = getRandomBytes();
    const tokenSalt = solidityKeccak256(
      ["bytes32", "uint256"],
      [solidityKeccak256(["bytes"], [encodedSetUpTokenData]), tokenNonce]
    );
    const predictedTokenAddress = getCreate2Address(
      moduleFactory.address,
      tokenSalt,
      solidityKeccak256(["bytes"], [tokenByteCodeLinear])
    );

    const encodedStrategyInitParams = abiCoder.encode(
      [
        "address",
        "address",
        "address",
        "uint256",
        "uint256",
        "uint256",
        "string",
      ],
      [
        gnosisSafe.address, // owner
        predictedTokenAddress,
        "0x0000000000000000000000000000000000000001",
        tokenGovernanceDaoData.votingPeriod,
        tokenGovernanceDaoData.quorum,
        tokenGovernanceDaoData.executionDelay,
        "linearVoting",
      ]
    );

    const encodedStrategySetUpData =
      linearVotingMasterCopyContract.interface.encodeFunctionData("setUp", [
        encodedStrategyInitParams,
      ]);
    const strategyByteCodeLinear =
      "0x602d8060093d393df3363d3d373d3d3d363d73" +
      linearVotingMasterCopyContract.address.slice(2) +
      "5af43d82803e903d91602b57fd5bf3";
    const strategyNonce = getRandomBytes();
    const strategySalt = solidityKeccak256(
      ["bytes32", "uint256"],
      [solidityKeccak256(["bytes"], [encodedStrategySetUpData]), strategyNonce]
    );
    const predictedStrategyAddress = getCreate2Address(
      moduleFactory.address,
      strategySalt,
      solidityKeccak256(["bytes"], [strategyByteCodeLinear])
    );
    const VOTING_STRATEGIES_TO_DEPLOY: string[] = [predictedStrategyAddress];
    const encodedInitUsulData = ethers.utils.defaultAbiCoder.encode(
      ["address", "address", "address", "address[]"],
      [
        gnosisSafe.address,
        gnosisSafe.address,
        gnosisSafe.address,
        VOTING_STRATEGIES_TO_DEPLOY,
      ]
    );
    const encodedSetupUsulData = usuliface.encodeFunctionData("setUp", [
      encodedInitUsulData,
    ]);
    const predictedUsulModule = await calculateProxyAddress(
      moduleFactory,
      fractalUsulMasterCopy.address,
      encodedSetupUsulData,
      "10031021"
    );

    // eslint-disable-next-line camelcase
    const usulContract = FractalUsul__factory.connect(
      predictedUsulModule,
      deployer
    );

    // eslint-disable-next-line camelcase
    const linearVotingContract = OZLinearVoting__factory.connect(
      predictedStrategyAddress,
      deployer
    );

    const internalTxs: MetaTransaction[] = [
      buildContractCall(
        linearVotingContract,
        "setUsul",
        [usulContract.address],
        0,
        false
      ),
      buildContractCall(
        gnosisSafe,
        "enableModule",
        [usulContract.address],
        0,
        false
      ),
    ];
    const safeInternalTx = encodeMultiSend(internalTxs);

    const createSafeTx = buildContractCall(
      gnosisFactory,
      "createProxyWithNonce",
      [gnosisSingletonAddress, createGnosisSetupCalldata, saltNum],
      0,
      false
    );
    const createTokenTx = buildContractCall(
      moduleFactory,
      "deployModule",
      [votesMasterCopy.address, encodedSetUpTokenData, tokenNonce],
      0,
      false
    );

    const deployStrategyTx = buildContractCall(
      moduleFactory,
      "deployModule",
      [
        linearVotingMasterCopyContract.address,
        encodedStrategySetUpData,
        strategyNonce,
      ],
      0,
      false
    );

    const deployUsulTx = buildContractCall(
      moduleFactory,
      "deployModule",
      [fractalUsulMasterCopy.address, encodedSetupUsulData, "10031021"],
      0,
      false
    );

    const execInternalTx = buildContractCall(
      gnosisSafe,
      "execTransaction",
      [
        multiSend.address, // to
        "0", // value
        // eslint-disable-next-line camelcase
        ifaceMultiSend.encodeFunctionData("multiSend", [safeInternalTx]), // calldata
        "1", // operation
        "0", // tx gas
        "0", // base gas
        "0", // gas price
        ethers.constants.AddressZero, // gas token
        ethers.constants.AddressZero, // receiver
        sigs, // sigs
      ],
      0,
      false
    );

    const txs: MetaTransaction[] = [
      createSafeTx,
      createTokenTx,
      deployStrategyTx,
      deployUsulTx,
      execInternalTx,
    ];
    const safeTx = encodeMultiSend(txs);
    await multiSend.multiSend(safeTx);

    const proposalTransaction = {
      to: gnosisSafe.address,
      value: BigNumber.from(0),
      data: gnosisSafe.interface.encodeFunctionData("nonce", []),
      operation: 0,
    };

    const proposalTitle = "This is my amazing proposal!";
    const proposalDescription = "And this is my super amazing description";
    const proposalDocumentationUrl = "https://example.com/amazing-proposal";

    const tx = await usulContract.submitProposal(
      predictedStrategyAddress,
      "0x",
      [proposalTransaction],
      proposalTitle,
      proposalDescription,
      proposalDocumentationUrl
    );
    const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
    const data = receipt.logs[2].data;
    const topics = receipt.logs[2].topics;
    const event = usulContract.interface.decodeEventLog(
      "ProposalMetadataCreated",
      data,
      topics
    );

    expect(event.proposalId).to.be.equal(BigNumber.from(0));

    // Have to test transactions this way, cause TypeScript yells on tuple signature
    expect(event.transactions[0].to).to.be.equal(proposalTransaction.to);
    expect(event.transactions[0].value).to.be.equal(proposalTransaction.value);
    expect(event.transactions[0].data).to.be.equal(proposalTransaction.data);
    expect(event.transactions[0].operation).to.be.equal(
      proposalTransaction.operation
    );

    expect(event.title).to.be.equal(proposalTitle);
    expect(event.description).to.be.equal(proposalDescription);
    expect(event.documentationUrl).to.be.equal(proposalDocumentationUrl);
  });
});
