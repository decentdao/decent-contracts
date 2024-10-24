import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import hre, { ethers } from 'hardhat';
import {
  GnosisSafeL2,
  GnosisSafeL2__factory,
  DecentHats_0_1_0__factory,
  KeyValuePairs,
  KeyValuePairs__factory,
  MockHats__factory,
  ERC6551Registry__factory,
  MockHatsAccount__factory,
  ERC6551Registry,
  DecentHats_0_1_0,
  MockHatsAccount,
  MockHats,
  MockSablierV2LockupLinear__factory,
  MockSablierV2LockupLinear,
  MockERC20__factory,
  MockERC20,
} from '../typechain-types';

import { getGnosisSafeL2Singleton, getGnosisSafeProxyFactory } from './GlobalSafeDeployments.test';
import { executeSafeTransaction, getHatAccount, predictGnosisSafeAddress } from './helpers';

describe('DecentHats_0_1_0', () => {
  let dao: SignerWithAddress;

  let mockHats: MockHats;
  let mockHatsAddress: string;

  let keyValuePairs: KeyValuePairs;
  let gnosisSafe: GnosisSafeL2;

  let decentHats: DecentHats_0_1_0;
  let decentHatsAddress: string;

  let gnosisSafeAddress: string;
  let erc6551Registry: ERC6551Registry;

  let mockHatsAccountImplementation: MockHatsAccount;
  let mockHatsAccountImplementationAddress: string;

  let mockSablier: MockSablierV2LockupLinear;
  let mockSablierAddress: string;

  let mockERC20: MockERC20;
  let mockERC20Address: string;

  beforeEach(async () => {
    const signers = await hre.ethers.getSigners();
    const [deployer] = signers;
    [, dao] = signers;

    mockHats = await new MockHats__factory(deployer).deploy();
    mockHatsAddress = await mockHats.getAddress();
    keyValuePairs = await new KeyValuePairs__factory(deployer).deploy();
    erc6551Registry = await new ERC6551Registry__factory(deployer).deploy();
    mockHatsAccountImplementation = await new MockHatsAccount__factory(deployer).deploy();
    mockHatsAccountImplementationAddress = await mockHatsAccountImplementation.getAddress();
    decentHats = await new DecentHats_0_1_0__factory(deployer).deploy();
    decentHatsAddress = await decentHats.getAddress();

    const gnosisSafeProxyFactory = getGnosisSafeProxyFactory();
    const gnosisSafeL2Singleton = getGnosisSafeL2Singleton();
    const gnosisSafeL2SingletonAddress = await gnosisSafeL2Singleton.getAddress();

    const createGnosisSetupCalldata = GnosisSafeL2__factory.createInterface().encodeFunctionData(
      'setup',
      [
        [dao.address],
        1,
        hre.ethers.ZeroAddress,
        hre.ethers.ZeroHash,
        hre.ethers.ZeroAddress,
        hre.ethers.ZeroAddress,
        0,
        hre.ethers.ZeroAddress,
      ],
    );

    const saltNum = BigInt(`0x${Buffer.from(hre.ethers.randomBytes(32)).toString('hex')}`);

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

    // Deploy MockSablierV2LockupLinear
    mockSablier = await new MockSablierV2LockupLinear__factory(deployer).deploy();
    mockSablierAddress = await mockSablier.getAddress();

    mockERC20 = await new MockERC20__factory(deployer).deploy('MockERC20', 'MCK');
    mockERC20Address = await mockERC20.getAddress();

    await mockERC20.mint(gnosisSafeAddress, ethers.parseEther('1000000'));
  });

  describe('DecentHats', () => {
    let enableModuleTx: ethers.ContractTransactionResponse;

    beforeEach(async () => {
      enableModuleTx = await executeSafeTransaction({
        safe: gnosisSafe,
        to: gnosisSafeAddress,
        transactionData: GnosisSafeL2__factory.createInterface().encodeFunctionData(
          'enableModule',
          [decentHatsAddress],
        ),
        signers: [dao],
      });
    });

    describe('Enabled as a module', () => {
      it('Emits an ExecutionSuccess event', async () => {
        await expect(enableModuleTx).to.emit(gnosisSafe, 'ExecutionSuccess');
      });

      it('Emits an EnabledModule event', async () => {
        await expect(enableModuleTx)
          .to.emit(gnosisSafe, 'EnabledModule')
          .withArgs(decentHatsAddress);
      });
    });

    describe('Creating a new Top Hat and Tree', () => {
      let createAndDeclareTreeTx: ethers.ContractTransactionResponse;

      beforeEach(async () => {
        createAndDeclareTreeTx = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentHatsAddress,
          transactionData: DecentHats_0_1_0__factory.createInterface().encodeFunctionData(
            'createAndDeclareTree',
            [
              {
                hatsProtocol: mockHatsAddress,
                hatsAccountImplementation: mockHatsAccountImplementationAddress,
                registry: await erc6551Registry.getAddress(),
                keyValuePairs: await keyValuePairs.getAddress(),
                topHatDetails: '',
                topHatImageURI: '',
                adminHat: {
                  maxSupply: 1,
                  details: '',
                  imageURI: '',
                  isMutable: false,
                  wearer: ethers.ZeroAddress,
                  sablierParams: [],
                },
                hats: [
                  {
                    maxSupply: 1,
                    details: '',
                    imageURI: '',
                    isMutable: false,
                    wearer: ethers.ZeroAddress,
                    sablierParams: [],
                  },
                  {
                    maxSupply: 1,
                    details: '',
                    imageURI: '',
                    isMutable: false,
                    wearer: ethers.ZeroAddress,
                    sablierParams: [],
                  },
                ],
              },
            ],
          ),
          signers: [dao],
        });
      });

      it('Emits an ExecutionSuccess event', async () => {
        await expect(createAndDeclareTreeTx).to.emit(gnosisSafe, 'ExecutionSuccess');
      });

      it('Emits an ExecutionFromModuleSuccess event', async () => {
        await expect(createAndDeclareTreeTx)
          .to.emit(gnosisSafe, 'ExecutionFromModuleSuccess')
          .withArgs(decentHatsAddress);
      });

      it('Emits some hatsTreeId ValueUpdated events', async () => {
        await expect(createAndDeclareTreeTx)
          .to.emit(keyValuePairs, 'ValueUpdated')
          .withArgs(gnosisSafeAddress, 'topHatId', '0');
      });

      describe('Multiple calls', () => {
        let createAndDeclareTreeTx2: ethers.ContractTransactionResponse;

        beforeEach(async () => {
          createAndDeclareTreeTx2 = await executeSafeTransaction({
            safe: gnosisSafe,
            to: decentHatsAddress,
            transactionData: DecentHats_0_1_0__factory.createInterface().encodeFunctionData(
              'createAndDeclareTree',
              [
                {
                  hatsProtocol: mockHatsAddress,
                  hatsAccountImplementation: mockHatsAccountImplementationAddress,
                  registry: await erc6551Registry.getAddress(),
                  keyValuePairs: await keyValuePairs.getAddress(),
                  topHatDetails: '',
                  topHatImageURI: '',
                  adminHat: {
                    maxSupply: 1,
                    details: '',
                    imageURI: '',
                    isMutable: false,
                    wearer: ethers.ZeroAddress,
                    sablierParams: [],
                  },
                  hats: [],
                },
              ],
            ),
            signers: [dao],
          });
        });

        it('Emits an ExecutionSuccess event', async () => {
          await expect(createAndDeclareTreeTx2).to.emit(gnosisSafe, 'ExecutionSuccess');
        });

        it('Emits an ExecutionFromModuleSuccess event', async () => {
          await expect(createAndDeclareTreeTx2)
            .to.emit(gnosisSafe, 'ExecutionFromModuleSuccess')
            .withArgs(decentHatsAddress);
        });

        it('Creates Top Hats with sequential IDs', async () => {
          await expect(createAndDeclareTreeTx2)
            .to.emit(keyValuePairs, 'ValueUpdated')
            .withArgs(gnosisSafeAddress, 'topHatId', '4');
        });
      });

      describe('Creating Hats Accounts', () => {
        it('Generates the correct Addresses for the current Hats', async () => {
          const currentCount = await mockHats.count();

          for (let i = 0n; i < currentCount; i++) {
            const topHatAccount = await getHatAccount(
              i,
              erc6551Registry,
              mockHatsAccountImplementationAddress,
              mockHatsAddress,
            );

            expect(await topHatAccount.tokenId()).eq(i);
            expect(await topHatAccount.tokenImplementation()).eq(mockHatsAddress);
          }
        });
      });
    });

    describe('Creating a new Top Hat and Tree with Sablier Streams', () => {
      let createAndDeclareTreeTx: ethers.ContractTransactionResponse;
      let currentBlockTimestamp: number;

      beforeEach(async () => {
        currentBlockTimestamp = (await hre.ethers.provider.getBlock('latest'))!.timestamp;

        createAndDeclareTreeTx = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentHatsAddress,
          transactionData: DecentHats_0_1_0__factory.createInterface().encodeFunctionData(
            'createAndDeclareTree',
            [
              {
                hatsProtocol: mockHatsAddress,
                hatsAccountImplementation: mockHatsAccountImplementationAddress,
                registry: await erc6551Registry.getAddress(),
                keyValuePairs: await keyValuePairs.getAddress(),
                topHatDetails: '',
                topHatImageURI: '',
                adminHat: {
                  maxSupply: 1,
                  details: '',
                  imageURI: '',
                  isMutable: false,
                  wearer: ethers.ZeroAddress,
                  sablierParams: [],
                },
                hats: [
                  {
                    maxSupply: 1,
                    details: '',
                    imageURI: '',
                    isMutable: false,
                    wearer: ethers.ZeroAddress,
                    sablierParams: [
                      {
                        sablier: mockSablierAddress,
                        sender: gnosisSafeAddress,
                        totalAmount: ethers.parseEther('100'),
                        asset: mockERC20Address,
                        cancelable: true,
                        transferable: false,
                        timestamps: {
                          start: currentBlockTimestamp,
                          cliff: 0,
                          end: currentBlockTimestamp + 2592000, // 30 days from now
                        },
                        broker: { account: ethers.ZeroAddress, fee: 0 },
                      },
                    ],
                  },
                  {
                    maxSupply: 1,
                    details: '',
                    imageURI: '',
                    isMutable: false,
                    wearer: ethers.ZeroAddress,
                    sablierParams: [],
                  },
                ],
              },
            ],
          ),
          signers: [dao],
        });
      });

      it('Emits an ExecutionSuccess event', async () => {
        await expect(createAndDeclareTreeTx).to.emit(gnosisSafe, 'ExecutionSuccess');
      });

      it('Emits an ExecutionFromModuleSuccess event', async () => {
        await expect(createAndDeclareTreeTx)
          .to.emit(gnosisSafe, 'ExecutionFromModuleSuccess')
          .withArgs(decentHatsAddress);
      });

      it('Emits some hatsTreeId ValueUpdated events', async () => {
        await expect(createAndDeclareTreeTx)
          .to.emit(keyValuePairs, 'ValueUpdated')
          .withArgs(gnosisSafeAddress, 'topHatId', '0');
      });

      it('Creates a Sablier stream for the hat with stream parameters', async () => {
        const streamCreatedEvents = await mockSablier.queryFilter(
          mockSablier.filters.StreamCreated(),
        );
        expect(streamCreatedEvents.length).to.equal(1);

        const event = streamCreatedEvents[0];
        expect(event.args.sender).to.equal(gnosisSafeAddress);
        expect(event.args.recipient).to.not.equal(ethers.ZeroAddress);
        expect(event.args.totalAmount).to.equal(ethers.parseEther('100'));
      });

      it('Does not create a Sablier stream for hats without stream parameters', async () => {
        const streamCreatedEvents = await mockSablier.queryFilter(
          mockSablier.filters.StreamCreated(),
        );
        expect(streamCreatedEvents.length).to.equal(1); // Only one stream should be created
      });

      it('Creates a Sablier stream with correct timestamps', async () => {
        const streamCreatedEvents = await mockSablier.queryFilter(
          mockSablier.filters.StreamCreated(),
        );
        expect(streamCreatedEvents.length).to.equal(1);

        const streamId = streamCreatedEvents[0].args.streamId;
        const stream = await mockSablier.getStream(streamId);

        expect(stream.startTime).to.equal(currentBlockTimestamp);
        expect(stream.endTime).to.equal(currentBlockTimestamp + 2592000);
      });
    });

    describe('Creating a new Top Hat and Tree with Multiple Sablier Streams per Hat', () => {
      let currentBlockTimestamp: number;

      beforeEach(async () => {
        currentBlockTimestamp = (await hre.ethers.provider.getBlock('latest'))!.timestamp;

        await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentHatsAddress,
          transactionData: DecentHats_0_1_0__factory.createInterface().encodeFunctionData(
            'createAndDeclareTree',
            [
              {
                hatsProtocol: mockHatsAddress,
                hatsAccountImplementation: mockHatsAccountImplementationAddress,
                registry: await erc6551Registry.getAddress(),
                keyValuePairs: await keyValuePairs.getAddress(),
                topHatDetails: '',
                topHatImageURI: '',
                adminHat: {
                  maxSupply: 1,
                  details: '',
                  imageURI: '',
                  isMutable: false,
                  wearer: ethers.ZeroAddress,
                  sablierParams: [],
                },
                hats: [
                  {
                    maxSupply: 1,
                    details: '',
                    imageURI: '',
                    isMutable: false,
                    wearer: ethers.ZeroAddress,
                    sablierParams: [
                      {
                        sablier: mockSablierAddress,
                        sender: gnosisSafeAddress,
                        totalAmount: ethers.parseEther('100'),
                        asset: mockERC20Address,
                        cancelable: true,
                        transferable: false,
                        timestamps: {
                          start: currentBlockTimestamp,
                          cliff: currentBlockTimestamp + 86400, // 1 day cliff
                          end: currentBlockTimestamp + 2592000, // 30 days from now
                        },
                        broker: { account: ethers.ZeroAddress, fee: 0 },
                      },
                      {
                        sablier: mockSablierAddress,
                        sender: gnosisSafeAddress,
                        totalAmount: ethers.parseEther('50'),
                        asset: mockERC20Address,
                        cancelable: false,
                        transferable: true,
                        timestamps: {
                          start: currentBlockTimestamp,
                          cliff: 0, // No cliff
                          end: currentBlockTimestamp + 1296000, // 15 days from now
                        },
                        broker: { account: ethers.ZeroAddress, fee: 0 },
                      },
                    ],
                  },
                ],
              },
            ],
          ),
          signers: [dao],
        });
      });

      it('Creates multiple Sablier streams for a single hat', async () => {
        const streamCreatedEvents = await mockSablier.queryFilter(
          mockSablier.filters.StreamCreated(),
        );
        expect(streamCreatedEvents.length).to.equal(2);

        const event1 = streamCreatedEvents[0];
        expect(event1.args.sender).to.equal(gnosisSafeAddress);
        expect(event1.args.recipient).to.not.equal(ethers.ZeroAddress);
        expect(event1.args.totalAmount).to.equal(ethers.parseEther('100'));

        const event2 = streamCreatedEvents[1];
        expect(event2.args.sender).to.equal(gnosisSafeAddress);
        expect(event2.args.recipient).to.equal(event1.args.recipient);
        expect(event2.args.totalAmount).to.equal(ethers.parseEther('50'));
      });

      it('Creates streams with correct parameters', async () => {
        const streamCreatedEvents = await mockSablier.queryFilter(
          mockSablier.filters.StreamCreated(),
        );

        const stream1 = await mockSablier.getStream(streamCreatedEvents[0].args.streamId);
        expect(stream1.cancelable === true);
        expect(stream1.transferable === false);
        expect(stream1.endTime - stream1.startTime).to.equal(2592000);

        const stream2 = await mockSablier.getStream(streamCreatedEvents[1].args.streamId);
        expect(stream2.cancelable === false);
        expect(stream2.transferable === true);
        expect(stream2.endTime - stream2.startTime).to.equal(1296000);
      });

      it('Creates streams with correct timestamps', async () => {
        const streamCreatedEvents = await mockSablier.queryFilter(
          mockSablier.filters.StreamCreated(),
        );

        const stream1 = await mockSablier.getStream(streamCreatedEvents[0].args.streamId);
        expect(stream1.startTime).to.equal(currentBlockTimestamp);
        expect(stream1.endTime).to.equal(currentBlockTimestamp + 2592000);

        const stream2 = await mockSablier.getStream(streamCreatedEvents[1].args.streamId);
        expect(stream2.startTime).to.equal(currentBlockTimestamp);
        expect(stream2.endTime).to.equal(currentBlockTimestamp + 1296000);
      });
    });
  });
});
