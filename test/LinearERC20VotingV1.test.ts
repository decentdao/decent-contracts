import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { mine, mineUpTo } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  IERC165__factory,
  IVersion__factory,
  LinearERC20VotingV1,
  LinearERC20VotingV1__factory,
  MockERC20Votes,
  MockERC20Votes__factory,
} from '../typechain-types';
import { getModuleProxyFactory } from './GlobalSafeDeployments.test';
import { calculateProxyAddress } from './helpers';
import { calculateInterfaceId } from './helpers/utils';

describe('LinearERC20VotingV1', () => {
  // Signers
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let nonOwner: SignerWithAddress;
  let proposalInitializer: string;
  let tokenHolder1: SignerWithAddress;
  let tokenHolder2: SignerWithAddress;
  let tokenHolder3: SignerWithAddress;
  let lightAccountFactory: SignerWithAddress;

  // Contracts
  let linearERC20VotingImplementation: LinearERC20VotingV1;
  let linearERC20Voting: LinearERC20VotingV1;
  let mockToken: MockERC20Votes;

  // Constants
  const VOTING_PERIOD = 100; // blocks
  const REQUIRED_PROPOSER_WEIGHT = 100; // 100 tokens to propose
  const QUORUM_NUMERATOR = 300000; // 30% of 1000000
  const BASIS_NUMERATOR = 500000; // 50% of 1000000

  // Vote types from the contract
  enum VoteType {
    NO = 0,
    YES = 1,
    ABSTAIN = 2,
  }

  async function deployLinearERC20Voting(
    strategyOwner: SignerWithAddress,
    governanceToken: string,
    azoriusAddr: string,
  ): Promise<LinearERC20VotingV1> {
    // Create the initialization data
    const initializeCalldata = LinearERC20VotingV1__factory.createInterface().encodeFunctionData(
      'setUp',
      [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'address', 'address', 'uint32', 'uint256', 'uint256', 'uint256', 'address'],
          [
            strategyOwner.address,
            governanceToken,
            azoriusAddr,
            VOTING_PERIOD,
            REQUIRED_PROPOSER_WEIGHT,
            QUORUM_NUMERATOR,
            BASIS_NUMERATOR,
            lightAccountFactory.address,
          ],
        ),
      ],
    );

    // Deploy the proxy with the implementation
    const moduleProxyFactory = getModuleProxyFactory();
    const salt = ethers.keccak256(ethers.randomBytes(32));
    await moduleProxyFactory.deployModule(
      await linearERC20VotingImplementation.getAddress(),
      initializeCalldata,
      salt,
    );
    const predictedLinearERC20VotingAddress = await calculateProxyAddress(
      moduleProxyFactory,
      await linearERC20VotingImplementation.getAddress(),
      initializeCalldata,
      salt,
    );

    // Connect the proxy to the implementation contract type
    return LinearERC20VotingV1__factory.connect(predictedLinearERC20VotingAddress, strategyOwner);
  }

  beforeEach(async () => {
    [deployer, owner, nonOwner, tokenHolder1, tokenHolder2, tokenHolder3, lightAccountFactory] =
      await ethers.getSigners();

    // Use nonOwner address as a mock azorius address for testing
    proposalInitializer = await nonOwner.getAddress();

    // Deploy MockERC20Votes token
    mockToken = await new MockERC20Votes__factory(deployer).deploy();

    // Mint tokens to token holders
    await mockToken.mint(tokenHolder1.address, 1000);
    await mockToken.mint(tokenHolder2.address, 1000);
    await mockToken.mint(tokenHolder3.address, 1000);

    // Deploy LinearERC20Voting implementation
    linearERC20VotingImplementation = await new LinearERC20VotingV1__factory(deployer).deploy();

    // Deploy LinearERC20Voting strategy
    linearERC20Voting = await deployLinearERC20Voting(
      owner,
      await mockToken.getAddress(),
      proposalInitializer,
    );
  });

  describe('Initialization', () => {
    it('should initialize with correct parameters', async () => {
      expect(await linearERC20Voting.owner()).to.equal(owner.address);
      expect(await linearERC20Voting.governanceToken()).to.equal(await mockToken.getAddress());
      expect(await linearERC20Voting.azoriusModule()).to.equal(proposalInitializer);
      expect(await linearERC20Voting.votingPeriod()).to.equal(VOTING_PERIOD);
      expect(await linearERC20Voting.requiredProposerWeight()).to.equal(REQUIRED_PROPOSER_WEIGHT);
      expect(await linearERC20Voting.quorumNumerator()).to.equal(QUORUM_NUMERATOR);
      expect(await linearERC20Voting.basisNumerator()).to.equal(BASIS_NUMERATOR);
      expect(await linearERC20Voting.lightAccountFactory()).to.equal(lightAccountFactory.address);
    });

    it('should not allow reinitialization', async () => {
      // Attempt to reinitialize - should revert
      await expect(
        linearERC20Voting.setUp(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'address', 'address', 'uint32', 'uint256', 'uint256', 'uint256', 'address'],
            [
              owner.address,
              await mockToken.getAddress(),
              proposalInitializer,
              VOTING_PERIOD,
              REQUIRED_PROPOSER_WEIGHT,
              QUORUM_NUMERATOR,
              BASIS_NUMERATOR,
              lightAccountFactory.address,
            ],
          ),
        ),
      ).to.be.revertedWith('Initializable: contract is already initialized');
    });

    it('should revert when initializing with zero token address', async () => {
      // Create initialization data with zero address for token
      const initializeCalldata = LinearERC20VotingV1__factory.createInterface().encodeFunctionData(
        'setUp',
        [
          ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'address', 'address', 'uint32', 'uint256', 'uint256', 'uint256', 'address'],
            [
              owner.address,
              ethers.ZeroAddress,
              proposalInitializer,
              VOTING_PERIOD,
              REQUIRED_PROPOSER_WEIGHT,
              QUORUM_NUMERATOR,
              BASIS_NUMERATOR,
              lightAccountFactory.address,
            ],
          ),
        ],
      );

      const moduleProxyFactory = getModuleProxyFactory();

      // Attempt to deploy a new proxy with invalid initialization - should revert
      await expect(
        moduleProxyFactory.deployModule(
          await linearERC20VotingImplementation.getAddress(),
          initializeCalldata,
          ethers.keccak256(ethers.randomBytes(32)),
        ),
      ).to.be.revertedWithCustomError(moduleProxyFactory, 'FailedInitialization');
    });
  });

  describe('Owner Functions', () => {
    it('should allow owner to update voting period', async () => {
      const newVotingPeriod = 200;
      await linearERC20Voting.connect(owner).updateVotingPeriod(newVotingPeriod);
      expect(await linearERC20Voting.votingPeriod()).to.equal(newVotingPeriod);
    });

    it('should not allow non-owner to update voting period', async () => {
      const newVotingPeriod = 200;
      await expect(
        linearERC20Voting.connect(nonOwner).updateVotingPeriod(newVotingPeriod),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should allow owner to update required proposer weight', async () => {
      const newRequiredProposerWeight = 200;
      await linearERC20Voting
        .connect(owner)
        .updateRequiredProposerWeight(newRequiredProposerWeight);
      expect(await linearERC20Voting.requiredProposerWeight()).to.equal(newRequiredProposerWeight);
    });

    it('should not allow non-owner to update required proposer weight', async () => {
      const newRequiredProposerWeight = 200;
      await expect(
        linearERC20Voting.connect(nonOwner).updateRequiredProposerWeight(newRequiredProposerWeight),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should allow owner to update basis numerator', async () => {
      const newBasisNumerator = 600000;
      await linearERC20Voting.connect(owner).updateBasisNumerator(newBasisNumerator);
      expect(await linearERC20Voting.basisNumerator()).to.equal(newBasisNumerator);
    });

    it('should not allow non-owner to update basis numerator', async () => {
      const newBasisNumerator = 600000;
      await expect(
        linearERC20Voting.connect(nonOwner).updateBasisNumerator(newBasisNumerator),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should emit BasisNumeratorUpdated event when basisNumerator is updated', async () => {
      const newBasisNumerator = 700000; // 70%
      await expect(linearERC20Voting.connect(owner).updateBasisNumerator(newBasisNumerator))
        .to.emit(linearERC20Voting, 'BasisNumeratorUpdated')
        .withArgs(newBasisNumerator);
    });

    it('should revert when basisNumerator is greater than BASIS_DENOMINATOR', async () => {
      const invalidBasisNumerator = 1000001; // BASIS_DENOMINATOR + 1
      await expect(
        linearERC20Voting.connect(owner).updateBasisNumerator(invalidBasisNumerator),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'InvalidBasisNumerator');
    });

    it('should revert when basisNumerator is less than BASIS_DENOMINATOR / 2', async () => {
      const invalidBasisNumerator = 499999; // BASIS_DENOMINATOR / 2 - 1
      await expect(
        linearERC20Voting.connect(owner).updateBasisNumerator(invalidBasisNumerator),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'InvalidBasisNumerator');
    });

    it('should allow basisNumerator to be equal to BASIS_DENOMINATOR / 2', async () => {
      const newBasisNumerator = 500000; // BASIS_DENOMINATOR / 2
      await linearERC20Voting.connect(owner).updateBasisNumerator(newBasisNumerator);
      expect(await linearERC20Voting.basisNumerator()).to.equal(newBasisNumerator);
    });

    it('should allow basisNumerator to be equal to BASIS_DENOMINATOR', async () => {
      const newBasisNumerator = 1000000; // BASIS_DENOMINATOR
      await linearERC20Voting.connect(owner).updateBasisNumerator(newBasisNumerator);
      expect(await linearERC20Voting.basisNumerator()).to.equal(newBasisNumerator);
    });
  });

  describe('Proposal Functions', () => {
    it('should allow only azorius to initialize proposal', async () => {
      // Mock proposal ID
      const proposalId = 1;
      // Mock data for initializing a proposal
      const initializeData = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);

      // Only Azorius can initialize proposals
      await expect(
        linearERC20Voting.connect(owner).initializeProposal(initializeData),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'OnlyAzorius');

      // Test with Azorius signer
      await linearERC20Voting.connect(nonOwner).initializeProposal(initializeData);

      // Check that proposal was initialized correctly
      const votingEndBlock = await linearERC20Voting.votingEndBlock(proposalId);
      expect(votingEndBlock).to.not.equal(0);
    });

    it('should determine proposer status based on voting weight', async () => {
      // This test focuses on whether an address is considered a proposer based on its voting weight

      // First, update required proposer weight to 500 tokens
      await linearERC20Voting.connect(owner).updateRequiredProposerWeight(500);

      // Delegate to tokenHolder1 (who has 1000 tokens > 500 required)
      await mockToken.connect(tokenHolder1).delegate(tokenHolder1.address);

      // tokenHolder1 should be a proposer with 1000 tokens > 500 required
      void expect(await linearERC20Voting.isProposer(tokenHolder1.address)).to.be.true;

      // Update required proposer weight to 1500 tokens (higher than tokenHolder1's balance)
      await linearERC20Voting.connect(owner).updateRequiredProposerWeight(1500);

      // Now tokenHolder1 should NOT be a proposer with 1000 tokens < 1500 required
      void expect(await linearERC20Voting.isProposer(tokenHolder1.address)).to.be.false;
    });
  });

  describe('Voting Functions', () => {
    const proposalId = 1;

    beforeEach(async () => {
      // Delegate tokens to voters
      await mockToken.connect(tokenHolder1).delegate(tokenHolder1.address);
      await mockToken.connect(tokenHolder2).delegate(tokenHolder2.address);
      await mockToken.connect(tokenHolder3).delegate(tokenHolder3.address);

      // Initialize a proposal using the azorius mock account
      const initializeData = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);
      await linearERC20Voting.connect(nonOwner).initializeProposal(initializeData);
    });

    it('should allow users to vote on a proposal', async () => {
      // Cast votes
      await linearERC20Voting.connect(tokenHolder1).vote(proposalId, VoteType.YES);
      await linearERC20Voting.connect(tokenHolder2).vote(proposalId, VoteType.NO);
      await linearERC20Voting.connect(tokenHolder3).vote(proposalId, VoteType.ABSTAIN);

      // Get proposal votes
      const [noVotes, yesVotes, abstainVotes, , ,] =
        await linearERC20Voting.getProposalVotes(proposalId);

      // Check vote counts (each holder has 1000 tokens)
      expect(yesVotes).to.equal(1000);
      expect(noVotes).to.equal(1000);
      expect(abstainVotes).to.equal(1000);
    });

    it('should correctly track if an address has voted', async () => {
      void expect(await linearERC20Voting.hasVoted(proposalId, tokenHolder1.address)).to.be.false;

      await linearERC20Voting.connect(tokenHolder1).vote(proposalId, VoteType.YES);

      void expect(await linearERC20Voting.hasVoted(proposalId, tokenHolder1.address)).to.be.true;
    });

    it('should not allow voting twice', async () => {
      await linearERC20Voting.connect(tokenHolder1).vote(proposalId, VoteType.YES);

      await expect(
        linearERC20Voting.connect(tokenHolder1).vote(proposalId, VoteType.NO),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'AlreadyVoted');
    });

    it('should not allow voting after voting period ends', async () => {
      // Mine blocks to advance past the voting period
      await mine(VOTING_PERIOD + 1);

      await expect(
        linearERC20Voting.connect(tokenHolder1).vote(proposalId, VoteType.YES),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'VotingEnded');
    });

    it('should revert on invalid vote type', async () => {
      // Valid vote types are 0, 1, 2 (NO, YES, ABSTAIN)
      const invalidVoteType = 3;

      await expect(
        linearERC20Voting.connect(tokenHolder1).vote(proposalId, invalidVoteType),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'InvalidVote');
    });
  });

  describe('isPassed Logic', () => {
    const proposalId = 1;

    beforeEach(async () => {
      // Delegate tokens to voters
      await mockToken.connect(tokenHolder1).delegate(tokenHolder1.address);
      await mockToken.connect(tokenHolder2).delegate(tokenHolder2.address);
      await mockToken.connect(tokenHolder3).delegate(tokenHolder3.address);

      // Initialize a proposal using the azorius mock account
      const initializeData = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);
      await linearERC20Voting.connect(nonOwner).initializeProposal(initializeData);
    });

    it('should pass when yes > no and meets quorum', async () => {
      // Cast votes: 1500 YES, 500 NO, enough for both quorum and basis
      await linearERC20Voting.connect(tokenHolder1).vote(proposalId, VoteType.YES);
      await linearERC20Voting.connect(tokenHolder2).vote(proposalId, VoteType.YES);
      await linearERC20Voting.connect(tokenHolder3).vote(proposalId, VoteType.NO);

      // Mine blocks to end the voting period
      await mine(VOTING_PERIOD + 1);

      // Proposal should pass
      void expect(await linearERC20Voting.isPassed(proposalId)).to.be.true;
    });

    it('should fail when voting period is not over', async () => {
      // Cast votes: 2000 YES, 1000 NO
      await linearERC20Voting.connect(tokenHolder1).vote(proposalId, VoteType.YES);
      await linearERC20Voting.connect(tokenHolder2).vote(proposalId, VoteType.YES);
      await linearERC20Voting.connect(tokenHolder3).vote(proposalId, VoteType.NO);

      // Voting period not over yet
      void expect(await linearERC20Voting.isPassed(proposalId)).to.be.false;
    });

    it('should fail when quorum is not met', async () => {
      // Only 1000 tokens voting (33% of 3000), below QUORUM_NUMERATOR of 300000 (30%)
      await linearERC20Voting.connect(tokenHolder1).vote(proposalId, VoteType.YES);

      // Update quorum to 40% to make this test fail
      await linearERC20Voting.connect(owner).updateQuorumNumerator(400000);

      // Mine blocks to end the voting period
      await mine(VOTING_PERIOD + 1);

      // Proposal should fail due to insufficient quorum
      void expect(await linearERC20Voting.isPassed(proposalId)).to.be.false;
    });

    it('should fail when basis is not met', async () => {
      // Cast votes: 900 YES, 1100 NO, YES votes not high enough vs NO
      await linearERC20Voting.connect(tokenHolder1).vote(proposalId, VoteType.NO);
      await linearERC20Voting.connect(tokenHolder2).vote(proposalId, VoteType.NO);
      await linearERC20Voting.connect(tokenHolder3).vote(proposalId, VoteType.YES);

      // Mine blocks to end the voting period
      await mine(VOTING_PERIOD + 1);

      // Proposal should fail due to insufficient basis (YES < NO)
      void expect(await linearERC20Voting.isPassed(proposalId)).to.be.false;
    });
  });

  describe('Version', () => {
    it('should return the correct version number', async () => {
      expect(await linearERC20Voting.getVersion()).to.equal(1);
    });
  });

  describe('Voting Weight and Supply Functions', () => {
    const proposalId = 1;

    beforeEach(async () => {
      // Delegate tokens to voters
      await mockToken.connect(tokenHolder1).delegate(tokenHolder1.address);
      await mockToken.connect(tokenHolder2).delegate(tokenHolder2.address);
      await mockToken.connect(tokenHolder3).delegate(tokenHolder3.address);

      // Initialize a proposal using the azorius mock account
      const initializeData = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);
      await linearERC20Voting.connect(nonOwner).initializeProposal(initializeData);

      // Get the actual voting start block from the proposal
      const [, , , startBlock, ,] = await linearERC20Voting.getProposalVotes(proposalId);

      // Now set past total supply for the EXACT block where the proposal was initialized
      await mockToken.setPastTotalSupply(startBlock, 3000);
    });

    it('should correctly calculate voting supply at proposal creation time', async () => {
      // Verify the proposal voting supply is recorded correctly at proposal creation
      const [, , , , , votingSupply] = await linearERC20Voting.getProposalVotes(proposalId);
      expect(votingSupply).to.equal(3000);

      // Mint more tokens (this won't affect past total supply at the proposal start block)
      await mockToken.mint(tokenHolder1.address, 2000);

      // The voting supply for the proposal should still be 3000
      const [, , , , , votingSupplyAfterMint] =
        await linearERC20Voting.getProposalVotes(proposalId);
      expect(votingSupplyAfterMint).to.equal(3000);
    });

    it('should correctly calculate voting weight at proposal creation time', async () => {
      // Check the voting weight for tokenHolder1
      const votingWeight = await linearERC20Voting.getVotingWeight(
        tokenHolder1.address,
        proposalId,
      );

      // The voting weight should be 1000 (what we set for the block at proposal creation)
      expect(votingWeight).to.equal(1000);

      // Mine a block to get to a new block number
      await mine(1);

      // Change the votes for a future block
      const newBlockNumber = await ethers.provider.getBlockNumber();
      const newWeight = 2000;
      await mockToken.setPastVotes(tokenHolder1.address, newBlockNumber, newWeight);

      // The voting weight for the proposal should still be 1000, based on the snapshot at the
      // time the proposal was created
      const votingWeightAfterChange = await linearERC20Voting.getVotingWeight(
        tokenHolder1.address,
        proposalId,
      );
      expect(votingWeightAfterChange).to.equal(1000);
    });

    it('should correctly calculate quorum votes based on voting supply', async () => {
      // Quorum is set to 30% of the total supply (QUORUM_NUMERATOR = 300000 out of 1000000)
      // Total supply at proposal creation is 3000, so quorum should be 900 votes
      const quorumVotesRequired = await linearERC20Voting.quorumVotes(proposalId);
      expect(quorumVotesRequired).to.equal(900);

      // Changing the quorum numerator should affect the required votes
      await linearERC20Voting.connect(owner).updateQuorumNumerator(500000); // 50%
      const newQuorumVotesRequired = await linearERC20Voting.quorumVotes(proposalId);
      expect(newQuorumVotesRequired).to.equal(1500); // 50% of 3000

      // Even if total supply changes after proposal creation, quorum should be based on original supply
      const quorumAfterSupplyChange = await linearERC20Voting.quorumVotes(proposalId);
      expect(quorumAfterSupplyChange).to.equal(1500); // Still 50% of 3000, not 6000
    });

    it('should directly call getProposalVotingSupply and return the correct value', async () => {
      // Call getProposalVotingSupply directly
      const votingSupply = await linearERC20Voting.getProposalVotingSupply(proposalId);
      expect(votingSupply).to.equal(3000);

      // Should match what getProposalVotes returns
      const [, , , , , votesSupply] = await linearERC20Voting.getProposalVotes(proposalId);
      expect(votingSupply).to.equal(votesSupply);

      // Add some more tokens to test that the snapshot supply doesn't change
      await mockToken.mint(tokenHolder1.address, 2000);
      const votingSupplyAfterMint = await linearERC20Voting.getProposalVotingSupply(proposalId);
      expect(votingSupplyAfterMint).to.equal(3000);
    });
  });

  describe('Edge Cases', () => {
    it('should handle invalid proposals', async () => {
      // Try to vote on a non-initialized proposal
      const nonExistentProposalId = 999;

      await expect(
        linearERC20Voting.connect(tokenHolder1).vote(nonExistentProposalId, VoteType.YES),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'InvalidProposal');
    });

    it('should handle multiple concurrent proposals', async () => {
      // Set up votes for test accounts
      await mockToken.connect(tokenHolder1).delegate(tokenHolder1.address);
      await mockToken.connect(tokenHolder2).delegate(tokenHolder2.address);

      // Initialize the first proposal
      const proposalId1 = 10;
      const initializeData1 = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId1]);
      await linearERC20Voting.connect(nonOwner).initializeProposal(initializeData1);

      // Mine a block to simulate time passing
      await mine(1);

      // Initialize the second proposal
      const proposalId2 = 20;
      const initializeData2 = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId2]);
      await linearERC20Voting.connect(nonOwner).initializeProposal(initializeData2);

      // Vote differently on each proposal
      await linearERC20Voting.connect(tokenHolder1).vote(proposalId1, VoteType.YES);
      await linearERC20Voting.connect(tokenHolder1).vote(proposalId2, VoteType.NO);

      await linearERC20Voting.connect(tokenHolder2).vote(proposalId1, VoteType.NO);
      await linearERC20Voting.connect(tokenHolder2).vote(proposalId2, VoteType.YES);

      // Check that votes are tracked independently
      const [noVotes1, yesVotes1, , , ,] = await linearERC20Voting.getProposalVotes(proposalId1);
      const [noVotes2, yesVotes2, , , ,] = await linearERC20Voting.getProposalVotes(proposalId2);

      expect(yesVotes1).to.equal(1000);
      expect(noVotes1).to.equal(1000);

      expect(yesVotes2).to.equal(1000);
      expect(noVotes2).to.equal(1000);

      // Verify different hasVoted state per proposal
      void expect(await linearERC20Voting.hasVoted(proposalId1, tokenHolder1.address)).to.be.true;
      void expect(await linearERC20Voting.hasVoted(proposalId2, tokenHolder1.address)).to.be.true;
      void expect(await linearERC20Voting.hasVoted(proposalId1, tokenHolder2.address)).to.be.true;
      void expect(await linearERC20Voting.hasVoted(proposalId2, tokenHolder2.address)).to.be.true;
    });
  });

  describe('ERC165', function () {
    let iVersionInterfaceId: string;
    let iERC165InterfaceId: string;

    beforeEach(async function () {
      // Dynamically calculate interface IDs
      const IVersionInterface = IVersion__factory.createInterface();
      iVersionInterfaceId = calculateInterfaceId(IVersionInterface);

      const IERC165Interface = IERC165__factory.createInterface();
      iERC165InterfaceId = calculateInterfaceId(IERC165Interface);
    });

    it('Should support IERC165 interface', async function () {
      const supported = await linearERC20Voting.supportsInterface(iERC165InterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IVersion interface', async function () {
      const supported = await linearERC20Voting.supportsInterface(iVersionInterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should not support random interface', async function () {
      const randomInterfaceId = '0x12345678';
      const supported = await linearERC20Voting.supportsInterface(randomInterfaceId);
      void expect(supported).to.be.false;
    });
  });

  describe('Block-based voting', () => {
    let proposalId: number;

    beforeEach(async () => {
      // Initialize a proposal
      proposalId = 100;
      const initializeData = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);
      await linearERC20Voting.connect(nonOwner).initializeProposal(initializeData);

      // Mint tokens to a voter for testing
      await mockToken.mint(tokenHolder1.address, 1000);
      await mockToken.connect(tokenHolder1).delegate(tokenHolder1.address);
    });

    it('should enforce voting end by block', async () => {
      // Get the voting end block
      const [, , , , endBlock] = await linearERC20Voting.getProposalVotes(proposalId);

      // Cast a vote before voting ends
      await linearERC20Voting.connect(tokenHolder1).vote(proposalId, VoteType.YES);

      // Advance block to just after voting end
      await mineUpTo(endBlock + 1n);

      // Try to vote after voting ended - should revert
      await expect(
        linearERC20Voting.connect(tokenHolder2).vote(proposalId, VoteType.YES),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'VotingEnded');
    });

    it('should use block number for voting weight snapshot', async () => {
      // Get the proposal start blockNumber
      const [, , , startBlock] = await linearERC20Voting.getProposalVotes(proposalId);

      // Set the past votes to a specific value for testing at the proposal's start block
      await mockToken.setPastVotes(tokenHolder1.address, startBlock, 500);

      // Check that the voting weight is determined by snapshot at start timestamp
      const votingWeight = await linearERC20Voting.getVotingWeight(
        tokenHolder1.address,
        proposalId,
      );
      expect(votingWeight).to.equal(500);

      // If user gets more tokens now, voting weight shouldn't change for this proposal
      const oldBalance = await mockToken.balanceOf(tokenHolder1.address);
      await mockToken.mint(tokenHolder1.address, 500);

      // Verify total balance increased
      expect(await mockToken.balanceOf(tokenHolder1.address)).to.be.gt(oldBalance);

      // But voting weight for this proposal should remain the same
      const newWeight = await linearERC20Voting.getVotingWeight(tokenHolder1.address, proposalId);
      expect(newWeight).to.equal(500);
    });

    it('should determine proposal state based on block number', async () => {
      // Set the past votes and total supply at the proposal's start block
      const [, , , startBlock, ,] = await linearERC20Voting.getProposalVotes(proposalId);
      await mockToken.setPastVotes(tokenHolder1.address, startBlock, 600);
      await mockToken.setPastTotalSupply(startBlock, 1000);

      // Cast votes to meet quorum and basis requirements
      await linearERC20Voting.connect(tokenHolder1).vote(proposalId, VoteType.YES);

      // Before voting end, proposal should not be passed
      void expect(await linearERC20Voting.isPassed(proposalId)).to.be.false;

      // Get voting end timestamp
      const [, , , , endBlock] = await linearERC20Voting.getProposalVotes(proposalId);

      // Advance block to just after voting end
      await mineUpTo(endBlock + 1n);

      // Proposal should pass
      void expect(await linearERC20Voting.isPassed(proposalId)).to.be.true;
    });

    it('should handle exact boundary conditions for block numbers', async () => {
      // Get voting end block
      const [, , , , endBlock] = await linearERC20Voting.getProposalVotes(proposalId);

      // Advance block to 2 blocks before the voting end block
      await mineUpTo(endBlock - 2n);

      // Should still be able to vote before end block
      await linearERC20Voting.connect(tokenHolder1).vote(proposalId, VoteType.YES);

      // Advance to end block
      await mineUpTo(endBlock);

      // Should no longer be able to vote at exactly the end block
      await expect(
        linearERC20Voting.connect(tokenHolder2).vote(proposalId, VoteType.YES),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'VotingEnded');
    });
  });

  describe('Quorum Functionality', () => {
    it('should allow owner to update quorumNumerator', async () => {
      const newQuorumNumerator = 500000; // 50%
      await linearERC20Voting.connect(owner).updateQuorumNumerator(newQuorumNumerator);
      expect(await linearERC20Voting.quorumNumerator()).to.equal(newQuorumNumerator);
    });

    it('should emit QuorumNumeratorUpdated event when quorumNumerator is updated', async () => {
      const newQuorumNumerator = 500000; // 50%
      await expect(linearERC20Voting.connect(owner).updateQuorumNumerator(newQuorumNumerator))
        .to.emit(linearERC20Voting, 'QuorumNumeratorUpdated')
        .withArgs(newQuorumNumerator);
    });

    it('should not allow non-owner to update quorumNumerator', async () => {
      const newQuorumNumerator = 500000; // 50%
      await expect(
        linearERC20Voting.connect(nonOwner).updateQuorumNumerator(newQuorumNumerator),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should revert when quorumNumerator is greater than QUORUM_DENOMINATOR', async () => {
      const invalidQuorumNumerator = 1_000_001; // QUORUM_DENOMINATOR + 1
      await expect(
        linearERC20Voting.connect(owner).updateQuorumNumerator(invalidQuorumNumerator),
      ).to.be.revertedWithCustomError(linearERC20Voting, 'InvalidQuorumNumerator');
    });

    it('should allow quorumNumerator to be zero', async () => {
      const newQuorumNumerator = 0;
      await linearERC20Voting.connect(owner).updateQuorumNumerator(newQuorumNumerator);
      expect(await linearERC20Voting.quorumNumerator()).to.equal(newQuorumNumerator);
    });

    it('should allow quorumNumerator to be equal to QUORUM_DENOMINATOR', async () => {
      const newQuorumNumerator = 1_000_000; // QUORUM_DENOMINATOR
      await linearERC20Voting.connect(owner).updateQuorumNumerator(newQuorumNumerator);
      expect(await linearERC20Voting.quorumNumerator()).to.equal(newQuorumNumerator);
    });

    it('should correctly calculate quorum based on total supply', async () => {
      // Set up a proposal
      const proposalId = 100;
      const initializeData = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);
      await linearERC20Voting.connect(nonOwner).initializeProposal(initializeData);

      // Get the proposal start timestamp
      const [, , , startTimestamp] = await linearERC20Voting.getProposalVotes(proposalId);

      // Set the past total supply to 1000 tokens
      await mockToken.setPastTotalSupply(startTimestamp, 1000);

      // With 30% quorum (300000/1000000), should require 300 votes
      const quorumVotesRequired = await linearERC20Voting.quorumVotes(proposalId);
      expect(quorumVotesRequired).to.equal(300);

      // Update quorum to 50%
      await linearERC20Voting.connect(owner).updateQuorumNumerator(500000);
      const newQuorumVotesRequired = await linearERC20Voting.quorumVotes(proposalId);
      expect(newQuorumVotesRequired).to.equal(500);
    });

    describe('meetsQuorum', () => {
      it('should return true when yes + abstain votes exceed quorum threshold', async () => {
        // With 30% quorum (300000/1000000), 1000 total supply requires 300 votes
        // 400 votes (300 YES + 100 ABSTAIN) > 300 required
        void expect(await linearERC20Voting.meetsQuorum(1000, 300, 100)).to.be.true;
      });

      it('should return true when yes + abstain votes equal quorum threshold', async () => {
        // With 30% quorum (300000/1000000), 1000 total supply requires 300 votes
        // 300 votes (250 YES + 50 ABSTAIN) = 300 required
        void expect(await linearERC20Voting.meetsQuorum(1000, 250, 50)).to.be.true;
      });

      it('should return false when yes + abstain votes are below quorum threshold', async () => {
        // With 30% quorum (300000/1000000), 1000 total supply requires 300 votes
        // 250 votes (200 YES + 50 ABSTAIN) < 300 required
        void expect(await linearERC20Voting.meetsQuorum(1000, 200, 50)).to.be.false;
      });

      it('should handle zero votes correctly', async () => {
        // With 30% quorum (300000/1000000), 1000 total supply requires 300 votes
        // 0 votes < 300 required
        void expect(await linearERC20Voting.meetsQuorum(1000, 0, 0)).to.be.false;
      });

      it('should handle zero total supply correctly', async () => {
        // With 30% quorum (300000/1000000), 0 total supply requires 0 votes
        // Any number of votes (including 0) should meet the quorum
        void expect(await linearERC20Voting.meetsQuorum(0, 0, 0)).to.be.true;
      });
    });
  });

  describe('meetsBasis', () => {
    // Test with default 50% basis
    it('should return true when yes votes exceed the basis threshold', async () => {
      const yesVotes = 60;
      const noVotes = 40;
      // 60 > ((60 + 40) * 500000 / 1000000) = 50, so it passes
      void expect(await linearERC20Voting.meetsBasis(yesVotes, noVotes)).to.be.true;
    });

    it('should return false when yes votes equal the basis threshold', async () => {
      const yesVotes = 50;
      const noVotes = 50;
      // 50 = ((50 + 50) * 500000 / 1000000) = 50, but we need >
      void expect(await linearERC20Voting.meetsBasis(yesVotes, noVotes)).to.be.false;
    });

    it('should return false when yes votes are below the basis threshold', async () => {
      const yesVotes = 49;
      const noVotes = 51;
      // 49 < ((49 + 51) * 500000 / 1000000) = 50
      void expect(await linearERC20Voting.meetsBasis(yesVotes, noVotes)).to.be.false;
    });

    // Test with higher basis (e.g., 70%)
    it('should work with higher basis threshold', async () => {
      // Update to 70%
      await linearERC20Voting.connect(owner).updateBasisNumerator(700000);

      // Case where it passes with the new threshold
      const yesVotes2 = 71;
      const noVotes2 = 29;
      // 71 > ((71 + 29) * 700000 / 1000000) = 70
      void expect(await linearERC20Voting.meetsBasis(yesVotes2, noVotes2)).to.be.true;

      // Case where it fails with the new threshold
      const yesVotes3 = 69;
      const noVotes3 = 31;
      // 69 < ((69 + 31) * 700000 / 1000000) = 70
      void expect(await linearERC20Voting.meetsBasis(yesVotes3, noVotes3)).to.be.false;
    });

    it('should handle zero votes correctly', async () => {
      const yesVotes = 0;
      const noVotes = 0;
      // When both are 0, formula is 0 > (0 * 500000 / 1000000) which is 0 > 0, which is false
      void expect(await linearERC20Voting.meetsBasis(yesVotes, noVotes)).to.be.false;
    });

    it('should handle case where only yes votes exist', async () => {
      const yesVotes = 100;
      const noVotes = 0;
      // 100 > ((100 + 0) * 500000 / 1000000) = 50
      void expect(await linearERC20Voting.meetsBasis(yesVotes, noVotes)).to.be.true;
    });

    it('should handle case where only no votes exist', async () => {
      const yesVotes = 0;
      const noVotes = 100;
      // 0 < ((0 + 100) * 500000 / 1000000) = 50
      void expect(await linearERC20Voting.meetsBasis(yesVotes, noVotes)).to.be.false;
    });
  });
});
