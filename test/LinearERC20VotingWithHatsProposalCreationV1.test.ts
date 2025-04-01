import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  IERC165__factory,
  IHatsProposalCreationWhitelistV1__factory,
  IVersion__factory,
  LinearERC20VotingWithHatsProposalCreationV1,
  LinearERC20VotingWithHatsProposalCreationV1__factory,
  MockERC20Votes,
  MockERC20Votes__factory,
  MockHats2,
  MockHats2__factory,
} from '../typechain-types';
import { getModuleProxyFactory } from './GlobalSafeDeployments.test';
import { calculateProxyAddress } from './helpers';
import { runHatsProposerTests } from './helpers/hatsProposerTests';
import { calculateInterfaceId } from './helpers/utils';

describe('LinearERC20VotingWithHatsProposalCreationV1', () => {
  // Signers
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let nonOwner: SignerWithAddress;
  let azoriusAddress: string;
  let tokenHolder1: SignerWithAddress;
  let hatWearer: SignerWithAddress;
  let nonHatWearer: SignerWithAddress;

  // Contracts
  let linearERC20VotingWithHatsProposalCreationImplementation: LinearERC20VotingWithHatsProposalCreationV1;
  let linearERC20VotingWithHatsProposalCreation: LinearERC20VotingWithHatsProposalCreationV1;
  let mockToken: MockERC20Votes;
  let mockHats: MockHats2;

  // Constants
  const VOTING_PERIOD = 100; // blocks
  const QUORUM_NUMERATOR = 300000; // 30% of 1000000
  const BASIS_NUMERATOR = 500000; // 50% of 1000000

  // Hat IDs - we can use any arbitrary values
  const proposerHatId1 = 1n;
  const proposerHatId2 = 2n;
  const nonProposerHatId = 3n;

  async function deployLinearERC20VotingWithHatsProposalCreation(
    implementation: LinearERC20VotingWithHatsProposalCreationV1,
    strategyOwner: SignerWithAddress,
    governanceToken: MockERC20Votes,
    azoriusAddr: string,
    hatsContract: MockHats2,
    initialWhitelistedHats: bigint[],
  ): Promise<LinearERC20VotingWithHatsProposalCreationV1> {
    // Create the initialization data using the interface
    const initializeCalldata =
      LinearERC20VotingWithHatsProposalCreationV1__factory.createInterface().encodeFunctionData(
        'setUp',
        [
          ethers.AbiCoder.defaultAbiCoder().encode(
            [
              'address',
              'address',
              'address',
              'uint32',
              'uint256',
              'uint256',
              'address',
              'uint256[]',
            ],
            [
              strategyOwner.address,
              await governanceToken.getAddress(),
              azoriusAddr,
              VOTING_PERIOD,
              QUORUM_NUMERATOR,
              BASIS_NUMERATOR,
              await hatsContract.getAddress(),
              initialWhitelistedHats,
            ],
          ),
        ],
      );

    // Deploy the proxy with owner as the deployer
    const moduleProxyFactory = getModuleProxyFactory();
    const salt = ethers.keccak256(ethers.randomBytes(32));

    // Deploy the proxy with owner as the deployer
    await moduleProxyFactory.deployModule(
      await implementation.getAddress(),
      initializeCalldata,
      salt,
    );

    const predictedAddress = await calculateProxyAddress(
      moduleProxyFactory,
      await implementation.getAddress(),
      initializeCalldata,
      salt,
    );

    // Connect the proxy to the contract owner
    return LinearERC20VotingWithHatsProposalCreationV1__factory.connect(
      predictedAddress,
      strategyOwner,
    );
  }

  beforeEach(async () => {
    [deployer, owner, nonOwner, tokenHolder1, hatWearer, nonHatWearer] = await ethers.getSigners();

    // Use nonOwner address as a mock azorius address for testing
    azoriusAddress = await nonOwner.getAddress();

    // Deploy MockERC20Votes token
    mockToken = await new MockERC20Votes__factory(deployer).deploy();

    // Deploy MockHats
    mockHats = await new MockHats2__factory(deployer).deploy();

    // Deploy LinearERC20VotingWithHatsProposalCreation implementation
    linearERC20VotingWithHatsProposalCreationImplementation =
      await new LinearERC20VotingWithHatsProposalCreationV1__factory(deployer).deploy();

    // Deploy LinearERC20VotingWithHatsProposalCreation strategy with proposerHatId1 and proposerHatId2 whitelisted
    linearERC20VotingWithHatsProposalCreation =
      await deployLinearERC20VotingWithHatsProposalCreation(
        linearERC20VotingWithHatsProposalCreationImplementation,
        owner,
        mockToken,
        azoriusAddress,
        mockHats,
        [proposerHatId1, proposerHatId2],
      );
  });

  describe('Contract-Specific Functionality', () => {
    describe('initialization', () => {
      it('should initialize with correct parameters from both parent contracts', async () => {
        // Check LinearERC20VotingV1 parameters
        const ownerAddress = await linearERC20VotingWithHatsProposalCreation.owner();
        expect(ownerAddress).to.equal(owner.address);

        const tokenAddress = await linearERC20VotingWithHatsProposalCreation.governanceToken();
        expect(tokenAddress).to.equal(await mockToken.getAddress());

        const votingPeriod = await linearERC20VotingWithHatsProposalCreation.votingPeriod();
        expect(votingPeriod).to.equal(VOTING_PERIOD);

        // requiredProposerWeight should be 0 since we're using hats
        const weight = await linearERC20VotingWithHatsProposalCreation.requiredProposerWeight();
        expect(weight).to.equal(0);

        // Check HatsProposalCreationWhitelistV1 parameters
        const hatsContract = await linearERC20VotingWithHatsProposalCreation.hatsContract();
        expect(hatsContract).to.equal(await mockHats.getAddress());

        // Check whitelisted hats
        const whitelistedHats =
          await linearERC20VotingWithHatsProposalCreation.getWhitelistedHatIds();
        expect(whitelistedHats.length).to.equal(2);
        expect(whitelistedHats[0]).to.equal(proposerHatId1);
        expect(whitelistedHats[1]).to.equal(proposerHatId2);
      });

      it('should not allow reinitialization', async () => {
        // Deploy a new implementation to initialize again with the same params
        const initializeCalldata =
          linearERC20VotingWithHatsProposalCreationImplementation.interface.encodeFunctionData(
            'setUp',
            [
              ethers.AbiCoder.defaultAbiCoder().encode(
                [
                  'address',
                  'address',
                  'address',
                  'uint32',
                  'uint256',
                  'uint256',
                  'address',
                  'uint256[]',
                ],
                [
                  owner.address,
                  await mockToken.getAddress(),
                  azoriusAddress,
                  VOTING_PERIOD,
                  QUORUM_NUMERATOR,
                  BASIS_NUMERATOR,
                  await mockHats.getAddress(),
                  [proposerHatId1, proposerHatId2],
                ],
              ),
            ],
          );

        // Try to initialize directly through the proxy - should revert
        await expect(
          owner.sendTransaction({
            to: await linearERC20VotingWithHatsProposalCreation.getAddress(),
            data: initializeCalldata,
          }),
        ).to.be.reverted;
      });
    });

    describe('isProposer override', () => {
      runHatsProposerTests({
        getMockHats: () => mockHats,
        getContract: () => linearERC20VotingWithHatsProposalCreation,
        hatWearer: () => hatWearer,
        nonHatWearer: () => nonHatWearer,
        tokenHolder: () => tokenHolder1,
        owner: () => owner,
        proposerHatId: proposerHatId1,
        nonProposerHatId,
      });
    });

    describe('getVersion override', () => {
      // Use the shared version test utility
      it('should return the correct version number', async () => {
        expect(await linearERC20VotingWithHatsProposalCreation.getVersion()).to.equal(1);
      });
    });
  });

  describe('ERC165', function () {
    let iHatsProposalCreationWhitelistV1InterfaceId: string;
    let iVersionInterfaceId: string;
    let iERC165InterfaceId: string;

    beforeEach(async function () {
      // Dynamically calculate interface IDs
      const IHatsProposalCreationWhitelistV1Interface =
        IHatsProposalCreationWhitelistV1__factory.createInterface();
      iHatsProposalCreationWhitelistV1InterfaceId = calculateInterfaceId(
        IHatsProposalCreationWhitelistV1Interface,
      );

      const IVersionInterface = IVersion__factory.createInterface();
      iVersionInterfaceId = calculateInterfaceId(IVersionInterface);

      const IERC165Interface = IERC165__factory.createInterface();
      iERC165InterfaceId = calculateInterfaceId(IERC165Interface);
    });

    it('Should support IERC165 interface', async function () {
      const supported =
        await linearERC20VotingWithHatsProposalCreation.supportsInterface(iERC165InterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IHatsProposalCreationWhitelistV1 interface', async function () {
      const supported = await linearERC20VotingWithHatsProposalCreation.supportsInterface(
        iHatsProposalCreationWhitelistV1InterfaceId,
      );
      void expect(supported).to.be.true;
    });

    it('Should support IVersion interface', async function () {
      const supported =
        await linearERC20VotingWithHatsProposalCreation.supportsInterface(iVersionInterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should not support random interface', async function () {
      const randomInterfaceId = '0x12345678';
      const supported =
        await linearERC20VotingWithHatsProposalCreation.supportsInterface(randomInterfaceId);
      void expect(supported).to.be.false;
    });
  });

  describe('Version', () => {
    it('should return the correct version number', async () => {
      expect(await linearERC20VotingWithHatsProposalCreation.getVersion()).to.equal(1);
    });
  });
});
