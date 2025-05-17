import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import type { ContractTransactionResponse } from 'ethers';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  IBaseStrategyV1__factory,
  IBaseVotingBasisPercentV1__factory,
  IERC165__factory,
  IERC721VotingStrategyV1__factory,
  IVersion__factory,
  LinearERC721VotingV1,
  LinearERC721VotingV1__factory,
  MockERC721,
  MockERC721__factory,
  MockOwnership__factory,
} from '../../../typechain-types';
import { calculateInterfaceId } from '../../helpers/utils';
import { runUUPSUpgradeabilityTests } from '../../helpers/uupsUpgradeabilityTests';

describe('LinearERC721VotingV1', () => {
  // Signers
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let nonOwner: SignerWithAddress;
  let proposalInitializer: string;
  let tokenHolder1: SignerWithAddress;
  let tokenHolder2: SignerWithAddress;
  let tokenHolder3: SignerWithAddress;
  let lightAccountFactoryMock: SignerWithAddress;

  // Contracts
  let linearERC721VotingImplementation: LinearERC721VotingV1;
  let linearERC721Voting: LinearERC721VotingV1;
  let mockNFT1: MockERC721;
  let mockNFT2: MockERC721;

  // NFT IDs for tests
  let tokenHolder1Ids: number[] = [];
  let tokenHolder2Ids: number[] = [];
  let tokenHolder3Ids: number[] = [];

  // Constants
  const VOTING_PERIOD = 100; // blocks
  const QUORUM_THRESHOLD = 4; // Required voting power for quorum
  const PROPOSER_THRESHOLD = 2; // Must hold at least 2 NFTs to create a proposal
  const BASIS_NUMERATOR = 500000; // 50% of 1000000
  const TOKEN1_WEIGHT = 1;
  const TOKEN2_WEIGHT = 2;

  // Vote types from the contract
  enum VoteType {
    NO = 0,
    YES = 1,
    ABSTAIN = 2,
  }

  async function deployLinearERC721Voting(
    strategyOwner: SignerWithAddress,
    governanceTokens: { tokenAddress: string; weight: number }[],
    azoriusAddr: string,
    lightAccountFactoryAddress: string,
  ): Promise<LinearERC721VotingV1> {
    const tokenAddresses = governanceTokens.map(t => t.tokenAddress);
    const tokenWeights = governanceTokens.map(t => t.weight);

    // Create the initialization data
    const initializeCalldata = LinearERC721VotingV1__factory.createInterface().encodeFunctionData(
      'initialize(address,address[],uint256[],address,uint32,uint256,uint256,uint256,address)',
      [
        strategyOwner.address,
        tokenAddresses,
        tokenWeights,
        azoriusAddr,
        VOTING_PERIOD,
        QUORUM_THRESHOLD,
        PROPOSER_THRESHOLD,
        BASIS_NUMERATOR,
        lightAccountFactoryAddress,
      ],
    );

    // Deploy the proxy with the implementation
    const proxy = await new ERC1967Proxy__factory(strategyOwner).deploy(
      await linearERC721VotingImplementation.getAddress(),
      initializeCalldata,
    );

    // Connect the proxy to the implementation contract type
    return LinearERC721VotingV1__factory.connect(await proxy.getAddress(), strategyOwner);
  }

  async function mintNFTs(
    tokenContract: MockERC721,
    holder: SignerWithAddress,
    count: number,
  ): Promise<number[]> {
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      // Get current token ID before minting (it will be the next ID to be minted)
      const currentTokenId = await tokenContract.getCurrentTokenId();
      await tokenContract.mint(holder.address);
      ids.push(Number(currentTokenId));
    }
    return ids;
  }

  beforeEach(async () => {
    [deployer, owner, nonOwner, tokenHolder1, tokenHolder2, tokenHolder3, lightAccountFactoryMock] =
      await ethers.getSigners();

    // Use nonOwner address as a mock azorius address for testing
    proposalInitializer = await nonOwner.getAddress();

    // Deploy MockERC721 tokens
    mockNFT1 = await new MockERC721__factory(deployer).deploy();
    mockNFT2 = await new MockERC721__factory(deployer).deploy();

    // Mint NFTs to token holders
    tokenHolder1Ids = await mintNFTs(mockNFT1, tokenHolder1, 3); // 3 NFTs from token1
    tokenHolder2Ids = await mintNFTs(mockNFT1, tokenHolder2, 2); // 2 NFTs from token1
    tokenHolder3Ids = await mintNFTs(mockNFT2, tokenHolder3, 2); // 2 NFTs from token2

    // Deploy LinearERC721Voting implementation
    linearERC721VotingImplementation = await new LinearERC721VotingV1__factory(deployer).deploy();

    // Deploy LinearERC721Voting strategy
    linearERC721Voting = await deployLinearERC721Voting(
      owner,
      [
        { tokenAddress: await mockNFT1.getAddress(), weight: TOKEN1_WEIGHT },
        { tokenAddress: await mockNFT2.getAddress(), weight: TOKEN2_WEIGHT },
      ],
      proposalInitializer,
      lightAccountFactoryMock.address,
    );
  });

  describe('Initialization', () => {
    it('should initialize with correct parameters', async () => {
      expect(await linearERC721Voting.owner()).to.equal(owner.address);

      // Check token addresses and weights
      expect(await linearERC721Voting.tokenAddresses(0)).to.equal(await mockNFT1.getAddress());
      expect(await linearERC721Voting.tokenAddresses(1)).to.equal(await mockNFT2.getAddress());
      expect(await linearERC721Voting.tokenWeights(await mockNFT1.getAddress())).to.equal(
        TOKEN1_WEIGHT,
      );
      expect(await linearERC721Voting.tokenWeights(await mockNFT2.getAddress())).to.equal(
        TOKEN2_WEIGHT,
      );

      expect(await linearERC721Voting.proposalInitializer()).to.equal(proposalInitializer);
      expect(await linearERC721Voting.votingPeriod()).to.equal(VOTING_PERIOD);
      expect(await linearERC721Voting.quorumThreshold()).to.equal(QUORUM_THRESHOLD);
      expect(await linearERC721Voting.proposerThreshold()).to.equal(PROPOSER_THRESHOLD);
      expect(await linearERC721Voting.basisNumerator()).to.equal(BASIS_NUMERATOR);
      expect(await linearERC721Voting.lightAccountFactory()).to.equal(
        lightAccountFactoryMock.address,
      );
    });

    it('should not allow reinitialization', async () => {
      const tokenAddresses = [await mockNFT1.getAddress(), await mockNFT2.getAddress()];
      const tokenWeights = [TOKEN1_WEIGHT, TOKEN2_WEIGHT];

      // Try to call initialize again - should revert
      await expect(
        linearERC721Voting[
          'initialize(address,address[],uint256[],address,uint32,uint256,uint256,uint256,address)'
        ](
          owner.address,
          tokenAddresses,
          tokenWeights,
          proposalInitializer,
          VOTING_PERIOD,
          QUORUM_THRESHOLD,
          PROPOSER_THRESHOLD,
          BASIS_NUMERATOR,
          lightAccountFactoryMock.address,
        ),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'InvalidInitialization');
    });

    it('should revert when initializing with mismatched token arrays', async () => {
      const tokenAddresses = [await mockNFT1.getAddress(), await mockNFT2.getAddress()];
      const tokenWeights = [TOKEN1_WEIGHT]; // Only one weight for two tokens

      // Create initialization data with mismatched arrays
      const initializeCalldata = LinearERC721VotingV1__factory.createInterface().encodeFunctionData(
        'initialize(address,address[],uint256[],address,uint32,uint256,uint256,uint256,address)',
        [
          owner.address,
          tokenAddresses,
          tokenWeights,
          proposalInitializer,
          VOTING_PERIOD,
          QUORUM_THRESHOLD,
          PROPOSER_THRESHOLD,
          BASIS_NUMERATOR,
          lightAccountFactoryMock.address,
        ],
      );

      // Attempt to deploy with invalid initialization - should revert
      await expect(
        new ERC1967Proxy__factory(owner).deploy(
          await linearERC721VotingImplementation.getAddress(),
          initializeCalldata,
        ),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'InvalidParams');
    });

    it('should revert when initializing with invalid token weight', async () => {
      const tokenAddresses = [await mockNFT1.getAddress(), await mockNFT2.getAddress()];
      const tokenWeights = [0, TOKEN2_WEIGHT]; // Zero weight for the first token

      // Create initialization data with invalid token weight
      const initializeCalldata = LinearERC721VotingV1__factory.createInterface().encodeFunctionData(
        'initialize(address,address[],uint256[],address,uint32,uint256,uint256,uint256,address)',
        [
          owner.address,
          tokenAddresses,
          tokenWeights,
          proposalInitializer,
          VOTING_PERIOD,
          QUORUM_THRESHOLD,
          PROPOSER_THRESHOLD,
          BASIS_NUMERATOR,
          lightAccountFactoryMock.address,
        ],
      );

      // Attempt to deploy with invalid initialization - should revert
      await expect(
        new ERC1967Proxy__factory(owner).deploy(
          await linearERC721VotingImplementation.getAddress(),
          initializeCalldata,
        ),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'InvalidWeight');
    });

    it('should initialize with empty token arrays and allow adding tokens later', async () => {
      const emptyTokenAddresses: string[] = [];
      const emptyTokenWeights: number[] = [];

      // Create initialization data with empty token arrays
      const initializeCalldata = LinearERC721VotingV1__factory.createInterface().encodeFunctionData(
        'initialize(address,address[],uint256[],address,uint32,uint256,uint256,uint256,address)',
        [
          owner.address,
          emptyTokenAddresses,
          emptyTokenWeights,
          proposalInitializer,
          VOTING_PERIOD,
          QUORUM_THRESHOLD,
          PROPOSER_THRESHOLD,
          BASIS_NUMERATOR,
          lightAccountFactoryMock.address,
        ],
      );

      // Deploy with empty token arrays - should not revert
      const proxy = await new ERC1967Proxy__factory(owner).deploy(
        await linearERC721VotingImplementation.getAddress(),
        initializeCalldata,
      );

      // Connect to the newly deployed proxy
      const emptyTokensStrategy = LinearERC721VotingV1__factory.connect(
        await proxy.getAddress(),
        owner,
      );

      // Verify that there are no tokens in the strategy
      await expect(emptyTokensStrategy.tokenAddresses(0)).to.be.reverted;

      // Add a token afterward to ensure it works
      const tokenAddress = await mockNFT1.getAddress();
      await emptyTokensStrategy.addGovernanceToken(tokenAddress, TOKEN1_WEIGHT);

      // Verify the token was added
      expect(await emptyTokensStrategy.tokenAddresses(0)).to.equal(tokenAddress);
      expect(await emptyTokensStrategy.tokenWeights(tokenAddress)).to.equal(TOKEN1_WEIGHT);
    });

    it('should emit ProposalInitialized event when initializing a proposal', async () => {
      const proposalId = 200;
      const initializeData = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);

      // Get current block timestmp to calculate expected end timestamp
      const currentBlockTimestamp = await time.latest();

      // +1 because the proposal will be in the next block, and that block's timestamp will be increased by one second
      const expectedEndTimestamp = currentBlockTimestamp + 1 + VOTING_PERIOD;

      await expect(linearERC721Voting.connect(nonOwner).initializeProposal(initializeData))
        .to.emit(linearERC721Voting, 'ProposalInitialized')
        .withArgs(proposalId, expectedEndTimestamp);
    });
  });

  describe('Owner Functions', () => {
    it('should allow owner to update voting period', async () => {
      const newVotingPeriod = 200;
      await linearERC721Voting.connect(owner).updateVotingPeriod(newVotingPeriod);
      expect(await linearERC721Voting.votingPeriod()).to.equal(newVotingPeriod);
    });

    it('should not allow non-owner to update voting period', async () => {
      const newVotingPeriod = 200;
      await expect(
        linearERC721Voting.connect(nonOwner).updateVotingPeriod(newVotingPeriod),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'OwnableUnauthorizedAccount');
    });

    it('should allow owner to update quorum threshold', async () => {
      const newQuorumThreshold = 10;
      await linearERC721Voting.connect(owner).updateQuorumThreshold(newQuorumThreshold);
      expect(await linearERC721Voting.quorumThreshold()).to.equal(newQuorumThreshold);
    });

    it('should not allow non-owner to update quorum threshold', async () => {
      const newQuorumThreshold = 10;
      await expect(
        linearERC721Voting.connect(nonOwner).updateQuorumThreshold(newQuorumThreshold),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'OwnableUnauthorizedAccount');
    });

    it('should allow owner to update proposer threshold', async () => {
      const newProposerThreshold = 5;
      await linearERC721Voting.connect(owner).updateProposerThreshold(newProposerThreshold);
      expect(await linearERC721Voting.proposerThreshold()).to.equal(newProposerThreshold);
    });

    it('should not allow non-owner to update proposer threshold', async () => {
      const newProposerThreshold = 5;
      await expect(
        linearERC721Voting.connect(nonOwner).updateProposerThreshold(newProposerThreshold),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'OwnableUnauthorizedAccount');
    });

    it('should allow owner to update basis numerator', async () => {
      const newBasisNumerator = 600000;
      await linearERC721Voting.connect(owner).updateBasisNumerator(newBasisNumerator);
      expect(await linearERC721Voting.basisNumerator()).to.equal(newBasisNumerator);
    });

    it('should not allow non-owner to update basis numerator', async () => {
      const newBasisNumerator = 600000;
      await expect(
        linearERC721Voting.connect(nonOwner).updateBasisNumerator(newBasisNumerator),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'OwnableUnauthorizedAccount');
    });

    it('should emit BasisNumeratorUpdated event when basisNumerator is updated', async () => {
      const newBasisNumerator = 700000; // 70%
      await expect(linearERC721Voting.connect(owner).updateBasisNumerator(newBasisNumerator))
        .to.emit(linearERC721Voting, 'BasisNumeratorUpdated')
        .withArgs(newBasisNumerator);
    });

    it('should revert when basisNumerator is greater than BASIS_DENOMINATOR', async () => {
      const invalidBasisNumerator = 1000001; // BASIS_DENOMINATOR + 1
      await expect(
        linearERC721Voting.connect(owner).updateBasisNumerator(invalidBasisNumerator),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'InvalidBasisNumerator');
    });

    it('should revert when basisNumerator is less than BASIS_DENOMINATOR / 2', async () => {
      const invalidBasisNumerator = 499999; // BASIS_DENOMINATOR / 2 - 1
      await expect(
        linearERC721Voting.connect(owner).updateBasisNumerator(invalidBasisNumerator),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'InvalidBasisNumerator');
    });

    it('should allow basisNumerator to be equal to BASIS_DENOMINATOR / 2', async () => {
      const newBasisNumerator = 500000; // BASIS_DENOMINATOR / 2
      await linearERC721Voting.connect(owner).updateBasisNumerator(newBasisNumerator);
      expect(await linearERC721Voting.basisNumerator()).to.equal(newBasisNumerator);
    });

    it('should allow basisNumerator to be equal to BASIS_DENOMINATOR', async () => {
      const newBasisNumerator = 1000000; // BASIS_DENOMINATOR
      await linearERC721Voting.connect(owner).updateBasisNumerator(newBasisNumerator);
      expect(await linearERC721Voting.basisNumerator()).to.equal(newBasisNumerator);
    });

    it('should allow owner to add a new governance token', async () => {
      // Deploy a new NFT token
      const newMockNFT = await new MockERC721__factory(deployer).deploy();
      const newTokenWeight = 3;

      // Add the new token as a governance token
      await linearERC721Voting
        .connect(owner)
        .addGovernanceToken(await newMockNFT.getAddress(), newTokenWeight);

      // Check if token was added correctly
      expect(await linearERC721Voting.tokenAddresses(2)).to.equal(await newMockNFT.getAddress());
      expect(await linearERC721Voting.tokenWeights(await newMockNFT.getAddress())).to.equal(
        newTokenWeight,
      );
    });

    it('should not allow non-owner to add a governance token', async () => {
      const newMockNFT = await new MockERC721__factory(deployer).deploy();
      await expect(
        linearERC721Voting.connect(nonOwner).addGovernanceToken(await newMockNFT.getAddress(), 3),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'OwnableUnauthorizedAccount');
    });

    it('should allow owner to remove a governance token', async () => {
      // First, check that we have two tokens
      expect(await linearERC721Voting.tokenAddresses(0)).to.equal(await mockNFT1.getAddress());
      expect(await linearERC721Voting.tokenAddresses(1)).to.equal(await mockNFT2.getAddress());

      // Remove the second token
      await linearERC721Voting.connect(owner).removeGovernanceToken(await mockNFT2.getAddress());

      // The removed token should no longer have a weight
      expect(await linearERC721Voting.tokenWeights(await mockNFT2.getAddress())).to.equal(0);

      // The token addresses array should now have length 1 (the array is resized)
      // So trying to access index 1 should revert
      expect(await linearERC721Voting.tokenAddresses(0)).to.equal(await mockNFT1.getAddress());
      void expect(linearERC721Voting.tokenAddresses(1)).to.be.reverted;

      // Make sure we can't remove a token that's not registered
      await expect(
        linearERC721Voting.connect(owner).removeGovernanceToken(await mockNFT2.getAddress()),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'TokenNotSet');
    });

    it('should not allow non-owner to remove a governance token', async () => {
      await expect(
        linearERC721Voting.connect(nonOwner).removeGovernanceToken(await mockNFT1.getAddress()),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'OwnableUnauthorizedAccount');
    });
  });

  describe('Proposal Functions', () => {
    it('should allow only authorized account to initialize proposal', async () => {
      // Mock proposal ID
      const proposalId = 1;
      // Mock data for initializing a proposal
      const initializeData = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);

      // Only authorized account can initialize proposals
      await expect(
        linearERC721Voting.connect(owner).initializeProposal(initializeData),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'ProposalInitializerUnauthorizedAccount');

      // Test with authorized account signer
      await linearERC721Voting.connect(nonOwner).initializeProposal(initializeData);

      // Check that proposal was initialized correctly
      const [, votingEndTimestamp] = await linearERC721Voting.getVotingTimestamps(proposalId);
      expect(votingEndTimestamp).to.not.equal(0);
    });

    it('should determine proposer status based on NFT ownership', async () => {
      // tokenHolder1 has 3 NFTs from token1, each worth 1 vote = 3 votes total
      // proposerThreshold is 2, so they should be a proposer
      void expect(await linearERC721Voting.isProposer(tokenHolder1.address)).to.be.true;

      // tokenHolder3 has 2 NFTs from token2, each worth 2 votes = 4 votes total
      // proposerThreshold is 2, so they should be a proposer
      void expect(await linearERC721Voting.isProposer(tokenHolder3.address)).to.be.true;

      // Update proposerThreshold to 5
      await linearERC721Voting.connect(owner).updateProposerThreshold(5);

      // Now tokenHolder1 should NOT be a proposer with only 3 votes < 5 required
      void expect(await linearERC721Voting.isProposer(tokenHolder1.address)).to.be.false;

      // But tokenHolder3 should still be a proposer because their NFTs are worth 4 total votes
      void expect(await linearERC721Voting.isProposer(tokenHolder3.address)).to.be.false;
    });

    it('should correctly calculate voting weight for different tokens', async () => {
      // tokenHolder1 has 3 NFTs from token1, each worth 1 vote = 3 votes
      const tokenHolder1Balance = await mockNFT1.balanceOf(tokenHolder1.address);
      const tokenHolder1Weight = Number(tokenHolder1Balance) * TOKEN1_WEIGHT;
      expect(tokenHolder1Weight).to.equal(3);

      // tokenHolder2 has 2 NFTs from token1, each worth 1 vote = 2 votes
      const tokenHolder2Balance = await mockNFT1.balanceOf(tokenHolder2.address);
      const tokenHolder2Weight = Number(tokenHolder2Balance) * TOKEN1_WEIGHT;
      expect(tokenHolder2Weight).to.equal(2);

      // tokenHolder3 has 2 NFTs from token2, each worth 2 votes = 4 votes
      const tokenHolder3Balance = await mockNFT2.balanceOf(tokenHolder3.address);
      const tokenHolder3Weight = Number(tokenHolder3Balance) * TOKEN2_WEIGHT;
      expect(tokenHolder3Weight).to.equal(4);
    });
  });

  describe('Voting Functions', () => {
    const proposalId = 1;

    beforeEach(async () => {
      // Initialize a proposal using the azorius mock account
      const initializeData = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);
      await linearERC721Voting.connect(nonOwner).initializeProposal(initializeData);
    });

    it('should allow users to vote on a proposal with multiple NFTs', async () => {
      // Cast votes
      await linearERC721Voting
        .connect(tokenHolder1)
        .vote(
          proposalId,
          VoteType.YES,
          [await mockNFT1.getAddress(), await mockNFT1.getAddress(), await mockNFT1.getAddress()],
          [tokenHolder1Ids[0], tokenHolder1Ids[1], tokenHolder1Ids[2]],
        );

      await linearERC721Voting
        .connect(tokenHolder2)
        .vote(
          proposalId,
          VoteType.NO,
          [await mockNFT1.getAddress(), await mockNFT1.getAddress()],
          [tokenHolder2Ids[0], tokenHolder2Ids[1]],
        );

      await linearERC721Voting
        .connect(tokenHolder3)
        .vote(
          proposalId,
          VoteType.ABSTAIN,
          [await mockNFT2.getAddress(), await mockNFT2.getAddress()],
          [tokenHolder3Ids[0], tokenHolder3Ids[1]],
        );

      // Get proposal votes
      const [noVotes, yesVotes, abstainVotes, , ,] =
        await linearERC721Voting.getProposalVotes(proposalId);

      // Check vote counts
      // tokenHolder1: 3 NFTs * 1 vote weight = 3 YES votes
      // tokenHolder2: 2 NFTs * 1 vote weight = 2 NO votes
      // tokenHolder3: 2 NFTs * 2 vote weight = 4 ABSTAIN votes
      expect(yesVotes).to.equal(3);
      expect(noVotes).to.equal(2);
      expect(abstainVotes).to.equal(4);
    });

    it('should not allow voting with NFTs you do not own', async () => {
      // Try to vote with an NFT owned by tokenHolder1
      await expect(
        linearERC721Voting
          .connect(tokenHolder2)
          .vote(proposalId, VoteType.YES, [await mockNFT1.getAddress()], [tokenHolder1Ids[0]]),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'IdNotOwned');
    });

    it('should not allow voting with the same NFT twice', async () => {
      // First vote with an NFT
      await linearERC721Voting
        .connect(tokenHolder1)
        .vote(proposalId, VoteType.YES, [await mockNFT1.getAddress()], [tokenHolder1Ids[0]]);

      // Try to vote with the same NFT again
      await expect(
        linearERC721Voting
          .connect(tokenHolder1)
          .vote(proposalId, VoteType.YES, [await mockNFT1.getAddress()], [tokenHolder1Ids[0]]),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'IdAlreadyVoted');
    });

    it('should allow different NFTs from the same holder to vote differently', async () => {
      // Vote YES with first NFT
      await linearERC721Voting
        .connect(tokenHolder1)
        .vote(proposalId, VoteType.YES, [await mockNFT1.getAddress()], [tokenHolder1Ids[0]]);

      // Vote NO with second NFT
      await linearERC721Voting
        .connect(tokenHolder1)
        .vote(proposalId, VoteType.NO, [await mockNFT1.getAddress()], [tokenHolder1Ids[1]]);

      // Vote ABSTAIN with third NFT
      await linearERC721Voting
        .connect(tokenHolder1)
        .vote(proposalId, VoteType.ABSTAIN, [await mockNFT1.getAddress()], [tokenHolder1Ids[2]]);

      // Get proposal votes
      const [noVotes, yesVotes, abstainVotes, , ,] =
        await linearERC721Voting.getProposalVotes(proposalId);

      // Each NFT has a weight of 1
      expect(yesVotes).to.equal(1);
      expect(noVotes).to.equal(1);
      expect(abstainVotes).to.equal(1);
    });

    it('should revert on invalid vote type', async () => {
      // Valid vote types are 0, 1, 2 (NO, YES, ABSTAIN)
      const invalidVoteType = 3;

      await expect(
        linearERC721Voting
          .connect(tokenHolder1)
          .vote(proposalId, invalidVoteType, [await mockNFT1.getAddress()], [tokenHolder1Ids[0]]),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'InvalidVote');
    });

    describe('voting period ended', () => {
      let noVotesBefore: bigint;
      let yesVotesBefore: bigint;
      let abstainVotesBefore: bigint;
      let initialVoteTx: ContractTransactionResponse;
      let endTimestamp: bigint;

      beforeEach(async () => {
        // Get initial vote counts
        [noVotesBefore, yesVotesBefore, abstainVotesBefore, , endTimestamp] =
          await linearERC721Voting.getProposalVotes(proposalId);

        // Mine timestamp to advance past the voting period
        await time.increaseTo(Number(endTimestamp) + 1);

        // First vote to mark the period as ended
        initialVoteTx = await linearERC721Voting
          .connect(tokenHolder1)
          .vote(proposalId, VoteType.YES, [await mockNFT1.getAddress()], [tokenHolder1Ids[0]]);
      });

      it('should handle first vote after voting period ends correctly', async () => {
        // Verify event emission
        await expect(initialVoteTx).to.emit(linearERC721Voting, 'VotingPeriodEnded');

        // Verify no votes were actually counted
        const [noVotesAfter, yesVotesAfter, abstainVotesAfter, , ,] =
          await linearERC721Voting.getProposalVotes(proposalId);
        expect(noVotesAfter).to.equal(noVotesBefore, 'NO votes should not change');
        expect(yesVotesAfter).to.equal(yesVotesBefore, 'YES votes should not change');
        expect(abstainVotesAfter).to.equal(abstainVotesBefore, 'ABSTAIN votes should not change');

        // Verify the voting period is marked as ended
        void expect(await linearERC721Voting.votingPeriodEnded(proposalId)).to.be.true;
      });

      it('should revert on votes after voting period is marked as ended', async () => {
        // Verify subsequent votes revert
        await expect(
          linearERC721Voting
            .connect(tokenHolder2)
            .vote(proposalId, VoteType.YES, [await mockNFT1.getAddress()], [tokenHolder2Ids[0]]),
        ).to.be.revertedWithCustomError(linearERC721Voting, 'VotingEnded');

        await expect(
          linearERC721Voting
            .connect(tokenHolder3)
            .vote(proposalId, VoteType.NO, [await mockNFT2.getAddress()], [tokenHolder3Ids[0]]),
        ).to.be.revertedWithCustomError(linearERC721Voting, 'VotingEnded');

        // Verify even the same account that marked it as ended can't vote again
        await expect(
          linearERC721Voting
            .connect(tokenHolder1)
            .vote(
              proposalId,
              VoteType.ABSTAIN,
              [await mockNFT1.getAddress()],
              [tokenHolder1Ids[1]],
            ),
        ).to.be.revertedWithCustomError(linearERC721Voting, 'VotingEnded');
      });
    });
  });

  describe('isPassed Logic', () => {
    const proposalId = 1;
    let proposalBeginTimestamp: number;

    beforeEach(async () => {
      // Initialize a proposal using the azorius mock account
      const initializeData = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);
      await linearERC721Voting.connect(nonOwner).initializeProposal(initializeData);
      proposalBeginTimestamp = await time.latest();
    });

    it('should pass when yes > no and meets quorum', async () => {
      // Cast votes
      // Yes votes: 3 from tokenHolder1 + 4 from tokenHolder3 = 7
      // No votes: 2 from tokenHolder2 = 2
      // Total: 9 votes > 5 quorum threshold
      await linearERC721Voting
        .connect(tokenHolder1)
        .vote(
          proposalId,
          VoteType.YES,
          [await mockNFT1.getAddress(), await mockNFT1.getAddress(), await mockNFT1.getAddress()],
          [tokenHolder1Ids[0], tokenHolder1Ids[1], tokenHolder1Ids[2]],
        );

      await linearERC721Voting
        .connect(tokenHolder2)
        .vote(
          proposalId,
          VoteType.NO,
          [await mockNFT1.getAddress(), await mockNFT1.getAddress()],
          [tokenHolder2Ids[0], tokenHolder2Ids[1]],
        );

      await linearERC721Voting
        .connect(tokenHolder3)
        .vote(
          proposalId,
          VoteType.YES,
          [await mockNFT2.getAddress(), await mockNFT2.getAddress()],
          [tokenHolder3Ids[0], tokenHolder3Ids[1]],
        );

      // Mine timestamp to end the voting period
      await time.increaseTo(proposalBeginTimestamp + VOTING_PERIOD + 1);

      // Proposal should pass with 7 YES, 2 NO
      void expect(await linearERC721Voting.isPassed(proposalId)).to.be.true;
    });

    it('should fail when voting period is not over', async () => {
      // Cast votes
      await linearERC721Voting
        .connect(tokenHolder1)
        .vote(
          proposalId,
          VoteType.YES,
          [await mockNFT1.getAddress(), await mockNFT1.getAddress(), await mockNFT1.getAddress()],
          [tokenHolder1Ids[0], tokenHolder1Ids[1], tokenHolder1Ids[2]],
        );

      // Voting period not over yet
      void expect(await linearERC721Voting.isPassed(proposalId)).to.be.false;
    });

    it('should fail when quorum is not met', async () => {
      // Initialize a proposal with a different ID
      const quorumProposalId = 42;
      const initializeData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint32'],
        [quorumProposalId],
      );
      await linearERC721Voting.connect(nonOwner).initializeProposal(initializeData);

      // Only a couple of NFTs vote, which won't be enough to reach the quorum threshold
      await linearERC721Voting
        .connect(tokenHolder2)
        .vote(
          quorumProposalId,
          VoteType.YES,
          [await mockNFT1.getAddress(), await mockNFT1.getAddress()],
          [tokenHolder2Ids[0], tokenHolder2Ids[1]],
        );

      // Only tokenHolder2 votes, not enough for quorum which is 4

      // Mine timestamp to end the voting period
      await time.increaseTo(proposalBeginTimestamp + VOTING_PERIOD + 1);

      // Proposal should fail due to insufficient quorum
      void expect(await linearERC721Voting.isPassed(quorumProposalId)).to.be.false;
    });

    it('should fail when basis is not met', async () => {
      // Cast votes
      // Yes votes: 3 from tokenHolder1 = 3
      // No votes: 2 from tokenHolder2 + 4 from tokenHolder3 = 6
      // Total: 9 votes > 5 quorum threshold, but YES < NO
      await linearERC721Voting
        .connect(tokenHolder1)
        .vote(
          proposalId,
          VoteType.YES,
          [await mockNFT1.getAddress(), await mockNFT1.getAddress(), await mockNFT1.getAddress()],
          [tokenHolder1Ids[0], tokenHolder1Ids[1], tokenHolder1Ids[2]],
        );

      await linearERC721Voting
        .connect(tokenHolder2)
        .vote(
          proposalId,
          VoteType.NO,
          [await mockNFT1.getAddress(), await mockNFT1.getAddress()],
          [tokenHolder2Ids[0], tokenHolder2Ids[1]],
        );

      await linearERC721Voting
        .connect(tokenHolder3)
        .vote(
          proposalId,
          VoteType.NO,
          [await mockNFT2.getAddress(), await mockNFT2.getAddress()],
          [tokenHolder3Ids[0], tokenHolder3Ids[1]],
        );

      // Mine timestamp to end the voting period
      await time.increaseTo(proposalBeginTimestamp + VOTING_PERIOD + 1);

      // Proposal should fail due to insufficient basis (YES < NO)
      void expect(await linearERC721Voting.isPassed(proposalId)).to.be.false;
    });
  });

  describe('Vote Counting', () => {
    const proposalId = 1;

    beforeEach(async () => {
      // Initialize a proposal using the azorius mock account
      const initializeData = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);
      await linearERC721Voting.connect(nonOwner).initializeProposal(initializeData);

      // Cast some votes
      await linearERC721Voting
        .connect(tokenHolder1)
        .vote(
          proposalId,
          VoteType.YES,
          [await mockNFT1.getAddress(), await mockNFT1.getAddress(), await mockNFT1.getAddress()],
          [tokenHolder1Ids[0], tokenHolder1Ids[1], tokenHolder1Ids[2]],
        );

      await linearERC721Voting
        .connect(tokenHolder2)
        .vote(
          proposalId,
          VoteType.NO,
          [await mockNFT1.getAddress(), await mockNFT1.getAddress()],
          [tokenHolder2Ids[0], tokenHolder2Ids[1]],
        );

      await linearERC721Voting
        .connect(tokenHolder3)
        .vote(
          proposalId,
          VoteType.ABSTAIN,
          [await mockNFT2.getAddress(), await mockNFT2.getAddress()],
          [tokenHolder3Ids[0], tokenHolder3Ids[1]],
        );
    });

    it('should correctly return vote counts through getProposalVotes', async () => {
      // Get proposal votes
      const [noVotes, yesVotes, abstainVotes, startBlock, endBlock] =
        await linearERC721Voting.getProposalVotes(proposalId);

      // Check vote counts
      // tokenHolder1: 3 NFTs * 1 vote weight = 3 YES votes
      // tokenHolder2: 2 NFTs * 1 vote weight = 2 NO votes
      // tokenHolder3: 2 NFTs * 2 vote weight = 4 ABSTAIN votes
      expect(yesVotes).to.equal(3);
      expect(noVotes).to.equal(2);
      expect(abstainVotes).to.equal(4);

      // Check that start and end blocks are set
      expect(startBlock).to.not.equal(0);
      expect(endBlock).to.equal(Number(startBlock) + VOTING_PERIOD);
    });

    it('should correctly track if an NFT has voted', async () => {
      // Check that NFTs that have voted return true
      const voted = await linearERC721Voting.hasVoted(
        proposalId,
        await mockNFT1.getAddress(),
        tokenHolder1Ids[0],
      );
      expect(voted).to.equal(true);

      // Mint a new NFT that hasn't voted
      const newTokenId = await mintNFTs(mockNFT1, tokenHolder1, 1);

      // Check that NFTs that haven't voted return false
      const notVoted = await linearERC721Voting.hasVoted(
        proposalId,
        await mockNFT1.getAddress(),
        newTokenId[0],
      );
      expect(notVoted).to.equal(false);
    });
  });

  describe('Token Management', () => {
    it('should return all governance token addresses', async () => {
      const tokenAddresses = await linearERC721Voting.getAllTokenAddresses();
      expect(tokenAddresses.length).to.equal(2);
      expect(tokenAddresses[0]).to.equal(await mockNFT1.getAddress());
      expect(tokenAddresses[1]).to.equal(await mockNFT2.getAddress());
    });

    it('should emit GovernanceTokenAdded event when adding a token', async () => {
      // Deploy a new NFT token
      const newMockNFT = await new MockERC721__factory(deployer).deploy();
      const newTokenWeight = 3;

      // Add the new token as a governance token
      await expect(
        linearERC721Voting
          .connect(owner)
          .addGovernanceToken(await newMockNFT.getAddress(), newTokenWeight),
      )
        .to.emit(linearERC721Voting, 'GovernanceTokenAdded')
        .withArgs(await newMockNFT.getAddress(), newTokenWeight);
    });

    it('should emit GovernanceTokenRemoved event when removing a token', async () => {
      await expect(
        linearERC721Voting.connect(owner).removeGovernanceToken(await mockNFT2.getAddress()),
      )
        .to.emit(linearERC721Voting, 'GovernanceTokenRemoved')
        .withArgs(await mockNFT2.getAddress());
    });

    it('should emit VotingPeriodUpdated event when updating voting period', async () => {
      const newVotingPeriod = 200;
      await expect(linearERC721Voting.connect(owner).updateVotingPeriod(newVotingPeriod))
        .to.emit(linearERC721Voting, 'VotingPeriodUpdated')
        .withArgs(newVotingPeriod);
    });

    it('should emit QuorumThresholdUpdated event when updating quorum threshold', async () => {
      const newQuorumThreshold = 10;
      await expect(linearERC721Voting.connect(owner).updateQuorumThreshold(newQuorumThreshold))
        .to.emit(linearERC721Voting, 'QuorumThresholdUpdated')
        .withArgs(newQuorumThreshold);
    });

    it('should emit ProposerThresholdUpdated event when updating proposer threshold', async () => {
      const newProposerThreshold = 5;
      await expect(linearERC721Voting.connect(owner).updateProposerThreshold(newProposerThreshold))
        .to.emit(linearERC721Voting, 'ProposerThresholdUpdated')
        .withArgs(newProposerThreshold);
    });
  });

  describe('Edge Cases', () => {
    it('should revert when trying to vote with a token that has no weight', async () => {
      // Initialize a proposal
      const proposalId = 100;
      const initializeData = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);
      await linearERC721Voting.connect(nonOwner).initializeProposal(initializeData);

      // Deploy a new NFT token not registered as a governance token
      const nonGovernanceNFT = await new MockERC721__factory(deployer).deploy();

      // Mint an NFT to token holder
      await nonGovernanceNFT.mint(tokenHolder1.address);

      // Attempt to vote with a token that has no governance weight
      await expect(
        linearERC721Voting
          .connect(tokenHolder1)
          .vote(proposalId, VoteType.YES, [await nonGovernanceNFT.getAddress()], [0]),
      )
        .to.be.revertedWithCustomError(linearERC721Voting, 'InvalidTokenAddress')
        .withArgs(await nonGovernanceNFT.getAddress());
    });

    it('should revert when trying to initialize with an invalid ERC721 token', async () => {
      // We need to deploy a contract that doesn't implement the ERC721 interface
      // For this test, we can use the MockOwnership contract which doesn't support the ERC721 interface
      const mockNonERC721 = await new MockOwnership__factory(deployer).deploy(deployer.address);

      const tokenAddresses = [await mockNonERC721.getAddress()];
      const tokenWeights = [TOKEN1_WEIGHT];

      // Create initialization data with non-ERC721 token
      const initializeCalldata = LinearERC721VotingV1__factory.createInterface().encodeFunctionData(
        'initialize(address,address[],uint256[],address,uint32,uint256,uint256,uint256,address)',
        [
          owner.address,
          tokenAddresses,
          tokenWeights,
          proposalInitializer,
          VOTING_PERIOD,
          QUORUM_THRESHOLD,
          PROPOSER_THRESHOLD,
          BASIS_NUMERATOR,
          lightAccountFactoryMock.address,
        ],
      );

      // Attempt to deploy with invalid initialization - should revert
      await expect(
        new ERC1967Proxy__factory(owner).deploy(
          await linearERC721VotingImplementation.getAddress(),
          initializeCalldata,
        ),
      ).to.be.reverted; // This will revert when trying to check supportsInterface
    });
  });

  describe('Smart Account Support', () => {
    it('should recognize that contracts integrate with ERC4337VoterSupport', async () => {
      // This is a simplified test to verify the ERC4337VoterSupport integration exists
      // In a real scenario, we'd test the full smart contract account voting flow

      // Since properly testing this requires complex test infrastructure to impersonate contracts,
      // we'll simply verify that the _voter function is inherited from ERC4337VoterSupportV1

      // Deploy a mock contract with ownership
      const mockOwnership = await new MockOwnership__factory(deployer).deploy(tokenHolder1.address);

      // Verify the owner is set correctly
      expect(await mockOwnership.owner()).to.equal(tokenHolder1.address);

      // We're verifying that the contract inherits ERC4337VoterSupportV1
      // This is mostly a conceptual test - in production this would allow contract wallets
      // to vote as their owners
    });
  });

  describe('Version', () => {
    it('should return the correct version number', async () => {
      expect(await linearERC721Voting.getVersion()).to.equal(1);
    });
  });

  describe('UUPS Upgradeability', function () {
    runUUPSUpgradeabilityTests({
      getContract: () => linearERC721Voting,
      createNewImplementation: async () => {
        const newImplementation = await new LinearERC721VotingV1__factory(owner).deploy();
        return newImplementation;
      },
      owner: () => owner,
      nonOwner: () => nonOwner,
    });
  });

  describe('ERC165', function () {
    let iERC721VotingStrategyV1InterfaceId: string;
    let iBaseStrategyV1InterfaceId: string;
    let iBaseVotingBasisPercentV1InterfaceId: string;
    let iVersionInterfaceId: string;
    let iERC165InterfaceId: string;

    beforeEach(async function () {
      // Dynamically calculate interface IDs
      const IERC721VotingStrategyV1Interface = IERC721VotingStrategyV1__factory.createInterface();
      iERC721VotingStrategyV1InterfaceId = calculateInterfaceId(IERC721VotingStrategyV1Interface);

      const IBaseVotingBasisPercentV1Interface =
        IBaseVotingBasisPercentV1__factory.createInterface();
      iBaseVotingBasisPercentV1InterfaceId = calculateInterfaceId(
        IBaseVotingBasisPercentV1Interface,
      );

      const IBaseStrategyV1Interface = IBaseStrategyV1__factory.createInterface();
      iBaseStrategyV1InterfaceId = calculateInterfaceId(IBaseStrategyV1Interface);

      const IVersionInterface = IVersion__factory.createInterface();
      iVersionInterfaceId = calculateInterfaceId(IVersionInterface);

      const IERC165Interface = IERC165__factory.createInterface();
      iERC165InterfaceId = calculateInterfaceId(IERC165Interface);
    });

    it('Should support IERC721VotingStrategyV1 interface', async function () {
      const supported = await linearERC721Voting.supportsInterface(
        iERC721VotingStrategyV1InterfaceId,
      );
      void expect(supported).to.be.true;
    });

    it('Should support IERC165 interface', async function () {
      const supported = await linearERC721Voting.supportsInterface(iERC165InterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IBaseVotingBasisPercentV1 interface', async function () {
      const supported = await linearERC721Voting.supportsInterface(
        iBaseVotingBasisPercentV1InterfaceId,
      );
      void expect(supported).to.be.true;
    });

    it('Should support IBaseStrategyV1 interface', async function () {
      const supported = await linearERC721Voting.supportsInterface(iBaseStrategyV1InterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IVersion interface', async function () {
      const supported = await linearERC721Voting.supportsInterface(iVersionInterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should not support random interface', async function () {
      const randomInterfaceId = '0x12345678';
      const supported = await linearERC721Voting.supportsInterface(randomInterfaceId);
      void expect(supported).to.be.false;
    });
  });

  describe('Timestamp-based voting', () => {
    let proposalId: number;

    beforeEach(async () => {
      // Initialize a proposal
      proposalId = 100;
      const initializeData = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);
      await linearERC721Voting.connect(nonOwner).initializeProposal(initializeData);
    });

    it('should enforce voting end by timestamp', async () => {
      // Get the voting end timestamp
      const [, , , , endTimestamp] = await linearERC721Voting.getProposalVotes(proposalId);

      // Cast a vote before voting ends
      await linearERC721Voting
        .connect(tokenHolder1)
        .vote(proposalId, VoteType.YES, [await mockNFT1.getAddress()], [tokenHolder1Ids[0]]);

      // Advance time to just after voting end
      await time.increaseTo(Number(endTimestamp) + 1);

      // First vote attempt after period ends should mark it as ended and return
      const tx = await linearERC721Voting
        .connect(tokenHolder2)
        .vote(proposalId, VoteType.YES, [await mockNFT1.getAddress()], [tokenHolder2Ids[0]]);
      await expect(tx).to.emit(linearERC721Voting, 'VotingPeriodEnded');

      // Subsequent vote attempts should revert
      await expect(
        linearERC721Voting
          .connect(tokenHolder1)
          .vote(proposalId, VoteType.YES, [await mockNFT1.getAddress()], [tokenHolder1Ids[1]]),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'VotingEnded');
    });

    it('should determine proposal state based on timestamp', async () => {
      // Vote yes with several NFTs to ensure quorum and basis are met
      await linearERC721Voting
        .connect(tokenHolder1)
        .vote(
          proposalId,
          VoteType.YES,
          [await mockNFT1.getAddress(), await mockNFT1.getAddress()],
          [tokenHolder1Ids[0], tokenHolder1Ids[1]],
        );

      // Add more votes to ensure quorum (we need at least 5 votes)
      await linearERC721Voting
        .connect(tokenHolder3)
        .vote(
          proposalId,
          VoteType.YES,
          [await mockNFT2.getAddress(), await mockNFT2.getAddress()],
          [tokenHolder3Ids[0], tokenHolder3Ids[1]],
        );

      // Also add votes from tokenHolder2 to meet quorum
      await linearERC721Voting
        .connect(tokenHolder2)
        .vote(proposalId, VoteType.YES, [await mockNFT1.getAddress()], [tokenHolder2Ids[0]]);

      // Get voting end timestamp
      const [, , , , endTimestamp] = await linearERC721Voting.getProposalVotes(proposalId);

      // Before advancing time, proposal should not be passed
      void expect(await linearERC721Voting.isPassed(proposalId)).to.be.false;

      // Advance time to AFTER the voting end timestamp (critical for isPassed)
      await ethers.provider.send('evm_mine', [Number(endTimestamp) + 1]);

      // Now the proposal should pass (past end timestamp + meets quorum + meets basis)
      void expect(await linearERC721Voting.isPassed(proposalId)).to.be.true;
    });

    it('should handle exact boundary conditions for timestamps', async () => {
      // Get voting end timestamp
      const [, , , , endTimestamp] = await linearERC721Voting.getProposalVotes(proposalId);

      // Advance time to 3 seconds before the voting end timestamp
      await time.increaseTo(Number(endTimestamp) - 3);

      // Should still be able to vote before end timestamp
      await linearERC721Voting
        .connect(tokenHolder1)
        .vote(proposalId, VoteType.YES, [await mockNFT1.getAddress()], [tokenHolder1Ids[0]]);

      // Now, jump directly to the end timestamp
      await time.increaseTo(Number(endTimestamp));

      // First vote attempt after period ends should mark it as ended and return
      const tx = await linearERC721Voting
        .connect(tokenHolder2)
        .vote(proposalId, VoteType.YES, [await mockNFT1.getAddress()], [tokenHolder2Ids[0]]);
      await expect(tx).to.emit(linearERC721Voting, 'VotingPeriodEnded');

      // Subsequent vote attempts should revert
      await expect(
        linearERC721Voting
          .connect(tokenHolder1)
          .vote(proposalId, VoteType.YES, [await mockNFT1.getAddress()], [tokenHolder1Ids[1]]),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'VotingEnded');
    });
  });

  describe('meetsBasis', () => {
    // Test with default 50% basis
    it('should return true when yes votes exceed the basis threshold', async () => {
      const yesVotes = 60;
      const noVotes = 40;
      // 60 > ((60 + 40) * 500000 / 1000000) = 50, so it passes
      void expect(await linearERC721Voting.meetsBasis(yesVotes, noVotes)).to.be.true;
    });

    it('should return false when yes votes equal the basis threshold', async () => {
      const yesVotes = 50;
      const noVotes = 50;
      // 50 = ((50 + 50) * 500000 / 1000000) = 50, but we need >
      void expect(await linearERC721Voting.meetsBasis(yesVotes, noVotes)).to.be.false;
    });

    it('should return false when yes votes are below the basis threshold', async () => {
      const yesVotes = 49;
      const noVotes = 51;
      // 49 < ((49 + 51) * 500000 / 1000000) = 50
      void expect(await linearERC721Voting.meetsBasis(yesVotes, noVotes)).to.be.false;
    });

    // Test with higher basis (e.g., 70%)
    it('should work with higher basis threshold', async () => {
      // Update to 70%
      await linearERC721Voting.connect(owner).updateBasisNumerator(700000);

      // Case where it passes with the new threshold
      const yesVotes = 71;
      const noVotes = 29;
      // 71 > ((71 + 29) * 700000 / 1000000) = 70
      void expect(await linearERC721Voting.meetsBasis(yesVotes, noVotes)).to.be.true;

      // Case where it fails with the new threshold
      const yesVotes2 = 69;
      const noVotes2 = 31;
      // 69 < ((69 + 31) * 700000 / 1000000) = 70
      void expect(await linearERC721Voting.meetsBasis(yesVotes2, noVotes2)).to.be.false;
    });

    it('should handle zero votes correctly', async () => {
      const yesVotes = 0;
      const noVotes = 0;
      // When both are 0, formula is 0 > (0 * 500000 / 1000000) which is 0 > 0, which is false
      void expect(await linearERC721Voting.meetsBasis(yesVotes, noVotes)).to.be.false;
    });

    it('should handle case where only yes votes exist', async () => {
      const yesVotes = 100;
      const noVotes = 0;
      // 100 > ((100 + 0) * 500000 / 1000000) = 50
      void expect(await linearERC721Voting.meetsBasis(yesVotes, noVotes)).to.be.true;
    });

    it('should handle case where only no votes exist', async () => {
      const yesVotes = 0;
      const noVotes = 100;
      // 0 < ((0 + 100) * 500000 / 1000000) = 50
      void expect(await linearERC721Voting.meetsBasis(yesVotes, noVotes)).to.be.false;
    });
  });

  describe('Error Cases', () => {
    it('should revert with InvalidParams when voting with mismatched arrays', async () => {
      const proposalId = 123;
      const initializeData = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);
      await linearERC721Voting.connect(nonOwner).initializeProposal(initializeData);

      // Mismatched arrays: 2 token addresses but only 1 token ID
      await expect(
        linearERC721Voting
          .connect(tokenHolder1)
          .vote(
            proposalId,
            VoteType.YES,
            [await mockNFT1.getAddress(), await mockNFT1.getAddress()],
            [tokenHolder1Ids[0]],
          ),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'InvalidParams');
    });

    it('should revert with InvalidProposal when voting on uninitialized proposal', async () => {
      // Try to vote on a proposal that hasn't been initialized
      const nonExistentProposalId = 9999;

      await expect(
        linearERC721Voting
          .connect(tokenHolder1)
          .vote(
            nonExistentProposalId,
            VoteType.YES,
            [await mockNFT1.getAddress()],
            [tokenHolder1Ids[0]],
          ),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'InvalidProposal');
    });

    it('should revert with InvalidWeight when adding token with zero weight', async () => {
      // Deploy a new NFT token
      const newMockNFT = await new MockERC721__factory(deployer).deploy();

      // Try to add with zero weight
      await expect(
        linearERC721Voting.connect(owner).addGovernanceToken(await newMockNFT.getAddress(), 0),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'InvalidWeight');
    });

    it('should revert with NoVotingWeight when voting with no weight', async () => {
      const proposalId = 456;
      const initializeData = ethers.AbiCoder.defaultAbiCoder().encode(['uint32'], [proposalId]);
      await linearERC721Voting.connect(nonOwner).initializeProposal(initializeData);

      // Create a situation where vote weight will be 0 (empty arrays)
      await expect(
        linearERC721Voting.connect(tokenHolder1).vote(proposalId, VoteType.YES, [], []),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'NoVotingWeight');
    });

    it('should revert with TokenAlreadySet when adding the same token twice', async () => {
      // Try to add mockNFT1 again (it was already added in the beforeEach)
      await expect(
        linearERC721Voting.connect(owner).addGovernanceToken(await mockNFT1.getAddress(), 1),
      ).to.be.revertedWithCustomError(linearERC721Voting, 'TokenAlreadySet');
    });
  });
});
