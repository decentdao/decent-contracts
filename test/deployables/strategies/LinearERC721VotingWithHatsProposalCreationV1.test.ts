import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  IBaseStrategyV1__factory,
  IBaseVotingBasisPercentV1__factory,
  IERC165__factory,
  IERC721VotingStrategyV1__factory,
  IHatsProposalCreationWhitelistV1__factory,
  IVersion__factory,
  LinearERC721VotingWithHatsProposalCreationV1,
  LinearERC721VotingWithHatsProposalCreationV1__factory,
  MockERC721,
  MockERC721__factory,
  MockHats,
  MockHats__factory,
} from '../../../typechain-types';
import { runHatsProposerTests } from '../../helpers/hatsProposerTests';
import { calculateInterfaceId } from '../../helpers/utils';
import { runUUPSUpgradeabilityTests } from '../../helpers/uupsUpgradeabilityTests';

/**
 * This test file only covers the specific functionality of LinearERC721VotingWithHatsProposalCreationV1,
 * focusing on the contract-specific code, not functionality inherited from parent contracts.
 *
 * Specifically, we test:
 * 1. The initialize function (which combines parameters from both parent contracts)
 * 2. The isProposer override (which uses the Hats implementation)
 * 3. The getVersion override
 */

describe('LinearERC721VotingWithHatsProposalCreationV1', () => {
  // Signers
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let nonOwner: SignerWithAddress;
  let azoriusAddress: string;
  let tokenHolder1: SignerWithAddress;
  let hatWearer: SignerWithAddress;
  let nonHatWearer: SignerWithAddress;
  let lightAccountFactoryMock: SignerWithAddress;

  // Contracts
  let linearERC721VotingWithHatsProposalCreationImplementation: LinearERC721VotingWithHatsProposalCreationV1;
  let linearERC721VotingWithHatsProposalCreation: LinearERC721VotingWithHatsProposalCreationV1;
  let mockNFT1: MockERC721;
  let mockNFT2: MockERC721;
  let mockHats: MockHats;

  // Constants
  const VOTING_PERIOD = 100; // blocks
  const QUORUM_THRESHOLD = 5; // 5 votes required for quorum
  const BASIS_NUMERATOR = 500000; // 50% of 1000000

  // Hat IDs - we can use any arbitrary values
  const proposerHatId1 = 1n;
  const proposerHatId2 = 2n;
  const nonProposerHatId = 3n;

  async function deployLinearERC721VotingWithHatsProposalCreation(
    implementation: LinearERC721VotingWithHatsProposalCreationV1,
    strategyOwner: SignerWithAddress,
    nftAddresses: string[],
    nftWeights: number[],
    azoriusAddr: string,
    hatsContract: MockHats,
    initialWhitelistedHats: bigint[],
    lightAccountFactoryAddress: string,
  ): Promise<LinearERC721VotingWithHatsProposalCreationV1> {
    // Create the initialization data using the interface
    const linearVotingParams = {
      tokens: nftAddresses,
      weights: nftWeights,
      azoriusModule: azoriusAddr,
      votingPeriod: VOTING_PERIOD,
      quorumThreshold: QUORUM_THRESHOLD,
      basisNumerator: BASIS_NUMERATOR,
      lightAccountFactory: lightAccountFactoryAddress,
    };

    const hatsParams = {
      hatsContract: await hatsContract.getAddress(),
      initialWhitelistedHats: initialWhitelistedHats,
    };

    const initializeCalldata = implementation.interface.encodeFunctionData(
      'initialize(address,(address[],uint256[],address,uint32,uint256,uint256,address),(address,uint256[]))',
      [strategyOwner.address, linearVotingParams, hatsParams],
    );

    // Deploy the proxy with owner as the deployer
    const proxy = await new ERC1967Proxy__factory(strategyOwner).deploy(
      await implementation.getAddress(),
      initializeCalldata,
    );

    // Connect the proxy to the contract owner
    return LinearERC721VotingWithHatsProposalCreationV1__factory.connect(
      await proxy.getAddress(),
      strategyOwner,
    );
  }

  beforeEach(async () => {
    [deployer, owner, nonOwner, tokenHolder1, hatWearer, nonHatWearer, lightAccountFactoryMock] =
      await ethers.getSigners();

    // Use nonOwner address as a mock azorius address for testing
    azoriusAddress = await nonOwner.getAddress();

    // Deploy MockERC721 NFTs
    mockNFT1 = await new MockERC721__factory(deployer).deploy();
    mockNFT2 = await new MockERC721__factory(deployer).deploy();

    // Deploy MockHats
    mockHats = await new MockHats__factory(deployer).deploy();

    // Deploy LinearERC721VotingWithHatsProposalCreation implementation
    linearERC721VotingWithHatsProposalCreationImplementation =
      await new LinearERC721VotingWithHatsProposalCreationV1__factory(deployer).deploy();

    // Deploy LinearERC721VotingWithHatsProposalCreation strategy with proposerHatId1 and proposerHatId2 whitelisted
    // Create an array of NFT addresses
    const nftAddresses = [await mockNFT1.getAddress(), await mockNFT2.getAddress()];
    const nftWeights = [1, 2]; // Each NFT2 token counts as 2 votes

    linearERC721VotingWithHatsProposalCreation =
      await deployLinearERC721VotingWithHatsProposalCreation(
        linearERC721VotingWithHatsProposalCreationImplementation,
        owner,
        nftAddresses,
        nftWeights,
        azoriusAddress,
        mockHats,
        [proposerHatId1, proposerHatId2],
        lightAccountFactoryMock.address,
      );
  });

  describe('Contract-Specific Functionality', () => {
    describe('initialization', () => {
      it('should initialize with correct parameters from both parent contracts', async () => {
        // Check LinearERC721VotingV1 parameters
        const ownerAddress = await linearERC721VotingWithHatsProposalCreation.owner();
        expect(ownerAddress).to.equal(owner.address);

        const votingPeriod = await linearERC721VotingWithHatsProposalCreation.votingPeriod();
        expect(votingPeriod).to.equal(VOTING_PERIOD);

        const quorumThreshold = await linearERC721VotingWithHatsProposalCreation.quorumThreshold();
        expect(quorumThreshold).to.equal(QUORUM_THRESHOLD);

        // Check vote token configuration
        const nftAddresses = [await mockNFT1.getAddress(), await mockNFT2.getAddress()];
        for (let i = 0; i < nftAddresses.length; i++) {
          const weight = await linearERC721VotingWithHatsProposalCreation.tokenWeights(
            nftAddresses[i],
          );
          expect(weight).to.equal(i === 0 ? 1 : 2); // NFT1 weight = 1, NFT2 weight = 2
        }

        // proposerThreshold should be 0 since we're using hats
        const threshold = await linearERC721VotingWithHatsProposalCreation.proposerThreshold();
        expect(threshold).to.equal(0);

        // Check HatsProposalCreationWhitelistV1 parameters
        const hatsContract = await linearERC721VotingWithHatsProposalCreation.hatsContract();
        expect(hatsContract).to.equal(await mockHats.getAddress());

        // Check whitelisted hats
        const whitelistedHats =
          await linearERC721VotingWithHatsProposalCreation.getWhitelistedHatIds();
        expect(whitelistedHats.length).to.equal(2);
        expect(whitelistedHats[0]).to.equal(proposerHatId1);
        expect(whitelistedHats[1]).to.equal(proposerHatId2);

        // Check light account factory address
        const factoryAddress =
          await linearERC721VotingWithHatsProposalCreation.lightAccountFactory();
        expect(factoryAddress).to.equal(lightAccountFactoryMock.address);
      });

      it('should not allow reinitialization', async () => {
        const nftAddresses = [await mockNFT1.getAddress(), await mockNFT2.getAddress()];
        const nftWeights = [1, 2];

        const linearVotingParams = {
          tokens: nftAddresses,
          weights: nftWeights,
          azoriusModule: azoriusAddress,
          votingPeriod: VOTING_PERIOD,
          quorumThreshold: QUORUM_THRESHOLD,
          basisNumerator: BASIS_NUMERATOR,
          lightAccountFactory: lightAccountFactoryMock.address,
        };

        const hatsParams = {
          hatsContract: await mockHats.getAddress(),
          initialWhitelistedHats: [proposerHatId1, proposerHatId2],
        };

        // Create initialization data for a second attempt
        const initializeCalldata =
          linearERC721VotingWithHatsProposalCreationImplementation.interface.encodeFunctionData(
            'initialize(address,(address[],uint256[],address,uint32,uint256,uint256,address),(address,uint256[]))',
            [owner.address, linearVotingParams, hatsParams],
          );

        // Try to initialize directly through the proxy - should revert
        await expect(
          owner.sendTransaction({
            to: await linearERC721VotingWithHatsProposalCreation.getAddress(),
            data: initializeCalldata,
          }),
        ).to.be.reverted;
      });
    });

    describe('isProposer override', () => {
      runHatsProposerTests({
        getMockHats: () => mockHats,
        getContract: () => linearERC721VotingWithHatsProposalCreation,
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
        expect(await linearERC721VotingWithHatsProposalCreation.getVersion()).to.equal(1);
      });
    });

    describe('ERC165', function () {
      let iERC721VotingStrategyV1InterfaceId: string;
      let iBaseVotingBasisPercentV1InterfaceId: string;
      let iBaseStrategyV1InterfaceId: string;
      let iHatsProposalCreationWhitelistV1InterfaceId: string;
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
          await linearERC721VotingWithHatsProposalCreation.supportsInterface(iERC165InterfaceId);
        void expect(supported).to.be.true;
      });

      it('Should support IERC721VotingStrategyV1 interface', async function () {
        const supported = await linearERC721VotingWithHatsProposalCreation.supportsInterface(
          iERC721VotingStrategyV1InterfaceId,
        );
        void expect(supported).to.be.true;
      });

      it('Should support IHatsProposalCreationWhitelistV1 interface', async function () {
        const supported = await linearERC721VotingWithHatsProposalCreation.supportsInterface(
          iHatsProposalCreationWhitelistV1InterfaceId,
        );
        void expect(supported).to.be.true;
      });

      it('Should support IBaseVotingBasisPercentV1 interface', async function () {
        const supported = await linearERC721VotingWithHatsProposalCreation.supportsInterface(
          iBaseVotingBasisPercentV1InterfaceId,
        );
        void expect(supported).to.be.true;
      });

      it('Should support IBaseStrategyV1 interface', async function () {
        const supported = await linearERC721VotingWithHatsProposalCreation.supportsInterface(
          iBaseStrategyV1InterfaceId,
        );
        void expect(supported).to.be.true;
      });

      it('Should support IVersion interface', async function () {
        const supported =
          await linearERC721VotingWithHatsProposalCreation.supportsInterface(iVersionInterfaceId);
        void expect(supported).to.be.true;
      });

      it('Should not support random interface', async function () {
        const randomInterfaceId = '0x12345678';
        const supported =
          await linearERC721VotingWithHatsProposalCreation.supportsInterface(randomInterfaceId);
        void expect(supported).to.be.false;
      });
    });
  });

  describe('Version', () => {
    it('should return the correct version number', async () => {
      expect(await linearERC721VotingWithHatsProposalCreation.getVersion()).to.equal(1);
    });
  });

  describe('UUPS Upgradeability', function () {
    runUUPSUpgradeabilityTests({
      getContract: () => linearERC721VotingWithHatsProposalCreation,
      createNewImplementation: async () => {
        const newImplementation = await new LinearERC721VotingWithHatsProposalCreationV1__factory(
          owner,
        ).deploy();
        return newImplementation;
      },
      owner: () => owner,
      nonOwner: () => nonOwner,
    });
  });
});
