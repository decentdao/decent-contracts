import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  IERC165__factory,
  IFunctionValidator__factory,
  IVersion__factory,
  LinearERC721VotingV1ValidatorV1,
  LinearERC721VotingV1ValidatorV1__factory,
  MockERC721,
  MockERC721__factory,
  MockLinearERC721VotingV1,
  MockLinearERC721VotingV1__factory,
} from '../../../typechain-types';
import { calculateInterfaceId } from '../../helpers/utils';

describe('LinearERC721VotingV1ValidatorV1', function () {
  // contracts
  let validator: LinearERC721VotingV1ValidatorV1;
  let mockERC721Strategy: MockLinearERC721VotingV1;
  let mockNFT1: MockERC721;
  let mockNFT2: MockERC721;

  // signers
  let owner: SignerWithAddress;
  let voter: SignerWithAddress;
  let nonOwner: SignerWithAddress;

  // test data
  const proposalId = 1;
  const tokenId1 = 1;
  const tokenId2 = 2;
  const voteTypes = {
    NO: 0,
    YES: 1,
    ABSTAIN: 2,
  };

  beforeEach(async function () {
    [owner, voter, nonOwner] = await ethers.getSigners();

    // Deploy mock contracts
    mockERC721Strategy = await new MockLinearERC721VotingV1__factory(owner).deploy();
    mockNFT1 = await new MockERC721__factory(owner).deploy();
    mockNFT2 = await new MockERC721__factory(owner).deploy();

    // Deploy validator
    validator = await new LinearERC721VotingV1ValidatorV1__factory(owner).deploy();

    // Mint NFTs to voter
    await mockNFT1.mintToken(voter.address, tokenId1);
    await mockNFT2.mintToken(voter.address, tokenId2);
  });

  describe('validateOperation', function () {
    async function setupVoteOperation(
      _proposalId: number,
      _voteType: number,
      _tokenAddresses: string[],
      _tokenIds: number[],
    ) {
      const currentBlock = await ethers.provider.getBlockNumber();
      await mockERC721Strategy.setVotingEndBlock(_proposalId, currentBlock + 100);

      // Set up token weight
      for (let i = 0; i < _tokenAddresses.length; i++) {
        await mockERC721Strategy.setTokenWeight(_tokenAddresses[i], 1);
      }

      // Ensure token hasn't voted
      for (let i = 0; i < _tokenAddresses.length; i++) {
        await mockERC721Strategy.setHasVoted(_proposalId, _tokenAddresses[i], _tokenIds[i], false);
      }

      const calldata = mockERC721Strategy.interface.encodeFunctionData('vote', [
        _proposalId,
        _voteType,
        _tokenAddresses,
        _tokenIds,
      ]);

      return { calldata, currentBlock };
    }

    it('Should return false for incorrect function selector', async function () {
      // First verify the happy path works
      const { calldata: validCalldata } = await setupVoteOperation(
        proposalId,
        voteTypes.YES,
        [await mockNFT1.getAddress()],
        [tokenId1],
      );
      const validResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        validCalldata,
      );
      void expect(validResult).to.be.true;

      // Now test the incorrect selector
      const wrongCalldata = '0x12345678';
      const invalidResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        wrongCalldata,
      );
      void expect(invalidResult).to.be.false;
    });

    it('Should return false for mismatched array lengths', async function () {
      // First verify the happy path works
      const { calldata: validCalldata } = await setupVoteOperation(
        proposalId,
        voteTypes.YES,
        [await mockNFT1.getAddress()],
        [tokenId1],
      );
      const validResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        validCalldata,
      );
      void expect(validResult).to.be.true;

      // Now test with mismatched arrays
      const tokenAddresses = [await mockNFT1.getAddress()];
      const tokenIds = [tokenId1, tokenId2]; // More IDs than addresses
      const { calldata: invalidCalldata } = await setupVoteOperation(
        proposalId,
        voteTypes.YES,
        tokenAddresses,
        tokenIds,
      );

      const invalidResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        invalidCalldata,
      );
      void expect(invalidResult).to.be.false;
    });

    it('Should return false for invalid vote type', async function () {
      // First verify the happy path works
      const { calldata: validCalldata } = await setupVoteOperation(
        proposalId,
        voteTypes.YES,
        [await mockNFT1.getAddress()],
        [tokenId1],
      );
      const validResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        validCalldata,
      );
      void expect(validResult).to.be.true;

      // Now test with invalid vote type
      const invalidVoteType = 3; // Only 0,1,2 are valid
      const { calldata: invalidCalldata } = await setupVoteOperation(
        proposalId,
        invalidVoteType,
        [await mockNFT1.getAddress()],
        [tokenId1],
      );

      const invalidResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        invalidCalldata,
      );
      void expect(invalidResult).to.be.false;
    });

    it('Should return false for non-existent proposal', async function () {
      // First verify the happy path works
      const { calldata } = await setupVoteOperation(
        proposalId,
        voteTypes.YES,
        [await mockNFT1.getAddress()],
        [tokenId1],
      );
      const validResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        calldata,
      );
      void expect(validResult).to.be.true;

      // Now set the proposal to non-existent
      await mockERC721Strategy.setVotingEndBlock(proposalId, 0);

      const invalidResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        calldata,
      );
      void expect(invalidResult).to.be.false;
    });

    it('Should return false if voting period has ended', async function () {
      // First verify the happy path works
      const { calldata, currentBlock } = await setupVoteOperation(
        proposalId,
        voteTypes.YES,
        [await mockNFT1.getAddress()],
        [tokenId1],
      );
      const validResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        calldata,
      );
      void expect(validResult).to.be.true;

      // Now set end block to past
      await mockERC721Strategy.setVotingEndBlock(proposalId, currentBlock - 1);

      const invalidResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        calldata,
      );
      void expect(invalidResult).to.be.false;
    });

    it('Should return false if token has already voted', async function () {
      // First verify the happy path works
      const { calldata } = await setupVoteOperation(
        proposalId,
        voteTypes.YES,
        [await mockNFT1.getAddress()],
        [tokenId1],
      );
      const validResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        calldata,
      );
      void expect(validResult).to.be.true;

      // Now set token as already voted
      await mockERC721Strategy.setHasVoted(proposalId, await mockNFT1.getAddress(), tokenId1, true);

      const invalidResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        calldata,
      );
      void expect(invalidResult).to.be.false;
    });

    it('Should return false if voter does not own token', async function () {
      // First verify the happy path works
      const { calldata } = await setupVoteOperation(
        proposalId,
        voteTypes.YES,
        [await mockNFT1.getAddress()],
        [tokenId1],
      );
      const validResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        calldata,
      );
      void expect(validResult).to.be.true;

      // Now transfer token away from voter
      await mockNFT1.connect(voter).transferFrom(voter.address, nonOwner.address, tokenId1);

      const invalidResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        calldata,
      );
      void expect(invalidResult).to.be.false;
    });

    it('Should return false if total weight is zero', async function () {
      // First verify the happy path works
      const { calldata } = await setupVoteOperation(
        proposalId,
        voteTypes.YES,
        [await mockNFT1.getAddress()],
        [tokenId1],
      );
      const validResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        calldata,
      );
      void expect(validResult).to.be.true;

      // Now set token weight to zero
      await mockERC721Strategy.setTokenWeight(await mockNFT1.getAddress(), 0);

      const invalidResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        calldata,
      );
      void expect(invalidResult).to.be.false;
    });

    it('Should return true for valid vote operation with mixed weights', async function () {
      // First verify single token works
      const { calldata: singleTokenCalldata } = await setupVoteOperation(
        proposalId,
        voteTypes.YES,
        [await mockNFT1.getAddress()],
        [tokenId1],
      );
      const singleTokenResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        singleTokenCalldata,
      );
      void expect(singleTokenResult).to.be.true;

      // Now test with two tokens, one with weight and one without
      const tokenAddresses = [await mockNFT1.getAddress(), await mockNFT2.getAddress()];
      const tokenIds = [tokenId1, tokenId2];

      // Set mixed weights
      await mockERC721Strategy.setTokenWeight(await mockNFT1.getAddress(), 1);
      await mockERC721Strategy.setTokenWeight(await mockNFT2.getAddress(), 0);

      const { calldata: mixedWeightsCalldata } = await setupVoteOperation(
        proposalId,
        voteTypes.YES,
        tokenAddresses,
        tokenIds,
      );

      const mixedWeightsResult = await validator.validateOperation(
        ethers.ZeroAddress,
        voter.address,
        await mockERC721Strategy.getAddress(),
        mixedWeightsCalldata,
      );
      void expect(mixedWeightsResult).to.be.true;
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
      void expect(await validator.getVersion()).to.equal(1);
    });
  });
});
