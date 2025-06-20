import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ConcreteFreezeVotingBaseV1,
  ConcreteFreezeVotingBaseV1__factory,
  ERC1967Proxy__factory,
} from '../../../typechain-types';

// Helper function for deploying ConcreteBaseFreezeVoting instances using ERC1967Proxy
async function deployConcreteBaseFreezeVotingProxy(
  proxyDeployer: SignerWithAddress,
  implementation: string,
  owner: SignerWithAddress,
  freezeVotesThreshold: number,
  freezeProposalPeriod: number,
  freezePeriod: number,
): Promise<ConcreteFreezeVotingBaseV1> {
  // Combine selector and encoded params
  const fullInitData = ConcreteFreezeVotingBaseV1__factory.createInterface().encodeFunctionData(
    'initialize',
    [owner.address, freezeVotesThreshold, freezeProposalPeriod, freezePeriod],
  );

  // Deploy the proxy with the implementation
  const proxy = await new ERC1967Proxy__factory(proxyDeployer).deploy(implementation, fullInitData);

  // Return a contract instance connected to the proxy
  return ConcreteFreezeVotingBaseV1__factory.connect(await proxy.getAddress(), owner);
}

describe('FreezeVotingBaseV1', () => {
  // signers
  let proxyDeployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let voter1: SignerWithAddress;
  let voter2: SignerWithAddress;
  let voter3: SignerWithAddress;

  // contracts
  let masterCopy: string;
  let freezeVoting: ConcreteFreezeVotingBaseV1;

  // constants
  const FREEZE_VOTES_THRESHOLD = 3;
  const FREEZE_PROPOSAL_PERIOD = 5;
  const FREEZE_PERIOD = 10;

  beforeEach(async () => {
    // Get signers
    [proxyDeployer, owner, voter1, voter2, voter3] = await ethers.getSigners();

    // Deploy implementation
    const implementation = await new ConcreteFreezeVotingBaseV1__factory(proxyDeployer).deploy();
    masterCopy = await implementation.getAddress();

    // Deploy proxy
    freezeVoting = await deployConcreteBaseFreezeVotingProxy(
      proxyDeployer,
      masterCopy,
      owner,
      FREEZE_VOTES_THRESHOLD,
      FREEZE_PROPOSAL_PERIOD,
      FREEZE_PERIOD,
    );
  });

  describe('Initialization', () => {
    it('should initialize with correct parameters', async () => {
      expect(await freezeVoting.owner()).to.equal(owner.address);
      expect(await freezeVoting.freezeVotesThreshold()).to.equal(FREEZE_VOTES_THRESHOLD);
      expect(await freezeVoting.freezeProposalPeriod()).to.equal(FREEZE_PROPOSAL_PERIOD);
      expect(await freezeVoting.freezePeriod()).to.equal(FREEZE_PERIOD);
    });

    it('should not allow reinitialization', async () => {
      await expect(
        freezeVoting.initialize(
          owner.address,
          FREEZE_VOTES_THRESHOLD,
          FREEZE_PROPOSAL_PERIOD,
          FREEZE_PERIOD,
        ),
      ).to.be.revertedWithCustomError(freezeVoting, 'InvalidInitialization');
    });

    it('Should have initialization disabled in the implementation', async function () {
      const implementationContract = ConcreteFreezeVotingBaseV1__factory.connect(
        masterCopy,
        proxyDeployer,
      ) as any;

      await expect(
        implementationContract.initialize(
          owner.address,
          FREEZE_VOTES_THRESHOLD,
          FREEZE_PROPOSAL_PERIOD,
          FREEZE_PERIOD,
        ),
      ).to.be.revertedWithCustomError(implementationContract, 'InvalidInitialization');
    });
  });

  describe('Freeze Voting Process', () => {
    it('should create a freeze proposal on first vote', async () => {
      // Initial state
      expect(await freezeVoting.freezeProposalCreated()).to.equal(0);
      expect(await freezeVoting.freezeProposalVoteCount()).to.equal(0);

      // First vote creates the proposal
      await expect(freezeVoting.connect(voter1).castFreezeVote())
        .to.emit(freezeVoting, 'FreezeVoteCast')
        .withArgs(voter1.address, 1);

      // Check state after first vote
      const currentTimestamp = await time.latest();
      expect(await freezeVoting.freezeProposalCreated()).to.equal(currentTimestamp);
      expect(await freezeVoting.freezeProposalVoteCount()).to.equal(1);
    });

    it('should accumulate votes correctly', async () => {
      // First vote
      await freezeVoting.connect(voter1).castFreezeVote();
      expect(await freezeVoting.freezeProposalVoteCount()).to.equal(1);

      // Second vote
      await freezeVoting.connect(voter2).castFreezeVote();
      expect(await freezeVoting.freezeProposalVoteCount()).to.equal(2);

      // Third vote
      await freezeVoting.connect(voter3).castFreezeVote();
      expect(await freezeVoting.freezeProposalVoteCount()).to.equal(3);
    });

    it('should reject votes after proposal period expiry', async () => {
      // First vote to create proposal
      await freezeVoting.connect(voter1).castFreezeVote();

      // Increase time to pass the freeze proposal period
      await time.increase(FREEZE_PROPOSAL_PERIOD + 1);

      // New vote should be rejected
      await expect(freezeVoting.connect(voter2).castFreezeVote()).to.be.revertedWith(
        'Freeze proposal period expired',
      );
    });
  });

  describe('Freeze State', () => {
    it('should not be frozen initially', async () => {
      expect(await freezeVoting.isFrozen()).to.be.false;
    });

    it('should not be frozen when below threshold', async () => {
      // With threshold of 3, cast only 2 votes
      await freezeVoting.connect(voter1).castFreezeVote();
      await freezeVoting.connect(voter2).castFreezeVote();

      // Should not be frozen yet
      expect(await freezeVoting.isFrozen()).to.be.false;
    });

    it('should be frozen once threshold is met', async () => {
      // Cast enough votes to meet threshold
      await freezeVoting.connect(voter1).castFreezeVote();
      await freezeVoting.connect(voter2).castFreezeVote();
      await freezeVoting.connect(voter3).castFreezeVote();

      // Should now be frozen
      expect(await freezeVoting.isFrozen()).to.be.true;
    });

    it('should automatically unfreeze after freeze period', async () => {
      // Cast enough votes to meet threshold
      await freezeVoting.connect(voter1).castFreezeVote();
      await freezeVoting.connect(voter2).castFreezeVote();
      await freezeVoting.connect(voter3).castFreezeVote();

      // Should be frozen initially
      expect(await freezeVoting.isFrozen()).to.be.true;

      // Increase time to pass the freeze period
      await time.increase(FREEZE_PERIOD + 1);

      // Should no longer be frozen
      expect(await freezeVoting.isFrozen()).to.be.false;
    });

    it('should allow owner to unfreeze manually', async () => {
      // Cast enough votes to meet threshold
      await freezeVoting.connect(voter1).castFreezeVote();
      await freezeVoting.connect(voter2).castFreezeVote();
      await freezeVoting.connect(voter3).castFreezeVote();

      // Should be frozen
      expect(await freezeVoting.isFrozen()).to.be.true;

      // Owner unfreezes manually
      await freezeVoting.connect(owner).unfreeze();

      // Should no longer be frozen
      expect(await freezeVoting.isFrozen()).to.be.false;

      // Check that state was reset
      expect(await freezeVoting.freezeProposalCreated()).to.equal(0);
      expect(await freezeVoting.freezeProposalVoteCount()).to.equal(0);
      expect(await freezeVoting.freezeActivated()).to.equal(0);
    });

    it('should not allow non-owner to unfreeze', async () => {
      // Cast enough votes to meet threshold
      await freezeVoting.connect(voter1).castFreezeVote();
      await freezeVoting.connect(voter2).castFreezeVote();
      await freezeVoting.connect(voter3).castFreezeVote();

      // Non-owner tries to unfreeze
      await expect(freezeVoting.connect(voter1).unfreeze()).to.be.revertedWithCustomError(
        freezeVoting,
        'OwnableUnauthorizedAccount',
      );

      // Should still be frozen
      expect(await freezeVoting.isFrozen()).to.be.true;
    });

    it('should track freeze status across multiple proposals', async () => {
      // First proposal: get enough votes to freeze
      await freezeVoting.connect(voter1).castFreezeVote();
      await freezeVoting.connect(voter2).castFreezeVote();
      await freezeVoting.connect(voter3).castFreezeVote();

      // DAO should be frozen
      expect(await freezeVoting.isFrozen()).to.be.true;

      // Owner unfreezes manually
      await freezeVoting.connect(owner).unfreeze();

      // DAO should not be frozen
      expect(await freezeVoting.isFrozen()).to.be.false;

      // Start a new proposal with not enough votes
      await freezeVoting.connect(voter1).castFreezeVote();
      await freezeVoting.connect(voter2).castFreezeVote();

      // DAO should not be frozen with only 2 votes
      expect(await freezeVoting.isFrozen()).to.be.false;

      // Add the third vote to reach threshold
      await freezeVoting.connect(voter3).castFreezeVote();

      // DAO should be frozen again
      expect(await freezeVoting.isFrozen()).to.be.true;
    });
  });

  describe('Freeze Activation', () => {
    it('should return 0 for freezeActivated initially', async () => {
      expect(await freezeVoting.freezeActivated()).to.equal(0);
    });

    it('should return 0 for freezeActivated before threshold is reached', async () => {
      // Cast votes below threshold
      await freezeVoting.connect(voter1).castFreezeVote();
      await freezeVoting.connect(voter2).castFreezeVote();

      // freezeActivated should still be 0
      expect(await freezeVoting.freezeActivated()).to.equal(0);
    });

    it('should set freezeActivated when threshold is reached', async () => {
      // Cast votes to reach threshold
      await freezeVoting.connect(voter1).castFreezeVote();
      await freezeVoting.connect(voter2).castFreezeVote();

      // Get timestamp before the final vote
      const beforeTimestamp = await time.latest();

      // Cast the threshold-reaching vote
      await freezeVoting.connect(voter3).castFreezeVote();

      // freezeActivated should be set to current timestamp
      const afterTimestamp = await time.latest();
      const freezeActivated = await freezeVoting.freezeActivated();

      expect(freezeActivated).to.be.gte(beforeTimestamp);
      expect(freezeActivated).to.be.lte(afterTimestamp);
    });

    it('should reset freezeActivated when manually unfrozen', async () => {
      // Cast enough votes to meet threshold
      await freezeVoting.connect(voter1).castFreezeVote();
      await freezeVoting.connect(voter2).castFreezeVote();
      await freezeVoting.connect(voter3).castFreezeVote();

      // Verify freeze is activated
      expect(await freezeVoting.freezeActivated()).to.not.equal(0);

      // Owner unfreezes manually
      await freezeVoting.connect(owner).unfreeze();

      // freezeActivated should be reset to 0
      expect(await freezeVoting.freezeActivated()).to.equal(0);
    });

    it('should use freezeActivated timestamp for freeze period calculation', async () => {
      // Cast enough votes to meet threshold
      await freezeVoting.connect(voter1).castFreezeVote();
      await freezeVoting.connect(voter2).castFreezeVote();
      await freezeVoting.connect(voter3).castFreezeVote();

      // Should be frozen immediately after threshold is reached
      expect(await freezeVoting.isFrozen()).to.be.true;

      // Get the freeze activation timestamp
      const freezeActivated = await freezeVoting.freezeActivated();

      // Advance time to just before freeze period expires
      await time.increaseTo(Number(freezeActivated) + FREEZE_PERIOD - 1);

      // Should still be frozen
      expect(await freezeVoting.isFrozen()).to.be.true;

      // Advance time to exactly when freeze period expires
      await time.increaseTo(Number(freezeActivated) + FREEZE_PERIOD);

      // Should no longer be frozen at the exact expiry time
      expect(await freezeVoting.isFrozen()).to.be.false;

      // Advance time past freeze period
      await time.increaseTo(Number(freezeActivated) + FREEZE_PERIOD + 1);

      // Should no longer be frozen
      expect(await freezeVoting.isFrozen()).to.be.false;
    });

    it('should handle multiple freeze activation cycles correctly', async () => {
      // First freeze cycle
      await freezeVoting.connect(voter1).castFreezeVote();
      await freezeVoting.connect(voter2).castFreezeVote();
      await freezeVoting.connect(voter3).castFreezeVote();

      const firstFreezeActivated = await freezeVoting.freezeActivated();
      expect(firstFreezeActivated).to.not.equal(0);

      // Manually unfreeze
      await freezeVoting.connect(owner).unfreeze();
      expect(await freezeVoting.freezeActivated()).to.equal(0);

      // Second freeze cycle
      await time.increase(1); // Ensure different timestamp
      await freezeVoting.connect(voter1).castFreezeVote();
      await freezeVoting.connect(voter2).castFreezeVote();
      await freezeVoting.connect(voter3).castFreezeVote();

      const secondFreezeActivated = await freezeVoting.freezeActivated();
      expect(secondFreezeActivated).to.not.equal(0);
      expect(secondFreezeActivated).to.be.gt(firstFreezeActivated);
    });
  });
});
