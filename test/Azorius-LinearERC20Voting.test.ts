import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import hre, { ethers } from 'hardhat';

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
  ModuleProxyFactory,
  GnosisSafeL2__factory,
} from '../typechain-types';

import {
  getGnosisSafeL2Singleton,
  getGnosisSafeProxyFactory,
  getModuleProxyFactory,
} from './GlobalSafeDeployments.test';
import {
  buildSignatureBytes,
  buildSafeTransaction,
  safeSignTypedData,
  predictGnosisSafeAddress,
  calculateProxyAddress,
} from './helpers';
import time from './time';

describe('Safe with Azorius module and linearERC20Voting', () => {
  // Deployed contracts
  let gnosisSafe: GnosisSafe;
  let azorius: Azorius;
  let azoriusMastercopy: Azorius;
  let linearERC20Voting: LinearERC20Voting;
  let linearERC20VotingMastercopy: LinearERC20Voting;
  let mockVotingStrategy: MockVotingStrategy;
  let votesERC20Mastercopy: VotesERC20;
  let votesERC20: VotesERC20;
  let gnosisSafeProxyFactory: GnosisSafeProxyFactory;
  let moduleProxyFactory: ModuleProxyFactory;

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

  const saltNum = BigInt('0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c');

  beforeEach(async () => {
    gnosisSafeProxyFactory = getGnosisSafeProxyFactory();
    moduleProxyFactory = getModuleProxyFactory();
    const gnosisSafeL2Singleton = getGnosisSafeL2Singleton();

    const abiCoder = new ethers.AbiCoder();

    // Get the signer accounts
    [
      deployer,
      gnosisSafeOwner,
      tokenHolder1,
      tokenHolder2,
      tokenHolder3,
      mockStrategy1,
      mockStrategy2,
    ] = await hre.ethers.getSigners();

    // Get Gnosis Safe Proxy factory
    gnosisSafeProxyFactory = await hre.ethers.getContractAt(
      'GnosisSafeProxyFactory',
      await gnosisSafeProxyFactory.getAddress(),
    );

    // Get module proxy factory
    moduleProxyFactory = await hre.ethers.getContractAt(
      'ModuleProxyFactory',
      await moduleProxyFactory.getAddress(),
    );

    createGnosisSetupCalldata =
      // eslint-disable-next-line camelcase
      GnosisSafeL2__factory.createInterface().encodeFunctionData('setup', [
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
      gnosisSafeProxyFactory,
    );

    // Deploy Gnosis Safe
    await gnosisSafeProxyFactory.createProxyWithNonce(
      await gnosisSafeL2Singleton.getAddress(),
      createGnosisSetupCalldata,
      saltNum,
    );

    gnosisSafe = await hre.ethers.getContractAt('GnosisSafe', predictedGnosisSafeAddress);

    // Deploy Votes ERC-20 mastercopy contract
    votesERC20Mastercopy = await new VotesERC20__factory(deployer).deploy();

    const votesERC20SetupCalldata =
      // eslint-disable-next-line camelcase
      VotesERC20__factory.createInterface().encodeFunctionData('setUp', [
        abiCoder.encode(
          ['string', 'string', 'address[]', 'uint256[]'],
          [
            'DCNT',
            'DCNT',
            [
              tokenHolder1.address,
              tokenHolder2.address,
              tokenHolder3.address,
              await gnosisSafe.getAddress(),
            ],
            [100, 200, 300, 600],
          ],
        ),
      ]);

    await moduleProxyFactory.deployModule(
      await votesERC20Mastercopy.getAddress(),
      votesERC20SetupCalldata,
      '10031021',
    );

    const predictedVotesERC20Address = await calculateProxyAddress(
      moduleProxyFactory,
      await votesERC20Mastercopy.getAddress(),
      votesERC20SetupCalldata,
      '10031021',
    );

    votesERC20 = await hre.ethers.getContractAt('VotesERC20', predictedVotesERC20Address);

    // Token holders delegate votes
    // Token holder 1 delegates to token holder 2, so final vote counts should be:
    // tokenHolder1 => 0
    // tokenHolder2 => 300
    // tokenHolder3 => 300
    await votesERC20.connect(tokenHolder1).delegate(tokenHolder2.address);
    await votesERC20.connect(tokenHolder2).delegate(tokenHolder2.address);
    await votesERC20.connect(tokenHolder3).delegate(tokenHolder3.address);

    // Deploy Azorius module
    azoriusMastercopy = await new Azorius__factory(deployer).deploy();

    const azoriusSetupCalldata =
      // eslint-disable-next-line camelcase
      Azorius__factory.createInterface().encodeFunctionData('setUp', [
        abiCoder.encode(
          ['address', 'address', 'address', 'address[]', 'uint32', 'uint32'],
          [
            gnosisSafeOwner.address,
            await gnosisSafe.getAddress(),
            await gnosisSafe.getAddress(),
            [],
            60, // timelock period in blocks
            60, // execution period in blocks
          ],
        ),
      ]);

    await moduleProxyFactory.deployModule(
      await azoriusMastercopy.getAddress(),
      azoriusSetupCalldata,
      '10031021',
    );

    const predictedAzoriusAddress = await calculateProxyAddress(
      moduleProxyFactory,
      await azoriusMastercopy.getAddress(),
      azoriusSetupCalldata,
      '10031021',
    );

    azorius = await hre.ethers.getContractAt('Azorius', predictedAzoriusAddress);

    // Deploy Linear ERC20 Voting Mastercopy
    linearERC20VotingMastercopy = await new LinearERC20Voting__factory(deployer).deploy();

    const linearERC20VotingSetupCalldata =
      // eslint-disable-next-line camelcase
      LinearERC20Voting__factory.createInterface().encodeFunctionData('setUp', [
        abiCoder.encode(
          ['address', 'address', 'address', 'uint32', 'uint256', 'uint256', 'uint256'],
          [
            gnosisSafeOwner.address, // owner
            await votesERC20.getAddress(), // governance token
            await azorius.getAddress(), // Azorius module
            60, // voting period in blocks
            300, // proposer weight
            500000, // quorom numerator, denominator is 1,000,000, so quorum percentage is 50%
            500000, // basis numerator, denominator is 1,000,000, so basis percentage is 50% (simple majority)
          ],
        ),
      ]);

    await moduleProxyFactory.deployModule(
      await linearERC20VotingMastercopy.getAddress(),
      linearERC20VotingSetupCalldata,
      '10031021',
    );

    const predictedLinearERC20VotingAddress = await calculateProxyAddress(
      moduleProxyFactory,
      await linearERC20VotingMastercopy.getAddress(),
      linearERC20VotingSetupCalldata,
      '10031021',
    );

    linearERC20Voting = await hre.ethers.getContractAt(
      'LinearERC20Voting',
      predictedLinearERC20VotingAddress,
    );

    // Enable the Linear Voting strategy on Azorius
    await azorius.connect(gnosisSafeOwner).enableStrategy(await linearERC20Voting.getAddress());

    // Create transaction on Gnosis Safe to setup Azorius module
    const enableAzoriusModuleData = gnosisSafe.interface.encodeFunctionData('enableModule', [
      await azorius.getAddress(),
    ]);

    const enableAzoriusModuleTx = buildSafeTransaction({
      to: await gnosisSafe.getAddress(),
      data: enableAzoriusModuleData,
      safeTxGas: 1000000,
      nonce: await gnosisSafe.nonce(),
    });

    const sigs = [await safeSignTypedData(gnosisSafeOwner, gnosisSafe, enableAzoriusModuleTx)];

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
        signatureBytes,
      ),
    ).to.emit(gnosisSafe, 'ExecutionSuccess');

    // Gnosis Safe received the 1,000 tokens
    expect(await votesERC20.balanceOf(await gnosisSafe.getAddress())).to.eq(600);
  });

  describe('Safe with Azorius module and linearERC20Voting', () => {
    it('Gets correctly initialized', async () => {
      expect(await linearERC20Voting.owner()).to.eq(gnosisSafeOwner.address);
      expect(await linearERC20Voting.governanceToken()).to.eq(await votesERC20.getAddress());
      expect(await linearERC20Voting.azoriusModule()).to.eq(await azorius.getAddress());
      expect(await linearERC20Voting.votingPeriod()).to.eq(60);
      expect(await linearERC20Voting.quorumNumerator()).to.eq(500000);
    });

    it('A strategy cannot be enabled more than once', async () => {
      await expect(
        azorius.connect(gnosisSafeOwner).enableStrategy(await linearERC20Voting.getAddress()),
      ).to.be.revertedWithCustomError(azorius, 'StrategyEnabled()');
    });

    it('An invalid strategy cannot be enabled', async () => {
      await expect(
        azorius.connect(gnosisSafeOwner).enableStrategy(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(azorius, 'InvalidStrategy');
    });

    it('An invalid strategy cannot be disabled', async () => {
      await expect(
        azorius.connect(gnosisSafeOwner).disableStrategy(ethers.ZeroAddress, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(azorius, 'InvalidStrategy');
    });

    it('Multiple strategies can be enabled, disabled, and returned', async () => {
      await azorius.connect(gnosisSafeOwner).enableStrategy(mockStrategy1.address);

      await azorius.connect(gnosisSafeOwner).enableStrategy(mockStrategy2.address);

      expect(
        (await azorius.getStrategies('0x0000000000000000000000000000000000000001', 3))._strategies,
      ).to.deep.eq([
        mockStrategy2.address,
        mockStrategy1.address,
        await linearERC20Voting.getAddress(),
      ]);

      await azorius
        .connect(gnosisSafeOwner)
        .disableStrategy(mockStrategy2.address, mockStrategy1.address);

      expect(
        (await azorius.getStrategies('0x0000000000000000000000000000000000000001', 3))._strategies,
      ).to.deep.eq([mockStrategy2.address, await linearERC20Voting.getAddress()]);
    });

    it('An invalid strategy cannot be disabled', async () => {
      await expect(
        azorius.connect(gnosisSafeOwner).disableStrategy(ethers.ZeroAddress, mockStrategy2.address),
      ).to.be.revertedWithCustomError(azorius, 'StrategyDisabled');
    });

    it('The owner can change the Azorius Module on the Strategy', async () => {
      await linearERC20Voting.connect(gnosisSafeOwner).setAzorius(deployer.address);

      expect(await linearERC20Voting.azoriusModule()).to.eq(deployer.address);
    });

    it('A non-owner cannot change the Azorius Module on the Strategy', async () => {
      await expect(
        linearERC20Voting.connect(tokenHolder1).setAzorius(deployer.address),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('The owner can update the voting period', async () => {
      expect(await linearERC20Voting.votingPeriod()).to.eq(60);
      await linearERC20Voting.connect(gnosisSafeOwner).updateVotingPeriod(120);

      expect(await linearERC20Voting.votingPeriod()).to.eq(120);
    });

    it('A non-owner cannot update the strategy voting period', async () => {
      await expect(
        linearERC20Voting.connect(tokenHolder1).updateVotingPeriod(120),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('The owner can update the timelock period', async () => {
      expect(await azorius.timelockPeriod()).to.eq(60);
      await azorius.connect(gnosisSafeOwner).updateTimelockPeriod(120);

      expect(await azorius.timelockPeriod()).to.eq(120);
    });

    it('A non-owner cannot update the strategy timelock period', async () => {
      await expect(azorius.connect(tokenHolder1).updateTimelockPeriod(120)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
    });

    it('Getting proposal state on an invalid proposal ID reverts', async () => {
      await expect(azorius.proposalState(0)).to.be.revertedWithCustomError(
        azorius,
        'InvalidProposal',
      );

      await expect(azorius.proposalState(0)).to.be.revertedWithCustomError(
        azorius,
        'InvalidProposal',
      );
    });

    it('A proposal cannot be submitted if the specified strategy has not been enabled', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      // Use an incorrect address for the strategy
      await expect(
        azorius
          .connect(tokenHolder2)
          .submitProposal(await votesERC20.getAddress(), '0x', [proposalTransaction], ''),
      ).to.be.revertedWithCustomError(azorius, 'StrategyDisabled');
    });

    it('Proposal cannot be received by the strategy from address other than Azorius', async () => {
      // Submit call from address that isn't Azorius module
      await expect(linearERC20Voting.initializeProposal('0x')).to.be.revertedWithCustomError(
        linearERC20Voting,
        'OnlyAzorius',
      );
    });

    it("Votes cannot be cast on a proposal that hasn't been submitted yet", async () => {
      // User attempts to vote on proposal that has not yet been submitted
      await expect(
        linearERC20Voting.connect(tokenHolder2).vote(0, 1),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'InvalidProposal');
    });

    it('Votes cannot be cast after the voting period has ended', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      // Increase blocks so that voting period has ended
      await time.advanceBlocks(60);

      // Users vote in support of proposal
      await expect(
        linearERC20Voting.connect(tokenHolder2).vote(0, 1),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'VotingEnded');
    });

    it('A voter cannot vote more than once on a proposal', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      // Users vote in support of proposal
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await expect(
        linearERC20Voting.connect(tokenHolder2).vote(0, 1),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'AlreadyVoted');
    });

    it('Correctly counts proposal Yes votes', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

      await hre.network.provider.send('evm_mine');

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

    it('Correctly counts proposal No votes', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

      await hre.network.provider.send('evm_mine');

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

    it('Correctly counts proposal Abstain votes', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

      await hre.network.provider.send('evm_mine');

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      expect((await linearERC20Voting.getProposalVotes(0)).abstainVotes).to.eq(0);

      // Token holder 1 votes but does not have any voting weight
      await linearERC20Voting.connect(tokenHolder1).vote(0, 2);

      expect((await linearERC20Voting.getProposalVotes(0)).abstainVotes).to.eq(0);

      // Token holder 2 votes with voting weight of 300
      await linearERC20Voting.connect(tokenHolder2).vote(0, 2);

      expect((await linearERC20Voting.getProposalVotes(0)).abstainVotes).to.eq(300);

      // Token holder 3 votes with voting weight of 300
      await linearERC20Voting.connect(tokenHolder3).vote(0, 2);

      expect((await linearERC20Voting.getProposalVotes(0)).abstainVotes).to.eq(600);
    });

    it('A proposal is passed with enough Yes votes and quorum', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

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

    it('A proposal is not passed if there are more No votes than Yes votes', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

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
        azorius.executeProposal(0, [await votesERC20.getAddress()], [0], [tokenTransferData], [0]),
      ).to.be.revertedWithCustomError(azorius, 'ProposalNotExecutable');
    });

    it('A proposal is not passed if quorum is not reached', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      await expect(await linearERC20Voting.isPassed(0)).to.be.false;

      // User votes "Yes"
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      await expect(await linearERC20Voting.isPassed(0)).to.be.false;

      await expect(
        azorius.executeProposal(0, [await votesERC20.getAddress()], [0], [tokenTransferData], [0]),
      ).to.be.revertedWithCustomError(azorius, 'ProposalNotExecutable');

      // Proposal in the failed state
      expect(await azorius.proposalState(0)).to.eq(5);
    });

    it('A proposal is not passed if voting period is not over', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      await expect(await linearERC20Voting.isPassed(0)).to.be.false;

      // Users vote "Yes"
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 1);

      await expect(await linearERC20Voting.isPassed(0)).to.be.false;

      await expect(
        azorius.executeProposal(0, [await votesERC20.getAddress()], [0], [tokenTransferData], [0]),
      ).to.be.revertedWithCustomError(azorius, 'ProposalNotExecutable');

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);
    });

    it('Submitting a proposal emits the event with the associated proposal metadata', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      const proposalMetadata = 'This is my amazing proposal!';

      const tx = await azorius
        .connect(tokenHolder2)
        .submitProposal(
          await linearERC20Voting.getAddress(),
          '0x',
          [proposalTransaction],
          proposalMetadata,
        );
      const receipt = await hre.ethers.provider.getTransactionReceipt(tx.hash);
      const data = receipt!.logs[1].data;
      const topics = receipt!.logs[1].topics;
      const event = azorius.interface.decodeEventLog('ProposalCreated', data, topics);

      // Check that the event emits the correct values
      expect(event.transactions[0].to).to.be.equal(proposalTransaction.to);
      expect(event.transactions[0].value).to.be.equal(proposalTransaction.value);
      expect(event.transactions[0].data).to.be.equal(proposalTransaction.data);
      expect(event.transactions[0].operation).to.be.equal(proposalTransaction.operation);

      expect(event.metadata).to.be.equal(proposalMetadata);
    });

    it('A proposal can be created and executed', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

      const txHash = await azorius.getTxHash(
        await votesERC20.getAddress(),
        0n,
        tokenTransferData,
        0,
      );

      const proposalTxHashes = await azorius.getProposalTxHashes(0);

      const proposalTxHash = await azorius.getProposalTxHash(0, 0);

      expect([txHash]).to.deep.eq(proposalTxHashes);

      expect(txHash).to.deep.eq(proposalTxHash);

      expect(await azorius.getProposal(0)).to.deep.eq([
        await linearERC20Voting.getAddress(),
        [txHash],
        60,
        60,
        0,
      ]);

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      // Users haven't voted yet
      expect(await linearERC20Voting.hasVoted(0, tokenHolder2.address)).to.eq(false);
      expect(await linearERC20Voting.hasVoted(0, tokenHolder3.address)).to.eq(false);

      // Users vote in support of proposal
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 1);

      // Users have voted
      expect(await linearERC20Voting.hasVoted(0, tokenHolder2.address)).to.eq(true);
      expect(await linearERC20Voting.hasVoted(0, tokenHolder3.address)).to.eq(true);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azorius.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is executable
      expect(await azorius.proposalState(0)).to.eq(2);

      expect(await votesERC20.balanceOf(await gnosisSafe.getAddress())).to.eq(600);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azorius.executeProposal(
        0,
        [await votesERC20.getAddress()],
        [0],
        [tokenTransferData],
        [0],
      );

      expect(await azorius.getProposal(0)).to.deep.eq([
        await linearERC20Voting.getAddress(),
        [txHash],
        60,
        60,
        1,
      ]);

      expect(await votesERC20.balanceOf(await gnosisSafe.getAddress())).to.eq(0);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(600);

      // Proposal is in the executed state
      expect(await azorius.proposalState(0)).to.eq(3);
    });

    it('Multiple transactions can be executed from a single proposal', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        100,
      ]);

      const tokenTransferData2 = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        200,
      ]);

      const tokenTransferData3 = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        300,
      ]);

      const proposalTransaction1 = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData1,
        operation: 0,
      };

      const proposalTransaction2 = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData2,
        operation: 0,
      };

      const proposalTransaction3 = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData3,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(
          await linearERC20Voting.getAddress(),
          '0x',
          [proposalTransaction1, proposalTransaction2, proposalTransaction3],
          '',
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

      expect(await votesERC20.balanceOf(await gnosisSafe.getAddress())).to.eq(600);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await azorius.executeProposal(
        0,
        [
          await votesERC20.getAddress(),
          await votesERC20.getAddress(),
          await votesERC20.getAddress(),
        ],
        [0, 0, 0],
        [tokenTransferData1, tokenTransferData2, tokenTransferData3],
        [0, 0, 0],
      );

      expect(await votesERC20.balanceOf(await gnosisSafe.getAddress())).to.eq(0);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(600);

      // Proposal is executed
      expect(await azorius.proposalState(0)).to.eq(3);
    });

    it('Executing a proposal reverts if the transaction cannot be executed', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        700,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

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

      expect(await votesERC20.balanceOf(await gnosisSafe.getAddress())).to.eq(600);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await expect(
        azorius.executeProposal(0, [await votesERC20.getAddress()], [0], [tokenTransferData], [0]),
      ).to.be.revertedWithCustomError(azorius, 'TxFailed');

      // Proposal is executable
      expect(await azorius.proposalState(0)).to.eq(2);

      expect(await votesERC20.balanceOf(await gnosisSafe.getAddress())).to.eq(600);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(0);
    });

    it('If a proposal is not executed during the execution period, it becomes expired', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

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
        azorius.executeProposal(0, [await votesERC20.getAddress()], [0], [tokenTransferData], [0]),
      ).to.be.revertedWithCustomError(azorius, 'ProposalNotExecutable');
    });

    it('A proposal with no transactions that passes goes immediately to executed', async () => {
      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [], '');

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

    it('Only the owner can update the timelock period on Azorius', async () => {
      expect(await azorius.timelockPeriod()).to.eq(60);

      await azorius.connect(gnosisSafeOwner).updateTimelockPeriod(70);

      expect(await azorius.timelockPeriod()).to.eq(70);

      await expect(azorius.connect(tokenHolder1).updateTimelockPeriod(80)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
    });

    it('Only the owner can update the execution period on Azorius', async () => {
      expect(await azorius.executionPeriod()).to.eq(60);

      await azorius.connect(gnosisSafeOwner).updateExecutionPeriod(100);

      expect(await azorius.executionPeriod()).to.eq(100);

      await expect(azorius.connect(tokenHolder1).updateExecutionPeriod(110)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
    });

    it('Only the owner can update the quorum numerator on the ERC20LinearVoting', async () => {
      expect(await linearERC20Voting.quorumNumerator()).to.eq(500000);

      await linearERC20Voting.connect(gnosisSafeOwner).updateQuorumNumerator(600000);

      expect(await linearERC20Voting.quorumNumerator()).to.eq(600000);

      await expect(
        linearERC20Voting.connect(tokenHolder1).updateQuorumNumerator(700000),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Quorum numerator cannot be updated to a value larger than the denominator', async () => {
      await expect(
        linearERC20Voting.connect(gnosisSafeOwner).updateQuorumNumerator(1000001),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'InvalidQuorumNumerator');
    });

    it('Only the owner can update the basis numerator on the ERC20LinearVoting', async () => {
      expect(await linearERC20Voting.basisNumerator()).to.eq(500000);

      await linearERC20Voting.connect(gnosisSafeOwner).updateBasisNumerator(600000);

      expect(await linearERC20Voting.basisNumerator()).to.eq(600000);

      await expect(
        linearERC20Voting.connect(tokenHolder1).updateBasisNumerator(700000),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Basis numerator cannot be updated to a value larger than the denominator', async () => {
      await expect(
        linearERC20Voting.connect(gnosisSafeOwner).updateBasisNumerator(1000001),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'InvalidBasisNumerator');
    });

    it('Only the owner can update the proposer weight on the ERC20LinearVoting', async () => {
      expect(await linearERC20Voting.requiredProposerWeight()).to.eq(300);

      await linearERC20Voting.connect(gnosisSafeOwner).updateRequiredProposerWeight(1);

      expect(await linearERC20Voting.requiredProposerWeight()).to.eq(1);

      await expect(
        linearERC20Voting.connect(tokenHolder1).updateRequiredProposerWeight(2),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Linear ERC20 voting contract cannot be setup with an invalid governance token address', async () => {
      const abiCoder = new ethers.AbiCoder();

      // Deploy Linear ERC20 Voting Strategy
      linearERC20Voting = await new LinearERC20Voting__factory(deployer).deploy();

      const linearERC20VotingSetupCalldata =
        // eslint-disable-next-line camelcase
        LinearERC20Voting__factory.createInterface().encodeFunctionData('setUp', [
          abiCoder.encode(
            ['address', 'address', 'address', 'uint32', 'uint256', 'uint256', 'uint256'],
            [
              gnosisSafeOwner.address, // owner
              ethers.ZeroAddress, // governance token
              await azorius.getAddress(), // Azorius module
              60, // voting period in blocks
              0, // proposer weight
              500000, // quorom numerator, denominator is 1,000,000, so quorum percentage is 50%
              500000, // basis numerator, denominator is 1,000,000, so basis percentage is 50% (simple majority)
            ],
          ),
        ]);

      await expect(
        moduleProxyFactory.deployModule(
          await linearERC20VotingMastercopy.getAddress(),
          linearERC20VotingSetupCalldata,
          '10031021',
        ),
      ).to.be.reverted;
    });

    it('An invalid vote type cannot be cast', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      // Users cast invalid vote types
      await expect(
        linearERC20Voting.connect(tokenHolder2).vote(0, 3),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'InvalidVote');
      await expect(
        linearERC20Voting.connect(tokenHolder2).vote(0, 4),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'InvalidVote');
      await expect(
        linearERC20Voting.connect(tokenHolder2).vote(0, 5),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'InvalidVote');
    });

    it('Azorius can be setup with multiple strategies', async () => {
      const abiCoder = new ethers.AbiCoder();

      // Deploy Azorius module
      azorius = await new Azorius__factory(deployer).deploy();

      const azoriusSetupCalldata =
        // eslint-disable-next-line camelcase
        Azorius__factory.createInterface().encodeFunctionData('setUp', [
          abiCoder.encode(
            ['address', 'address', 'address', 'address[]', 'uint256', 'uint256'],
            [
              gnosisSafeOwner.address,
              await gnosisSafe.getAddress(),
              await gnosisSafe.getAddress(),
              [tokenHolder1.address, tokenHolder2.address, tokenHolder3.address],
              60, // timelock period in blocks
              60, // execution period in blocks
            ],
          ),
        ]);

      await moduleProxyFactory.deployModule(
        await azoriusMastercopy.getAddress(),
        azoriusSetupCalldata,
        '10031021',
      );

      const predictedAzoriusAddress = await calculateProxyAddress(
        moduleProxyFactory,
        await azoriusMastercopy.getAddress(),
        azoriusSetupCalldata,
        '10031021',
      );

      azorius = await hre.ethers.getContractAt('Azorius', predictedAzoriusAddress);

      expect(await azorius.isStrategyEnabled(tokenHolder1.address)).to.eq(true);
      expect(await azorius.isStrategyEnabled(tokenHolder2.address)).to.eq(true);
      expect(await azorius.isStrategyEnabled(tokenHolder3.address)).to.eq(true);
    });

    it('Only a valid proposer can submit proposals', async () => {
      const abiCoder = new ethers.AbiCoder();

      // Deploy Mock Voting Strategy
      const mockVotingStrategyMastercopy = await new MockVotingStrategy__factory(deployer).deploy();

      const mockVotingStrategySetupCalldata =
        // eslint-disable-next-line camelcase
        MockVotingStrategy__factory.createInterface().encodeFunctionData('setUp', [
          abiCoder.encode(
            ['address'],
            [
              tokenHolder1.address, // tokenHolder1 is the only valid proposer
            ],
          ),
        ]);

      await moduleProxyFactory.deployModule(
        await mockVotingStrategyMastercopy.getAddress(),
        mockVotingStrategySetupCalldata,
        '10031021',
      );

      const predictedMockVotingStrategyAddress = await calculateProxyAddress(
        moduleProxyFactory,
        await mockVotingStrategyMastercopy.getAddress(),
        mockVotingStrategySetupCalldata,
        '10031021',
      );

      mockVotingStrategy = await hre.ethers.getContractAt(
        'MockVotingStrategy',
        predictedMockVotingStrategyAddress,
      );

      // Enable the Mock Voting strategy on Azorius
      await azorius.connect(gnosisSafeOwner).enableStrategy(await mockVotingStrategy.getAddress());

      expect(await mockVotingStrategy.isProposer(tokenHolder1.address)).to.eq(true);
      expect(await mockVotingStrategy.isProposer(tokenHolder2.address)).to.eq(false);

      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      // This user was setup as the proposer on the MockVotingStrategy, so should be able to submit a proposal
      await azorius
        .connect(tokenHolder1)
        .submitProposal(await mockVotingStrategy.getAddress(), '0x', [proposalTransaction], '');

      // This user was not setup as the proposer, and so should not be able to submit a proposal
      await expect(
        azorius
          .connect(tokenHolder2)
          .submitProposal(await mockVotingStrategy.getAddress(), '0x', [proposalTransaction], ''),
      ).to.be.revertedWithCustomError(azorius, 'InvalidProposer');

      expect(await mockVotingStrategy.isPassed(0)).to.eq(false);
      expect(await mockVotingStrategy.votingEndBlock(0)).to.eq(0);
    });

    it('A proposal cannot be executed if targets array length is zero', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

      const txHash = await azorius.getTxHash(
        await votesERC20.getAddress(),
        0n,
        tokenTransferData,
        0,
      );

      const proposalTxHashes = await azorius.getProposalTxHashes(0);

      const proposalTxHash = await azorius.getProposalTxHash(0, 0);

      expect([txHash]).to.deep.eq(proposalTxHashes);

      expect(txHash).to.deep.eq(proposalTxHash);

      expect(await azorius.getProposal(0)).to.deep.eq([
        await linearERC20Voting.getAddress(),
        [txHash],
        60,
        60,
        0,
      ]);

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      // Users haven't voted yet
      expect(await linearERC20Voting.hasVoted(0, tokenHolder2.address)).to.eq(false);
      expect(await linearERC20Voting.hasVoted(0, tokenHolder3.address)).to.eq(false);

      // Users vote in support of proposal
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 1);

      // Users have voted
      expect(await linearERC20Voting.hasVoted(0, tokenHolder2.address)).to.eq(true);
      expect(await linearERC20Voting.hasVoted(0, tokenHolder3.address)).to.eq(true);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azorius.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is executable
      expect(await azorius.proposalState(0)).to.eq(2);

      expect(await votesERC20.balanceOf(await gnosisSafe.getAddress())).to.eq(600);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await expect(azorius.executeProposal(0, [], [], [], [])).to.be.revertedWithCustomError(
        azorius,
        'InvalidTxs',
      );
    });

    it('A proposal cannot be executed if unequal array lengths are passed', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

      const txHash = await azorius.getTxHash(
        await votesERC20.getAddress(),
        0n,
        tokenTransferData,
        0,
      );

      const proposalTxHashes = await azorius.getProposalTxHashes(0);

      const proposalTxHash = await azorius.getProposalTxHash(0, 0);

      expect([txHash]).to.deep.eq(proposalTxHashes);

      expect(txHash).to.deep.eq(proposalTxHash);

      expect(await azorius.getProposal(0)).to.deep.eq([
        await linearERC20Voting.getAddress(),
        [txHash],
        60,
        60,
        0,
      ]);

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      // Users haven't voted yet
      expect(await linearERC20Voting.hasVoted(0, tokenHolder2.address)).to.eq(false);
      expect(await linearERC20Voting.hasVoted(0, tokenHolder3.address)).to.eq(false);

      // Users vote in support of proposal
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 1);

      // Users have voted
      expect(await linearERC20Voting.hasVoted(0, tokenHolder2.address)).to.eq(true);
      expect(await linearERC20Voting.hasVoted(0, tokenHolder3.address)).to.eq(true);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azorius.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is executable
      expect(await azorius.proposalState(0)).to.eq(2);

      expect(await votesERC20.balanceOf(await gnosisSafe.getAddress())).to.eq(600);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await expect(
        azorius.executeProposal(0, [await votesERC20.getAddress()], [], [], [0]),
      ).to.be.revertedWithCustomError(azorius, 'InvalidArrayLengths');
    });

    it('A proposal cannot be executed if too many TXs are passed to it', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

      const txHash = await azorius.getTxHash(
        await votesERC20.getAddress(),
        0n,
        tokenTransferData,
        0,
      );

      const proposalTxHashes = await azorius.getProposalTxHashes(0);

      const proposalTxHash = await azorius.getProposalTxHash(0, 0);

      expect([txHash]).to.deep.eq(proposalTxHashes);

      expect(txHash).to.deep.eq(proposalTxHash);

      expect(await azorius.getProposal(0)).to.deep.eq([
        await linearERC20Voting.getAddress(),
        [txHash],
        60,
        60,
        0,
      ]);

      // Proposal is active
      expect(await azorius.proposalState(0)).to.eq(0);

      // Users haven't voted yet
      expect(await linearERC20Voting.hasVoted(0, tokenHolder2.address)).to.eq(false);
      expect(await linearERC20Voting.hasVoted(0, tokenHolder3.address)).to.eq(false);

      // Users vote in support of proposal
      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 1);

      // Users have voted
      expect(await linearERC20Voting.hasVoted(0, tokenHolder2.address)).to.eq(true);
      expect(await linearERC20Voting.hasVoted(0, tokenHolder3.address)).to.eq(true);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // Proposal is timelocked
      expect(await azorius.proposalState(0)).to.eq(1);

      // Increase time so that timelock period has ended
      await time.advanceBlocks(60);

      // Proposal is executable
      expect(await azorius.proposalState(0)).to.eq(2);

      expect(await votesERC20.balanceOf(await gnosisSafe.getAddress())).to.eq(600);
      expect(await votesERC20.balanceOf(deployer.address)).to.eq(0);

      // Execute the transaction
      await expect(
        azorius.executeProposal(
          0,
          [await votesERC20.getAddress(), await votesERC20.getAddress()],
          [0, 0],
          [tokenTransferData, tokenTransferData],
          [0, 0],
        ),
      ).to.be.revertedWithCustomError(azorius, 'InvalidTxs');
    });

    it('A proposal cannot be executed with the wrong TXs passed to it', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const tokenTransferData2 = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        700,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData1,
        operation: 0,
      };

      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

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
        azorius.executeProposal(0, [await votesERC20.getAddress()], [0], [tokenTransferData2], [0]),
      ).to.be.revertedWithCustomError(azorius, 'InvalidTxHash');
    });

    it("A non-proposer can't submit a proposal", async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData1 = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData1,
        operation: 0,
      };

      expect(await linearERC20Voting.isProposer(tokenHolder2.address)).to.eq(true);
      expect(await linearERC20Voting.isProposer(deployer.address)).to.eq(false);

      await expect(
        azorius
          .connect(deployer)
          .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], ''),
      ).to.be.revertedWithCustomError(azorius, 'InvalidProposer()');

      await linearERC20Voting.connect(gnosisSafeOwner).updateRequiredProposerWeight(301);

      expect(await linearERC20Voting.isProposer(tokenHolder2.address)).to.eq(false);
      expect(await linearERC20Voting.isProposer(deployer.address)).to.eq(false);

      await expect(
        azorius
          .connect(deployer)
          .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], ''),
      ).to.be.revertedWithCustomError(azorius, 'InvalidProposer');

      await expect(
        azorius
          .connect(tokenHolder2)
          .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], ''),
      ).to.be.revertedWithCustomError(azorius, 'InvalidProposer');
    });

    it('isPassed logic is correct', async () => {
      // Create transaction to transfer tokens to the deployer
      const tokenTransferData = votesERC20.interface.encodeFunctionData('transfer', [
        deployer.address,
        600,
      ]);

      const proposalTransaction = {
        to: await votesERC20.getAddress(),
        value: 0n,
        data: tokenTransferData,
        operation: 0,
      };

      // Submit first proposal
      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

      await linearERC20Voting.connect(tokenHolder2).vote(0, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(0, 2);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // No totes => 0
      // Yes votes => 300
      // Abstain votes => 300
      // Quorum and basis should be met
      expect(await linearERC20Voting.isPassed(0)).to.eq(true);

      await linearERC20Voting.connect(gnosisSafeOwner).updateQuorumNumerator(600000);

      // Submit second proposal
      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

      await linearERC20Voting.connect(tokenHolder2).vote(1, 1);
      await linearERC20Voting.connect(tokenHolder3).vote(1, 2);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // No totes => 0
      // Yes votes => 300
      // Abstain votes => 300
      // Required quorum is 60%
      // Only 50% of tokens have voted quorum should not be reached
      expect(await linearERC20Voting.isPassed(1)).to.eq(false);

      await linearERC20Voting.connect(gnosisSafeOwner).updateQuorumNumerator(250000);

      // Submit third proposal
      await azorius
        .connect(tokenHolder2)
        .submitProposal(await linearERC20Voting.getAddress(), '0x', [proposalTransaction], '');

      await linearERC20Voting.connect(tokenHolder2).vote(2, 0);
      await linearERC20Voting.connect(tokenHolder3).vote(2, 1);

      // Increase time so that voting period has ended
      await time.advanceBlocks(60);

      // No totes => 300
      // Yes votes => 300
      // Abstain votes => 0
      // Yes votes and no votes split exactly 50 / 50
      // Basis requires MORE than 50% yes votes
      expect(await linearERC20Voting.isPassed(2)).to.eq(false);
    });

    it("An proposal that hasn't been submitted yet is not passed", async () => {
      expect(await linearERC20Voting.isPassed(0)).to.eq(false);
    });
  });
});
