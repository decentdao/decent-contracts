import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { time } from '@nomicfoundation/hardhat-network-helpers';
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
} from '../../../../typechain-types';
import { calculateInterfaceId } from '../../../helpers/utils';

describe('LinearERC20VotingV1ValidatorV1', function () {
  // contracts
  let validator: LinearERC20VotingV1ValidatorV1;
  let mockERC20Strategy: MockLinearERC20VotingV1;

  // signers
  let deployer: SignerWithAddress;
  let voter: SignerWithAddress;

  // test data
  const proposalId = 1;
  const voteTypes = {
    NO: 0,
    YES: 1,
    ABSTAIN: 2,
  };

  beforeEach(async function () {
    [deployer, voter] = await ethers.getSigners();

    // Deploy mock voting contract
    mockERC20Strategy = await new MockLinearERC20VotingV1__factory(deployer).deploy();

    // Deploy validator
    validator = await new LinearERC20VotingV1ValidatorV1__factory(deployer).deploy();

    // Set the mock contract as its own governance token (it implements the required interface)
    await mockERC20Strategy.setGovernanceToken(await mockERC20Strategy.getAddress());
  });

  describe('validateOperation', function () {
    async function setupVoteOperation(
      _proposalId: number,
      _voteType: number,
      _voterAddress: string,
    ) {
      const currentTimestamp = await time.latest();

      const proposalPeriod = {
        startTime: currentTimestamp,
        endTime: currentTimestamp + 100,
      };

      // Set up proposal votes data with safe timestamps
      await mockERC20Strategy.setVotingTimestamps(_proposalId, proposalPeriod);

      // Set up voting state
      await mockERC20Strategy.setVotingPeriodEnded(_proposalId, false);
      await mockERC20Strategy.setHasVoted(_proposalId, _voterAddress, false);

      // Set up checkpoints for voting weight
      const checkpoint = {
        key: currentTimestamp - 1, // Checkpoint is one timestamp before start
        value: 1n, // Non-zero voting weight
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

      // Now set the proposal to non-existent (endTimestamp = 0)
      await mockERC20Strategy.setVotingTimestamps(proposalId, {
        startTime: 0,
        endTime: 0, // Zero end timepoint
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

        it('Should return false when all checkpoints are after proposal start timestamp', async function () {
          const { calldata, proposalPeriod } = await setupVoteOperation(
            proposalId,
            voteTypes.YES,
            voter.address,
          );

          // Set checkpoints that are all after the proposal start timestamp
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              key: proposalPeriod.startTime + 1, // After proposal start
              value: 100n,
            },
            {
              key: proposalPeriod.startTime + 2, // Even later checkpoint
              value: 200n,
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
              key: proposalPeriod.startTime - 1, // Just before proposal start
              value: 0n, // Zero voting weight
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
              key: proposalPeriod.startTime - 1, // One timestamp before proposal start
              value: 100n,
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

          // Set a single checkpoint exactly at proposal start timestamp
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              key: proposalPeriod.startTime, // Same as proposal start timestamp
              value: 100n,
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

          // Set a single checkpoint after proposal start timestamp
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              key: proposalPeriod.startTime + 1, // One timestamp after proposal start
              value: 100n, // Non-zero votes to ensure failure is due to timing
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
              key: proposalPeriod.startTime - 3, // Oldest checkpoint
              value: 50n,
            },
            {
              key: proposalPeriod.startTime - 2, // Middle checkpoint
              value: 0n, // Zero votes - if this was used, validation would fail
            },
            {
              key: proposalPeriod.startTime - 1, // Most recent valid checkpoint
              value: 100n, // Non-zero votes - this should be used
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
              key: proposalPeriod.startTime - 1, // Valid checkpoint before start
              value: 0n, // Zero votes - this should be used, causing validation to fail
            },
            {
              key: proposalPeriod.startTime + 1, // After proposal start
              value: 100n, // Non-zero votes - this should be ignored
            },
            {
              key: proposalPeriod.startTime + 2, // Even later checkpoint
              value: 200n, // Higher votes - should also be ignored
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

        it('Should handle checkpoints at exactly proposal start timestamp when other checkpoints exist', async function () {
          const { calldata, proposalPeriod } = await setupVoteOperation(
            proposalId,
            voteTypes.YES,
            voter.address,
          );

          // Set checkpoints before, at, and after proposal start
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              key: proposalPeriod.startTime - 2, // Earlier checkpoint
              value: 0n, // Should be ignored in favor of later checkpoint
            },
            {
              key: proposalPeriod.startTime, // Exactly at proposal start
              value: 100n, // This should be used for validation
            },
            {
              key: proposalPeriod.startTime + 1, // After start
              value: 0n, // Should be ignored
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
        it('Should handle maximum uint208 voting weight', async function () {
          const { calldata, proposalPeriod } = await setupVoteOperation(
            proposalId,
            voteTypes.YES,
            voter.address,
          );

          // Set checkpoint with maximum uint208 value
          const maxUint208 = 2n ** 208n - 1n;
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              key: proposalPeriod.startTime - 1,
              value: maxUint208,
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

        it('Should handle proposal start at timestamp 0', async function () {
          const { calldata } = await setupVoteOperation(proposalId, voteTypes.YES, voter.address);

          // Override proposal to start at timestamp 0
          await mockERC20Strategy.setVotingTimestamps(proposalId, {
            startTime: 0,
            endTime: 100,
          });

          // Set checkpoint at timestamp 0
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              key: 0,
              value: 100n,
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
              key: 0, // Checkpoint at genesis
              value: 50n,
            },
            {
              key: Math.floor(proposalPeriod.startTime / 2), // Checkpoint halfway between genesis and proposal start
              value: 0n,
            },
            {
              key: proposalPeriod.startTime - 1, // Checkpoint just before proposal start
              value: 100n, // This should be used
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

      describe('Optimization: Checkpoint after proposal end timestamp', function () {
        it('Should return false if the most recent checkpoint is after proposal end timestamp, even if an older valid checkpoint exists', async function () {
          const { calldata, proposalPeriod } = await setupVoteOperation(
            proposalId,
            voteTypes.YES,
            voter.address,
          );

          // Set up checkpoints:
          // - An older one that would be valid (before startTimestamp)
          // - A newer one that is after endTimestamp (should trigger the optimization)
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              key: proposalPeriod.startTime - 10, // Older, valid checkpoint
              value: 100n,
            },
            {
              key: proposalPeriod.endTime + 1, // Newer, after proposal end
              value: 50n, // Votes here don't matter as it should short-circuit
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

        it('Should return false if the only checkpoint is after proposal end timestamp', async function () {
          const { calldata, proposalPeriod } = await setupVoteOperation(
            proposalId,
            voteTypes.YES,
            voter.address,
          );

          // Set up a single checkpoint that is after endTimestamp
          await mockERC20Strategy.setCheckpoints(voter.address, [
            {
              key: proposalPeriod.endTime + 5, // After proposal end
              value: 100n,
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
    it('Should return correct start and end timestamps for existing proposal', async function () {
      const currentTimestamp = await time.latest();
      const expectedStart = currentTimestamp;
      const expectedEnd = currentTimestamp + 100;

      await mockERC20Strategy.setVotingTimestamps(proposalId, {
        startTime: expectedStart,
        endTime: expectedEnd,
      });

      const [actualStart, actualEnd] = await mockERC20Strategy.getVotingTimestamps(proposalId);
      expect(actualStart).to.equal(expectedStart);
      expect(actualEnd).to.equal(expectedEnd);
    });

    it('Should return zeros for non-existent proposal', async function () {
      const [startTimestamp, endTimestamp] = await mockERC20Strategy.getVotingTimestamps(999); // Using an unused proposal ID
      expect(startTimestamp).to.equal(0);
      expect(endTimestamp).to.equal(0);
    });

    it('Should return updated values after modifying proposal period', async function () {
      // Set initial values
      const currentTimestamp = await time.latest();
      await mockERC20Strategy.setVotingTimestamps(proposalId, {
        startTime: currentTimestamp,
        endTime: currentTimestamp + 10,
      });

      // Update to new values
      const newStart = currentTimestamp + 50;
      const newEnd = currentTimestamp + 150;
      await mockERC20Strategy.setVotingTimestamps(proposalId, {
        startTime: newStart,
        endTime: newEnd,
      });

      // Verify the update
      const [startTimestamp, endTimestamp] =
        await mockERC20Strategy.getVotingTimestamps(proposalId);
      expect(startTimestamp).to.equal(newStart);
      expect(endTimestamp).to.equal(newEnd);
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
