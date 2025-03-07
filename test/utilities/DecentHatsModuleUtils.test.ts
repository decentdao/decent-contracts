import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC6551Registry,
  ERC6551Registry__factory,
  GnosisSafeL2,
  GnosisSafeL2__factory,
  KeyValuePairs,
  KeyValuePairs__factory,
  MockDecentHatsModuleUtils,
  MockDecentHatsModuleUtils__factory,
  MockERC20,
  MockERC20__factory,
  MockHats,
  MockHats__factory,
  MockHatsAccount,
  MockHatsAccount__factory,
  MockHatsModuleFactory,
  MockHatsModuleFactory__factory,
  MockSablierV2LockupLinear,
  MockSablierV2LockupLinear__factory,
} from '../../typechain-types';
import {
  getGnosisSafeL2Singleton,
  getGnosisSafeProxyFactory,
} from '../global/GlobalSafeDeployments.test';
import {
  executeSafeTransaction,
  getHatAccount,
  predictGnosisSafeAddress,
  topHatIdToHatId,
} from '../helpers';

describe('DecentHatsModuleUtils', () => {
  let deployer: SignerWithAddress;
  let safeSigner: SignerWithAddress;
  let wearer: SignerWithAddress;

  let mockHats: MockHats;
  let mockDecentHatsModuleUtils: MockDecentHatsModuleUtils;
  let erc6551Registry: ERC6551Registry;
  let mockHatsAccount: MockHatsAccount;
  let mockHatsModuleFactory: MockHatsModuleFactory;
  let mockSablier: MockSablierV2LockupLinear;
  let mockERC20: MockERC20;
  let gnosisSafe: GnosisSafeL2;
  let gnosisSafeAddress: string;
  let keyValuePairs: KeyValuePairs;
  let keyValuePairsAddress: string;

  let topHatId: bigint;
  let topHatAccount: string;
  let adminHatId: bigint;
  let mockHatsElectionsEligibilityImplementationAddress: string;

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    [deployer, safeSigner, wearer] = signers;

    // Deploy mock contracts
    mockHats = await new MockHats__factory(deployer).deploy();
    mockDecentHatsModuleUtils = await new MockDecentHatsModuleUtils__factory(deployer).deploy();
    erc6551Registry = await new ERC6551Registry__factory(deployer).deploy();
    mockHatsAccount = await new MockHatsAccount__factory(deployer).deploy();
    mockHatsModuleFactory = await new MockHatsModuleFactory__factory(deployer).deploy();
    mockSablier = await new MockSablierV2LockupLinear__factory(deployer).deploy();
    mockERC20 = await new MockERC20__factory(deployer).deploy();
    // deploy keyValuePairs contract
    keyValuePairs = await new KeyValuePairs__factory(deployer).deploy();
    keyValuePairsAddress = await keyValuePairs.getAddress();
    // Deploy Safe
    const gnosisSafeProxyFactory = getGnosisSafeProxyFactory();
    const gnosisSafeL2Singleton = getGnosisSafeL2Singleton();
    const gnosisSafeL2SingletonAddress = await gnosisSafeL2Singleton.getAddress();

    const createGnosisSetupCalldata = GnosisSafeL2__factory.createInterface().encodeFunctionData(
      'setup',
      [
        [safeSigner.address],
        1,
        ethers.ZeroAddress,
        ethers.ZeroHash,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        0,
        ethers.ZeroAddress,
      ],
    );
    const saltNum = BigInt(`0x${Buffer.from(ethers.randomBytes(32)).toString('hex')}`);

    const predictedGnosisSafeAddress = await predictGnosisSafeAddress(
      createGnosisSetupCalldata,
      saltNum,
      gnosisSafeL2SingletonAddress,
      gnosisSafeProxyFactory,
    );
    gnosisSafeAddress = predictedGnosisSafeAddress;

    await gnosisSafeProxyFactory.createProxyWithNonce(
      gnosisSafeL2SingletonAddress,
      createGnosisSetupCalldata,
      saltNum,
    );

    gnosisSafe = GnosisSafeL2__factory.connect(predictedGnosisSafeAddress, deployer);

    // Create top hat and admin hat
    await executeSafeTransaction({
      safe: gnosisSafe,
      to: await mockHats.getAddress(),
      transactionData: MockHats__factory.createInterface().encodeFunctionData('mintTopHat', [
        gnosisSafeAddress,
        '',
        '',
      ]),
      signers: [safeSigner],
    });

    topHatId = topHatIdToHatId(await mockHats.lastTopHatId());
    adminHatId = await mockHats.getNextId(topHatId);

    topHatAccount = await (
      await getHatAccount(
        topHatId,
        erc6551Registry,
        await mockHatsAccount.getAddress(),
        await mockHats.getAddress(),
      )
    ).getAddress();

    // Create admin hat
    await executeSafeTransaction({
      safe: gnosisSafe,
      to: await mockHats.getAddress(),
      transactionData: MockHats__factory.createInterface().encodeFunctionData('createHat', [
        topHatId,
        '',
        1,
        await mockHats.getAddress(),
        await mockHats.getAddress(),
        false,
        '',
      ]),
      signers: [safeSigner],
    });

    // Deploy mock eligibility implementation
    const MockHatsElectionsEligibility = await ethers.getContractFactory(
      'MockHatsElectionsEligibility',
    );
    const mockHatsElectionsEligibility = await MockHatsElectionsEligibility.deploy();
    mockHatsElectionsEligibilityImplementationAddress =
      await mockHatsElectionsEligibility.getAddress();

    // Mint tokens to mockDecentHatsUtils for Sablier streams
    await mockERC20.mint(await gnosisSafe.getAddress(), ethers.parseEther('1000000'));

    await executeSafeTransaction({
      safe: gnosisSafe,
      to: gnosisSafeAddress,
      transactionData: GnosisSafeL2__factory.createInterface().encodeFunctionData('enableModule', [
        await mockDecentHatsModuleUtils.getAddress(),
      ]),
      signers: [safeSigner],
    });
  });

  describe('processHat', () => {
    it('Creates an untermed hat with no streams', async () => {
      const hatParams = {
        wearer: wearer.address,
        details: '',
        imageURI: '',
        sablierStreamsParams: [],
        termEndDateTs: 0n,
        maxSupply: 1,
        isMutable: false,
      };

      const roleHatId = await mockHats.getNextId(adminHatId);
      await executeSafeTransaction({
        safe: gnosisSafe,
        to: await mockDecentHatsModuleUtils.getAddress(),
        transactionData: MockDecentHatsModuleUtils__factory.createInterface().encodeFunctionData(
          'processRoleHats',
          [
            {
              hatsProtocol: await mockHats.getAddress(),
              erc6551Registry: await erc6551Registry.getAddress(),
              hatsAccountImplementation: await mockHatsAccount.getAddress(),
              topHatId,
              topHatAccount,
              hatsModuleFactory: await mockHatsModuleFactory.getAddress(),
              hatsElectionsEligibilityImplementation:
                mockHatsElectionsEligibilityImplementationAddress,
              adminHatId,
              hats: [hatParams],
              keyValuePairs: keyValuePairsAddress,
            },
          ],
        ),
        signers: [safeSigner],
      });
      const hatAccount = await getHatAccount(
        roleHatId,
        erc6551Registry,
        await mockHatsAccount.getAddress(),
        await mockHats.getAddress(),
      );
      expect(await hatAccount.tokenId()).to.equal(roleHatId);
      expect(await hatAccount.tokenImplementation()).to.equal(await mockHats.getAddress());
    });

    it('Creates a termed hat with no streams', async () => {
      const termEndDateTs = BigInt(Math.floor(Date.now() / 1000) + 100000);
      const hatParams = {
        wearer: wearer.address,
        details: '',
        imageURI: '',
        sablierStreamsParams: [],
        termEndDateTs,
        maxSupply: 1,
        isMutable: false,
      };

      const roleHatId = await mockHats.getNextId(adminHatId);
      await executeSafeTransaction({
        safe: gnosisSafe,
        to: await mockDecentHatsModuleUtils.getAddress(),
        transactionData: MockDecentHatsModuleUtils__factory.createInterface().encodeFunctionData(
          'processRoleHats',
          [
            {
              hatsProtocol: await mockHats.getAddress(),
              erc6551Registry: await erc6551Registry.getAddress(),
              hatsAccountImplementation: await mockHatsAccount.getAddress(),
              topHatId,
              topHatAccount,
              hatsModuleFactory: await mockHatsModuleFactory.getAddress(),
              hatsElectionsEligibilityImplementation:
                mockHatsElectionsEligibilityImplementationAddress,
              adminHatId,
              hats: [hatParams],
              keyValuePairs: keyValuePairsAddress,
            },
          ],
        ),
        signers: [safeSigner],
      });

      expect(await mockHats.isWearerOfHat.staticCall(wearer.address, roleHatId)).to.equal(true);
      expect(await mockHats.getHatEligibilityModule(roleHatId)).to.not.equal(ethers.ZeroAddress);
    });

    it('Creates an untermed hat with a stream', async () => {
      const currentBlockTimestamp = await time.latest();
      const hatParams = {
        wearer: wearer.address,
        details: '',
        imageURI: '',
        sablierStreamsParams: [
          {
            sablier: await mockSablier.getAddress(),
            sender: await mockDecentHatsModuleUtils.getAddress(),
            asset: await mockERC20.getAddress(),
            timestamps: {
              start: currentBlockTimestamp,
              cliff: 0,
              end: currentBlockTimestamp + 2592000, // 30 days
            },
            broker: { account: ethers.ZeroAddress, fee: 0 },
            totalAmount: ethers.parseEther('100'),
            cancelable: true,
            transferable: false,
          },
        ],
        termEndDateTs: 0n,
        maxSupply: 1,
        isMutable: false,
      };

      const processRoleHatTx = await executeSafeTransaction({
        safe: gnosisSafe,
        to: await mockDecentHatsModuleUtils.getAddress(),
        transactionData: MockDecentHatsModuleUtils__factory.createInterface().encodeFunctionData(
          'processRoleHats',
          [
            {
              hatsProtocol: await mockHats.getAddress(),
              erc6551Registry: await erc6551Registry.getAddress(),
              hatsAccountImplementation: await mockHatsAccount.getAddress(),
              topHatId,
              topHatAccount,
              hatsModuleFactory: await mockHatsModuleFactory.getAddress(),
              hatsElectionsEligibilityImplementation:
                mockHatsElectionsEligibilityImplementationAddress,
              adminHatId,
              hats: [hatParams],
              keyValuePairs: keyValuePairsAddress,
            },
          ],
        ),
        signers: [safeSigner],
      });

      const streamCreatedEvents = await mockSablier.queryFilter(
        mockSablier.filters.StreamCreated(),
      );
      expect(streamCreatedEvents.length).to.equal(1);

      const stream1 = await mockSablier.getStream(streamCreatedEvents[0].args.streamId);
      expect(stream1.startTime).to.equal(currentBlockTimestamp);
      expect(stream1.endTime).to.equal(currentBlockTimestamp + 2592000);

      // get the last hat created event
      const hatCreatedEvents = await mockHats.queryFilter(mockHats.filters.HatCreated());
      const hatId = hatCreatedEvents[hatCreatedEvents.length - 1].args.id;
      const event = streamCreatedEvents[0];

      expect(event.args.sender).to.equal(await mockDecentHatsModuleUtils.getAddress());
      expect(event.args.totalAmount).to.equal(ethers.parseEther('100'));
      const expectedResult = `${hatId}:${streamCreatedEvents[0].args.streamId}`;
      await expect(processRoleHatTx)
        .to.emit(keyValuePairs, 'ValueUpdated')
        .withArgs(gnosisSafeAddress, 'hatIdToStreamId', expectedResult);
    });

    it('Creates a termed hat with a stream', async () => {
      const currentBlockTimestamp = await time.latest();
      const termEndDateTs = BigInt(Math.floor(Date.now() / 1000) + 100000);
      const hatParams = {
        wearer: wearer.address,
        details: '',
        imageURI: '',
        sablierStreamsParams: [
          {
            sablier: await mockSablier.getAddress(),
            sender: await mockDecentHatsModuleUtils.getAddress(),
            asset: await mockERC20.getAddress(),
            timestamps: {
              start: currentBlockTimestamp,
              cliff: 0,
              end: currentBlockTimestamp + 2592000, // 30 days
            },
            broker: { account: ethers.ZeroAddress, fee: 0 },
            totalAmount: ethers.parseEther('100'),
            cancelable: true,
            transferable: false,
          },
        ],
        termEndDateTs,
        maxSupply: 1,
        isMutable: false,
      };

      const roleHatId = await mockHats.getNextId(adminHatId);
      const processRoleHatTx = await executeSafeTransaction({
        safe: gnosisSafe,
        to: await mockDecentHatsModuleUtils.getAddress(),
        transactionData: MockDecentHatsModuleUtils__factory.createInterface().encodeFunctionData(
          'processRoleHats',
          [
            {
              hatsProtocol: await mockHats.getAddress(),
              erc6551Registry: await erc6551Registry.getAddress(),
              hatsAccountImplementation: await mockHatsAccount.getAddress(),
              topHatId,
              topHatAccount,
              hatsModuleFactory: await mockHatsModuleFactory.getAddress(),
              hatsElectionsEligibilityImplementation:
                mockHatsElectionsEligibilityImplementationAddress,
              adminHatId,
              hats: [hatParams],
              keyValuePairs: keyValuePairsAddress,
            },
          ],
        ),
        signers: [safeSigner],
      });

      expect(await mockHats.isWearerOfHat.staticCall(wearer.address, roleHatId)).to.equal(true);
      expect(await mockHats.getHatEligibilityModule(roleHatId)).to.not.equal(ethers.ZeroAddress);

      const streamCreatedEvents = await mockSablier.queryFilter(
        mockSablier.filters.StreamCreated(),
      );
      expect(streamCreatedEvents.length).to.equal(1);

      const stream1 = await mockSablier.getStream(streamCreatedEvents[0].args.streamId);
      expect(stream1.startTime).to.equal(currentBlockTimestamp);
      expect(stream1.endTime).to.equal(currentBlockTimestamp + 2592000);

      // get the last hat created event
      const hatCreatedEvents = await mockHats.queryFilter(mockHats.filters.HatCreated());
      const hatId = hatCreatedEvents[hatCreatedEvents.length - 1].args.id;
      const event = streamCreatedEvents[0];

      expect(event.args.sender).to.equal(await mockDecentHatsModuleUtils.getAddress());
      expect(event.args.totalAmount).to.equal(ethers.parseEther('100'));
      const expectedResult = `${hatId}:${streamCreatedEvents[0].args.streamId}`;
      await expect(processRoleHatTx)
        .to.emit(keyValuePairs, 'ValueUpdated')
        .withArgs(gnosisSafeAddress, 'hatIdToStreamId', expectedResult);
    });
  });

  describe('SALT', () => {
    it('should be a static hardcoded value that never changes for any reason', async () => {
      expect(await mockDecentHatsModuleUtils.SALT()).to.equal(
        '0x5d0e6ce4fd951366cc55da93f6e79d8b81483109d79676a04bcc2bed6a4b5072',
      );
    });
  });
});
