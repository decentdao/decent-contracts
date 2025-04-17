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
      await mockERC20Strategy.setVotingWeight(_voterAddress, _proposalId, 1);

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

    it('Should return false if user has zero voting weight', async function () {
      // First verify the happy path works with non-zero weight
      const { calldata } = await setupVoteOperation(proposalId, voteTypes.YES, voter.address);
      const validResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC20Strategy.getAddress(),
        calldata,
      );
      void expect(validResult).to.be.true;

      // Now set voting weight to zero
      await mockERC20Strategy.setVotingWeight(voter.address, proposalId, 0);

      const invalidResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC20Strategy.getAddress(),
        calldata,
      );
      void expect(invalidResult).to.be.false;
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
