import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { MockHats2 } from '../../typechain-types';

/**
 * Shared test utilities for testing the HatsProposalCreationWhitelistV1 isProposer functionality
 * Used by both LinearERC20VotingWithHatsProposalCreationV1 and LinearERC721VotingWithHatsProposalCreationV1 tests
 */

/**
 * Interface for any contract that implements the isProposer and whitelistHat methods
 */
interface HatsProposerTester {
  isProposer(address: string): Promise<boolean>;
  whitelistHat(hatId: bigint): Promise<any>;
  connect(signer: SignerWithAddress): HatsProposerTester;
}

/**
 * Parameters for running the isProposer tests
 */
interface HatsProposerTestParams {
  getMockHats: () => MockHats2;
  getContract: () => HatsProposerTester;
  hatWearer: () => SignerWithAddress;
  nonHatWearer: () => SignerWithAddress;
  tokenHolder: () => SignerWithAddress;
  owner: () => SignerWithAddress;
  proposerHatId: bigint;
  nonProposerHatId: bigint;
}

/**
 * Run all the isProposer tests on the given contract
 * @param describe The describe function from Mocha
 * @param it The it function from Mocha
 * @param params The test parameters
 */
export function runHatsProposerTests(params: HatsProposerTestParams): void {
  beforeEach(async () => {
    await params
      .getMockHats()
      .setWearerStatus(params.hatWearer().address, params.proposerHatId, true);
    await params
      .getMockHats()
      .setWearerStatus(params.nonHatWearer().address, params.nonProposerHatId, true);
  });

  it('should return true for an address wearing a whitelisted hat', async () => {
    // hatWearer has proposerHatId, which is whitelisted
    const isHatWearerProposer = await params.getContract().isProposer(params.hatWearer().address);
    void expect(isHatWearerProposer).to.be.true;
  });

  it('should return false for an address wearing a non-whitelisted hat', async () => {
    // nonHatWearer has nonProposerHatId, which is not whitelisted
    const isNonHatWearerProposer = await params
      .getContract()
      .isProposer(params.nonHatWearer().address);
    void expect(isNonHatWearerProposer).to.be.false;
  });

  it('should return false for an address not wearing any hat even if they have tokens/NFTs', async () => {
    // tokenHolder has no hats at all, but has tokens/NFTs
    const isTokenHolderProposer = await params
      .getContract()
      .isProposer(params.tokenHolder().address);
    void expect(isTokenHolderProposer).to.be.false;
  });

  it('should return true after adding a previously non-whitelisted hat to the whitelist', async () => {
    // First verify nonHatWearer is not a proposer initially
    const isNonHatWearerProposerBefore = await params
      .getContract()
      .isProposer(params.nonHatWearer().address);
    void expect(isNonHatWearerProposerBefore).to.be.false;

    // Adding nonProposerHatId to the whitelist
    await params.getContract().connect(params.owner()).whitelistHat(params.nonProposerHatId);

    // Now nonHatWearer should be a proposer
    const isNonHatWearerProposerAfterWhitelist = await params
      .getContract()
      .isProposer(params.nonHatWearer().address);
    void expect(isNonHatWearerProposerAfterWhitelist).to.be.true;
  });
}
