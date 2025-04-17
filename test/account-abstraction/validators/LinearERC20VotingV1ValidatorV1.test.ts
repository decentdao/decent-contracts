import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  IERC165__factory,
  IFunctionValidator__factory,
  IVersion__factory,
  LinearERC20VotingV1ValidatorV1,
  LinearERC20VotingV1ValidatorV1__factory,
  MockLinearERC20VotingV1,
  MockLinearERC20VotingV1__factory,
} from '../../../typechain-types';
import { calculateInterfaceId } from '../../helpers/utils';

describe('LinearERC20VotingV1ValidatorV1', function () {
  // contracts
  let validator: LinearERC20VotingV1ValidatorV1;
  let mockERC20Strategy: MockLinearERC20VotingV1;

  // signers
  let owner: SignerWithAddress;
  let voter: SignerWithAddress;

  // test data
  const proposalId = 1;
  const voteTypes = {
    NO: 0,
    YES: 1,
    ABSTAIN: 2,
  };

  beforeEach(async function () {
    [owner, voter] = await ethers.getSigners();

    // Deploy mock voting contract
    mockERC20Strategy = await new MockLinearERC20VotingV1__factory(owner).deploy();

    // Deploy validator
    validator = await new LinearERC20VotingV1ValidatorV1__factory(owner).deploy();

    // Set the mock contract as its own governance token (it implements the required interface)
    await mockERC20Strategy.setGovernanceToken(await mockERC20Strategy.getAddress());
  });

  describe('validateOperation', function () {
    async function setupVoteOperation(
      _proposalId: number,
      _voteType: number,
      _voterAddress: string,
    ) {
      const currentBlock = await ethers.provider.getBlockNumber();

      const proposalPeriod = {
        startBlock: currentBlock,
        endBlock: currentBlock + 100,
      };

      // Set up proposal votes data with safe block numbers
      await mockERC20Strategy.setProposalPeriod(_proposalId, proposalPeriod);

      // Set up voting state
      await mockERC20Strategy.setVotingPeriodEnded(_proposalId, false);
      await mockERC20Strategy.setHasVoted(_proposalId, _voterAddress, false);

      // Set up checkpoints for voting weight
      const checkpoint = {
        fromBlock: currentBlock - 1, // Checkpoint is one block before start
        votes: 1n, // Non-zero voting weight
      };
      await mockERC20Strategy.setCheckpoints(_voterAddress, [checkpoint]);

      const calldata = mockERC20Strategy.interface.encodeFunctionData('vote', [
        _proposalId,
        _voteType,
      ]);

      return { calldata, proposalPeriod };
    }

    it('Should return false for incorrect function selector', async function () {
      // First verify the happy path works
      const { calldata: validCalldata } = await setupVoteOperation(
        proposalId,
        voteTypes.YES,
        voter.address,
      );
      const validResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC20Strategy.getAddress(),
        validCalldata,
      );
      void expect(validResult).to.be.true;

      // Now test the incorrect selector
      const wrongCalldata = '0x12345678';
      const invalidResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC20Strategy.getAddress(),
        wrongCalldata,
      );
      void expect(invalidResult).to.be.false;
    });

    it('Should return false for invalid vote type', async function () {
      // First verify the happy path works
      const { calldata: validCalldata } = await setupVoteOperation(
        proposalId,
        voteTypes.YES,
        voter.address,
      );
      const validResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC20Strategy.getAddress(),
        validCalldata,
      );
      void expect(validResult).to.be.true;

      // Now test with invalid vote type
      const invalidVoteType = 3; // Only 0,1,2 are valid
      const { calldata: invalidCalldata } = await setupVoteOperation(
        proposalId,
        invalidVoteType,
        voter.address,
      );

      const invalidResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC20Strategy.getAddress(),
        invalidCalldata,
      );
      void expect(invalidResult).to.be.false;
    });

    it('Should return false for non-existent proposal', async function () {
      // First verify the happy path works
      const { calldata } = await setupVoteOperation(proposalId, voteTypes.YES, voter.address);
      const validResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC20Strategy.getAddress(),
        calldata,
      );
      void expect(validResult).to.be.true;

      // Now set the proposal to non-existent (endBlock = 0)
      await mockERC20Strategy.setProposalPeriod(proposalId, {
        startBlock: 0,
        endBlock: 0, // Zero end block indicates non-existent proposal
      });

      const invalidResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC20Strategy.getAddress(),
        calldata,
      );
      void expect(invalidResult).to.be.false;
    });

    it('Should return false if voting period has ended', async function () {
      // First verify the happy path works
      const { calldata } = await setupVoteOperation(proposalId, voteTypes.YES, voter.address);
      const validResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC20Strategy.getAddress(),
        calldata,
      );
      void expect(validResult).to.be.true;

      // Now set the voting period ended
      await mockERC20Strategy.setVotingPeriodEnded(proposalId, true);

      const invalidResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC20Strategy.getAddress(),
        calldata,
      );
      void expect(invalidResult).to.be.false;
    });

    it('Should return false if user has already voted', async function () {
      // First verify the happy path works
      const { calldata } = await setupVoteOperation(proposalId, voteTypes.YES, voter.address);
      const validResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC20Strategy.getAddress(),
        calldata,
      );
      void expect(validResult).to.be.true;

      // Now set hasVoted to true
      await mockERC20Strategy.setHasVoted(proposalId, voter.address, true);

      const invalidResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC20Strategy.getAddress(),
        calldata,
      );
      void expect(invalidResult).to.be.false;
    });

    describe('Checkpoint-based voting weight validation', function () {
      describe('Zero voting weight cases', function () {
        it('Should return false when user has no checkpoints', async function () {
          // Get the vote operation setup but override the checkpoint setup
          const { calldata } = await setupVoteOperation(proposalId, voteTypes.YES, voter.address);

          // Override the checkpoint setup to ensure zero checkpoints
          await mockERC20Strategy.setCheckpoints(voter.address, []);

          const isValid = await validator.validateOperation(
            ethers.ZeroAddress,
            voter.address,
            await mockERC20Strategy.getAddress(),
            calldata,
          );

          void expect(isValid).to.be.false;
        });

        it('Should return false when all checkpoints are after proposal start block', async function () {
          const { calldata, proposalPeriod } = await setupVoteOperation(
            proposalId,
            voteTypes.YES,
            voter.address,
          );

          // Set checkpoints that are all after the proposal start block
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              fromBlock: proposalPeriod.startBlock + 1, // After proposal start
              votes: 100n,
            },
            {
              fromBlock: proposalPeriod.startBlock + 2, // Even later checkpoint
              votes: 200n,
            },
          ]);

          const isValid = await validator.validateOperation(
            ethers.ZeroAddress,
            voter.address,
            await mockERC20Strategy.getAddress(),
            calldata,
          );

          void expect(isValid).to.be.false;
        });

        it('Should return false when the relevant pre-proposal checkpoint has zero votes', async function () {
          const { calldata, proposalPeriod } = await setupVoteOperation(
            proposalId,
            voteTypes.YES,
            voter.address,
          );

          // Set a checkpoint before proposal start but with zero votes
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              fromBlock: proposalPeriod.startBlock - 1, // Just before proposal start
              votes: 0n, // Zero voting weight
            },
          ]);

          const isValid = await validator.validateOperation(
            ethers.ZeroAddress,
            voter.address,
            await mockERC20Strategy.getAddress(),
            calldata,
          );

          void expect(isValid).to.be.false;
        });
      });

      describe('Single checkpoint scenarios', function () {
        it('Should return true when single checkpoint is before proposal start', async function () {
          const { calldata, proposalPeriod } = await setupVoteOperation(
            proposalId,
            voteTypes.YES,
            voter.address,
          );

          // Set a single checkpoint before proposal start
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              fromBlock: proposalPeriod.startBlock - 1, // One block before proposal start
              votes: 100n,
            },
          ]);

          const isValid = await validator.validateOperation(
            ethers.ZeroAddress,
            voter.address,
            await mockERC20Strategy.getAddress(),
            calldata,
          );

          void expect(isValid).to.be.true;
        });

        it('Should return true when single checkpoint is exactly at proposal start', async function () {
          const { calldata, proposalPeriod } = await setupVoteOperation(
            proposalId,
            voteTypes.YES,
            voter.address,
          );

          // Set a single checkpoint exactly at proposal start block
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              fromBlock: proposalPeriod.startBlock, // Same as proposal start block
              votes: 100n,
            },
          ]);

          const isValid = await validator.validateOperation(
            ethers.ZeroAddress,
            voter.address,
            await mockERC20Strategy.getAddress(),
            calldata,
          );

          void expect(isValid).to.be.true;
        });

        it('Should return false when single checkpoint is after proposal start', async function () {
          const { calldata, proposalPeriod } = await setupVoteOperation(
            proposalId,
            voteTypes.YES,
            voter.address,
          );

          // Set a single checkpoint after proposal start block
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              fromBlock: proposalPeriod.startBlock + 1, // One block after proposal start
              votes: 100n, // Non-zero votes to ensure failure is due to timing
            },
          ]);

          const isValid = await validator.validateOperation(
            ethers.ZeroAddress,
            voter.address,
            await mockERC20Strategy.getAddress(),
            calldata,
          );

          void expect(isValid).to.be.false;
        });
      });

      describe('Multiple checkpoint scenarios', function () {
        it('Should use most recent checkpoint before proposal start when multiple exist', async function () {
          const { calldata, proposalPeriod } = await setupVoteOperation(
            proposalId,
            voteTypes.YES,
            voter.address,
          );

          // Set multiple checkpoints before proposal start with different vote amounts
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              fromBlock: proposalPeriod.startBlock - 3, // Oldest checkpoint
              votes: 50n,
            },
            {
              fromBlock: proposalPeriod.startBlock - 2, // Middle checkpoint
              votes: 0n, // Zero votes - if this was used, validation would fail
            },
            {
              fromBlock: proposalPeriod.startBlock - 1, // Most recent valid checkpoint
              votes: 100n, // Non-zero votes - this should be used
            },
          ]);

          const isValid = await validator.validateOperation(
            ethers.ZeroAddress,
            voter.address,
            await mockERC20Strategy.getAddress(),
            calldata,
          );

          void expect(isValid).to.be.true;
        });

        it('Should ignore checkpoints after proposal start', async function () {
          const { calldata, proposalPeriod } = await setupVoteOperation(
            proposalId,
            voteTypes.YES,
            voter.address,
          );

          // Set checkpoints both before and after proposal start
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              fromBlock: proposalPeriod.startBlock - 1, // Valid checkpoint before start
              votes: 0n, // Zero votes - this should be used, causing validation to fail
            },
            {
              fromBlock: proposalPeriod.startBlock + 1, // After proposal start
              votes: 100n, // Non-zero votes - this should be ignored
            },
            {
              fromBlock: proposalPeriod.startBlock + 2, // Even later checkpoint
              votes: 200n, // Higher votes - should also be ignored
            },
          ]);

          const isValid = await validator.validateOperation(
            ethers.ZeroAddress,
            voter.address,
            await mockERC20Strategy.getAddress(),
            calldata,
          );

          void expect(isValid).to.be.false;
        });

        it('Should handle checkpoints at exactly proposal start block when other checkpoints exist', async function () {
          const { calldata, proposalPeriod } = await setupVoteOperation(
            proposalId,
            voteTypes.YES,
            voter.address,
          );

          // Set checkpoints before, at, and after proposal start
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              fromBlock: proposalPeriod.startBlock - 2, // Earlier checkpoint
              votes: 0n, // Should be ignored in favor of later checkpoint
            },
            {
              fromBlock: proposalPeriod.startBlock, // Exactly at proposal start
              votes: 100n, // This should be used for validation
            },
            {
              fromBlock: proposalPeriod.startBlock + 1, // After start
              votes: 0n, // Should be ignored
            },
          ]);

          const isValid = await validator.validateOperation(
            ethers.ZeroAddress,
            voter.address,
            await mockERC20Strategy.getAddress(),
            calldata,
          );

          void expect(isValid).to.be.true;
        });
      });

      describe('Edge cases', function () {
        it('Should handle maximum uint224 voting weight', async function () {
          const { calldata, proposalPeriod } = await setupVoteOperation(
            proposalId,
            voteTypes.YES,
            voter.address,
          );

          // Set checkpoint with maximum uint224 value
          const maxUint224 = 2n ** 224n - 1n;
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              fromBlock: proposalPeriod.startBlock - 1,
              votes: maxUint224,
            },
          ]);

          const isValid = await validator.validateOperation(
            ethers.ZeroAddress,
            voter.address,
            await mockERC20Strategy.getAddress(),
            calldata,
          );

          void expect(isValid).to.be.true;
        });

        it('Should handle proposal start at block 0', async function () {
          const { calldata } = await setupVoteOperation(proposalId, voteTypes.YES, voter.address);

          // Override proposal to start at block 0
          await mockERC20Strategy.setProposalPeriod(proposalId, {
            startBlock: 0,
            endBlock: 100,
          });

          // Set checkpoint at block 0
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              fromBlock: 0,
              votes: 100n,
            },
          ]);

          const isValid = await validator.validateOperation(
            ethers.ZeroAddress,
            voter.address,
            await mockERC20Strategy.getAddress(),
            calldata,
          );

          void expect(isValid).to.be.true;
        });

        it('Should handle gaps between checkpoints', async function () {
          const { calldata, proposalPeriod } = await setupVoteOperation(
            proposalId,
            voteTypes.YES,
            voter.address,
          );

          // Set checkpoints with large gaps between them
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              fromBlock: 0, // Checkpoint at genesis
              votes: 50n,
            },
            {
              fromBlock: proposalPeriod.startBlock / 2, // Checkpoint halfway between genesis and proposal start
              votes: 0n,
            },
            {
              fromBlock: proposalPeriod.startBlock - 1, // Checkpoint just before proposal start
              votes: 100n, // This should be used
            },
          ]);

          const isValid = await validator.validateOperation(
            ethers.ZeroAddress,
            voter.address,
            await mockERC20Strategy.getAddress(),
            calldata,
          );

          void expect(isValid).to.be.true;
        });
      });
    });

    it('Should return true for valid vote operation', async function () {
      const { calldata } = await setupVoteOperation(proposalId, voteTypes.YES, voter.address);
      const isValid = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC20Strategy.getAddress(),
        calldata,
      );
      void expect(isValid).to.be.true;
    });
  });

  describe('getProposalPeriod', function () {
    it('Should return correct start and end blocks for existing proposal', async function () {
      const currentBlock = await ethers.provider.getBlockNumber();
      const expectedStart = currentBlock;
      const expectedEnd = currentBlock + 100;

      await mockERC20Strategy.setProposalPeriod(proposalId, {
        startBlock: expectedStart,
        endBlock: expectedEnd,
      });

      const [actualStart, actualEnd] = await mockERC20Strategy.getProposalPeriod(proposalId);
      expect(actualStart).to.equal(expectedStart);
      expect(actualEnd).to.equal(expectedEnd);
    });

    it('Should return zeros for non-existent proposal', async function () {
      const [startBlock, endBlock] = await mockERC20Strategy.getProposalPeriod(999); // Using an unused proposal ID
      expect(startBlock).to.equal(0);
      expect(endBlock).to.equal(0);
    });

    it('Should return updated values after modifying proposal period', async function () {
      // Set initial values
      const currentBlock = await ethers.provider.getBlockNumber();
      await mockERC20Strategy.setProposalPeriod(proposalId, {
        startBlock: currentBlock,
        endBlock: currentBlock + 100,
      });

      // Update to new values
      const newStart = currentBlock + 50;
      const newEnd = currentBlock + 150;
      await mockERC20Strategy.setProposalPeriod(proposalId, {
        startBlock: newStart,
        endBlock: newEnd,
      });

      // Verify the update
      const [startBlock, endBlock] = await mockERC20Strategy.getProposalPeriod(proposalId);
      expect(startBlock).to.equal(newStart);
      expect(endBlock).to.equal(newEnd);
    });
  });

  describe('ERC165', function () {
    // Interface IDs
    let iFunctionValidatorInterfaceId: string;
    let iVersionInterfaceId: string;
    let iERC165InterfaceId: string;

    beforeEach(async function () {
      // Calculate IFunctionValidator interface ID
      const IFunctionValidatorInterface = IFunctionValidator__factory.createInterface();
      iFunctionValidatorInterfaceId = calculateInterfaceId(IFunctionValidatorInterface);

      // Calculate IVersion interface ID
      const IVersionInterface = IVersion__factory.createInterface();
      iVersionInterfaceId = calculateInterfaceId(IVersionInterface);

      // Calculate IERC165 interface ID
      const IERC165Interface = IERC165__factory.createInterface();
      iERC165InterfaceId = calculateInterfaceId(IERC165Interface);
    });

    it('Should support IERC165 interface', async function () {
      const supported = await validator.supportsInterface(iERC165InterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IFunctionValidator interface', async function () {
      const supported = await validator.supportsInterface(iFunctionValidatorInterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IVersion interface', async function () {
      const supported = await validator.supportsInterface(iVersionInterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should not support random interface', async function () {
      const randomInterfaceId = '0x12345678';
      const supported = await validator.supportsInterface(randomInterfaceId);
      void expect(supported).to.be.false;
    });
  });

  describe('Version', function () {
    it('Should return correct version', async function () {
      expect(await validator.getVersion()).to.equal(1);
    });
  });
});
