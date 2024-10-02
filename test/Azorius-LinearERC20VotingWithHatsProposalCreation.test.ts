import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import hre from "hardhat";
import { ethers } from "ethers";

import {
  GnosisSafe,
  GnosisSafeProxyFactory,
  LinearERC20VotingWithHatsProposalCreation,
  LinearERC20VotingWithHatsProposalCreation__factory,
  Azorius,
  Azorius__factory,
  VotesERC20,
  VotesERC20__factory,
  ModuleProxyFactory,
  GnosisSafeL2__factory,
  MockHats,
  MockHats__factory,
} from "../typechain-types";

import {
  calculateProxyAddress,
  predictGnosisSafeAddress,
  buildSafeTransaction,
  safeSignTypedData,
  buildSignatureBytes,
} from "./helpers";

import {
  getGnosisSafeL2Singleton,
  getGnosisSafeProxyFactory,
  getModuleProxyFactory,
} from "./GlobalSafeDeployments.test";

describe("LinearERC20VotingWithHatsProposalCreation", () => {
  // Deployed contracts
  let gnosisSafe: GnosisSafe;
  let azorius: Azorius;
  let azoriusMastercopy: Azorius;
  let linearERC20VotingWithHats: LinearERC20VotingWithHatsProposalCreation;
  let linearERC20VotingWithHatsMastercopy: LinearERC20VotingWithHatsProposalCreation;
  let votesERC20Mastercopy: VotesERC20;
  let votesERC20: VotesERC20;
  let gnosisSafeProxyFactory: GnosisSafeProxyFactory;
  let moduleProxyFactory: ModuleProxyFactory;
  let hatsContract: MockHats;

  // Wallets
  let deployer: SignerWithAddress;
  let gnosisSafeOwner: SignerWithAddress;
  let hatWearer1: SignerWithAddress;
  let hatWearer2: SignerWithAddress;

  // Hats
  let proposerHat: bigint;
  let nonProposerHat: bigint;

  // Gnosis
  let createGnosisSetupCalldata: string;

  const saltNum = BigInt(
    "0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c"
  );

  beforeEach(async () => {
    gnosisSafeProxyFactory = getGnosisSafeProxyFactory();
    moduleProxyFactory = getModuleProxyFactory();
    const gnosisSafeL2Singleton = getGnosisSafeL2Singleton();

    const abiCoder = new ethers.AbiCoder();

    [deployer, gnosisSafeOwner, hatWearer1, hatWearer2] =
      await hre.ethers.getSigners();

    createGnosisSetupCalldata =
      // eslint-disable-next-line camelcase
      GnosisSafeL2__factory.createInterface().encodeFunctionData("setup", [
        [gnosisSafeOwner.address],
        1,
        ethers.ZeroAddress,
        ethers.ZeroHash,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        0,
        ethers.ZeroAddress,
      ]);

    const predictedGnosisSafeAddress = await predictGnosisSafeAddress(
      createGnosisSetupCalldata,
      saltNum,
      await gnosisSafeL2Singleton.getAddress(),
      gnosisSafeProxyFactory
    );

    // Deploy Gnosis Safe
    await gnosisSafeProxyFactory.createProxyWithNonce(
      await gnosisSafeL2Singleton.getAddress(),
      createGnosisSetupCalldata,
      saltNum
    );

    gnosisSafe = await hre.ethers.getContractAt(
      "GnosisSafe",
      predictedGnosisSafeAddress
    );

    // Deploy Votes ERC-20 mastercopy contract
    votesERC20Mastercopy = await new VotesERC20__factory(deployer).deploy();

    const votesERC20SetupCalldata =
      // eslint-disable-next-line camelcase
      VotesERC20__factory.createInterface().encodeFunctionData("setUp", [
        abiCoder.encode(
          ["string", "string", "address[]", "uint256[]"],
          ["DCNT", "DCNT", [], []]
        ),
      ]);

    await moduleProxyFactory.deployModule(
      await votesERC20Mastercopy.getAddress(),
      votesERC20SetupCalldata,
      "10031021"
    );

    const predictedVotesERC20Address = await calculateProxyAddress(
      moduleProxyFactory,
      await votesERC20Mastercopy.getAddress(),
      votesERC20SetupCalldata,
      "10031021"
    );

    votesERC20 = await hre.ethers.getContractAt(
      "VotesERC20",
      predictedVotesERC20Address
    );
    // Deploy Azorius module
    azoriusMastercopy = await new Azorius__factory(deployer).deploy();

    const azoriusSetupCalldata =
      // eslint-disable-next-line camelcase
      Azorius__factory.createInterface().encodeFunctionData("setUp", [
        abiCoder.encode(
          ["address", "address", "address", "address[]", "uint32", "uint32"],
          [
            gnosisSafeOwner.address,
            await gnosisSafe.getAddress(),
            await gnosisSafe.getAddress(),
            [],
            60, // timelock period in blocks
            60, // execution period in blocks
          ]
        ),
      ]);

    await moduleProxyFactory.deployModule(
      await azoriusMastercopy.getAddress(),
      azoriusSetupCalldata,
      "10031021"
    );

    const predictedAzoriusAddress = await calculateProxyAddress(
      moduleProxyFactory,
      await azoriusMastercopy.getAddress(),
      azoriusSetupCalldata,
      "10031021"
    );

    azorius = await hre.ethers.getContractAt(
      "Azorius",
      predictedAzoriusAddress
    );

    // Deploy Hats mock contract
    hatsContract = await new MockHats__factory(deployer).deploy();

    // Create hats for testing
    proposerHat = await hatsContract.createHat.staticCall(
      0,
      "Proposer Hat",
      0,
      ethers.ZeroAddress,
      deployer.address,
      true,
      ""
    );
    await hatsContract.createHat(
      0,
      "Proposer Hat",
      0,
      ethers.ZeroAddress,
      deployer.address,
      true,
      ""
    );
    nonProposerHat = await hatsContract.createHat.staticCall(
      0,
      "Non-Proposer Hat",
      0,
      ethers.ZeroAddress,
      deployer.address,
      true,
      ""
    );
    await hatsContract.createHat(
      0,
      "Non-Proposer Hat",
      0,
      ethers.ZeroAddress,
      deployer.address,
      true,
      ""
    );

    // Mint hats to users
    await hatsContract.mintHat(proposerHat, hatWearer1.address);
    await hatsContract.mintHat(nonProposerHat, hatWearer2.address);

    // Deploy LinearERC20VotingWithHatsProposalCreation
    linearERC20VotingWithHatsMastercopy =
      await new LinearERC20VotingWithHatsProposalCreation__factory(
        deployer
      ).deploy();

    const linearERC20VotingWithHatsSetupCalldata =
      LinearERC20VotingWithHatsProposalCreation__factory.createInterface().encodeFunctionData(
        "setUp",
        [
          abiCoder.encode(
            [
              "address",
              "address",
              "address",
              "uint32",
              "uint256",
              "uint256",
              "address",
              "uint256[]",
            ],
            [
              gnosisSafeOwner.address,
              await votesERC20.getAddress(),
              await azorius.getAddress(),
              60,
              500000,
              500000,
              await hatsContract.getAddress(),
              [proposerHat],
            ]
          ),
        ]
      );

    await moduleProxyFactory.deployModule(
      await linearERC20VotingWithHatsMastercopy.getAddress(),
      linearERC20VotingWithHatsSetupCalldata,
      "10031021"
    );

    const predictedLinearERC20VotingWithHatsAddress =
      await calculateProxyAddress(
        moduleProxyFactory,
        await linearERC20VotingWithHatsMastercopy.getAddress(),
        linearERC20VotingWithHatsSetupCalldata,
        "10031021"
      );

    linearERC20VotingWithHats = await hre.ethers.getContractAt(
      "LinearERC20VotingWithHatsProposalCreation",
      predictedLinearERC20VotingWithHatsAddress
    );

    // Enable the strategy on Azorius
    await azorius
      .connect(gnosisSafeOwner)
      .enableStrategy(await linearERC20VotingWithHats.getAddress());

    // Create transaction on Gnosis Safe to setup Azorius module
    const enableAzoriusModuleData = gnosisSafe.interface.encodeFunctionData(
      "enableModule",
      [await azorius.getAddress()]
    );

    const enableAzoriusModuleTx = buildSafeTransaction({
      to: await gnosisSafe.getAddress(),
      data: enableAzoriusModuleData,
      safeTxGas: 1000000,
      nonce: await gnosisSafe.nonce(),
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
  });

  it("Gets correctly initialized", async () => {
    expect(await linearERC20VotingWithHats.owner()).to.eq(
      gnosisSafeOwner.address
    );
    expect(await linearERC20VotingWithHats.governanceToken()).to.eq(
      await votesERC20.getAddress()
    );
    expect(await linearERC20VotingWithHats.azoriusModule()).to.eq(
      await azorius.getAddress()
    );
    expect(await linearERC20VotingWithHats.hatsContract()).to.eq(
      await hatsContract.getAddress()
    );
    expect(await linearERC20VotingWithHats.isHatWhitelisted(proposerHat)).to.be
      .true;
  });

  it("Cannot call setUp function again", async () => {
    const setupParams = ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "address",
        "address",
        "address",
        "uint32",
        "uint256",
        "uint256",
        "address",
        "uint256[]",
      ],
      [
        gnosisSafeOwner.address,
        await votesERC20.getAddress(),
        await azorius.getAddress(),
        60, // voting period
        500000, // quorum numerator
        500000, // basis numerator
        await hatsContract.getAddress(),
        [proposerHat],
      ]
    );

    await expect(
      linearERC20VotingWithHats.setUp(setupParams)
    ).to.be.revertedWith("Initializable: contract is already initialized");
  });

  it("Only owner can whitelist a hat", async () => {
    await expect(
      linearERC20VotingWithHats
        .connect(gnosisSafeOwner)
        .whitelistHat(nonProposerHat)
    )
      .to.emit(linearERC20VotingWithHats, "HatWhitelisted")
      .withArgs(nonProposerHat);

    await expect(
      linearERC20VotingWithHats.connect(hatWearer1).whitelistHat(nonProposerHat)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Only owner can remove a hat from whitelist", async () => {
    await expect(
      linearERC20VotingWithHats
        .connect(gnosisSafeOwner)
        .removeHatFromWhitelist(proposerHat)
    )
      .to.emit(linearERC20VotingWithHats, "HatRemovedFromWhitelist")
      .withArgs(proposerHat);

    await expect(
      linearERC20VotingWithHats
        .connect(hatWearer1)
        .removeHatFromWhitelist(proposerHat)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Correctly identifies proposers based on whitelisted hats", async () => {
    expect(await linearERC20VotingWithHats.isProposer(hatWearer1.address)).to.be
      .true;
    expect(await linearERC20VotingWithHats.isProposer(hatWearer2.address)).to.be
      .false;

    await linearERC20VotingWithHats
      .connect(gnosisSafeOwner)
      .whitelistHat(nonProposerHat);

    expect(await linearERC20VotingWithHats.isProposer(hatWearer2.address)).to.be
      .true;
  });

  it("Only users with whitelisted hats can submit proposals", async () => {
    const tokenTransferData = votesERC20.interface.encodeFunctionData(
      "transfer",
      [deployer.address, 100]
    );

    const proposalTransaction = {
      to: await votesERC20.getAddress(),
      value: 0n,
      data: tokenTransferData,
      operation: 0,
    };

    await expect(
      azorius
        .connect(hatWearer1)
        .submitProposal(
          await linearERC20VotingWithHats.getAddress(),
          "0x",
          [proposalTransaction],
          ""
        )
    ).to.not.be.reverted;

    await expect(
      azorius
        .connect(hatWearer2)
        .submitProposal(
          await linearERC20VotingWithHats.getAddress(),
          "0x",
          [proposalTransaction],
          ""
        )
    ).to.be.revertedWithCustomError(azorius, "InvalidProposer");
  });

  it("Returns correct number of whitelisted hats", async () => {
    expect(await linearERC20VotingWithHats.getWhitelistedHatsCount()).to.equal(
      1
    );

    await linearERC20VotingWithHats
      .connect(gnosisSafeOwner)
      .whitelistHat(nonProposerHat);

    expect(await linearERC20VotingWithHats.getWhitelistedHatsCount()).to.equal(
      2
    );

    await linearERC20VotingWithHats
      .connect(gnosisSafeOwner)
      .removeHatFromWhitelist(proposerHat);

    expect(await linearERC20VotingWithHats.getWhitelistedHatsCount()).to.equal(
      1
    );
  });

  it("Correctly checks if a hat is whitelisted", async () => {
    expect(await linearERC20VotingWithHats.isHatWhitelisted(proposerHat)).to.be
      .true;
    expect(await linearERC20VotingWithHats.isHatWhitelisted(nonProposerHat)).to
      .be.false;

    await linearERC20VotingWithHats
      .connect(gnosisSafeOwner)
      .whitelistHat(nonProposerHat);

    expect(await linearERC20VotingWithHats.isHatWhitelisted(nonProposerHat)).to
      .be.true;

    await linearERC20VotingWithHats
      .connect(gnosisSafeOwner)
      .removeHatFromWhitelist(proposerHat);

    expect(await linearERC20VotingWithHats.isHatWhitelisted(proposerHat)).to.be
      .false;
  });
});
