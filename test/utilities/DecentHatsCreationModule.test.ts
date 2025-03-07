import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import type { ContractTransactionResponse } from 'ethers';
import { ethers } from 'hardhat';
import {
  GnosisSafeL2,
  GnosisSafeL2__factory,
  DecentHatsCreationModule__factory,
  KeyValuePairs,
  KeyValuePairs__factory,
  ERC6551Registry__factory,
  MockHatsAccount__factory,
  ERC6551Registry,
  DecentHatsCreationModule,
  MockHatsAccount,
  MockHats,
  MockHats__factory,
  MockSablierV2LockupLinear__factory,
  MockSablierV2LockupLinear,
  MockERC20__factory,
  MockERC20,
  DecentAutonomousAdminV1,
  DecentAutonomousAdminV1__factory,
  MockHatsElectionsEligibility__factory,
  MockHatsModuleFactory__factory,
  ModuleProxyFactory,
  ModuleProxyFactory__factory,
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

describe('DecentHatsCreationModule', () => {
  let dao: SignerWithAddress;

  let mockHats: MockHats;
  let mockHatsAddress: string;

  let keyValuePairs: KeyValuePairs;
  let gnosisSafe: GnosisSafeL2;

  let decentHatsCreationModule: DecentHatsCreationModule;
  let decentHatsCreationModuleAddress: string;

  let gnosisSafeAddress: string;
  let erc6551Registry: ERC6551Registry;

  let mockHatsAccountImplementation: MockHatsAccount;
  let mockHatsAccountImplementationAddress: string;

  let mockSablier: MockSablierV2LockupLinear;
  let mockSablierAddress: string;

  let mockERC20: MockERC20;
  let mockERC20Address: string;

  let mockHatsElectionsEligibilityImplementationAddress: string;
  let mockHatsModuleFactoryAddress: string;

  let moduleProxyFactory: ModuleProxyFactory;
  let decentAutonomousAdminMasterCopy: DecentAutonomousAdminV1;
  beforeEach(async () => {
    try {
      const signers = await ethers.getSigners();
      const [deployer] = signers;
      [, dao] = signers;

      mockHats = await new MockHats__factory(deployer).deploy();
      mockHatsAddress = await mockHats.getAddress();

      const mockHatsElectionsEligibilityImplementation =
        await new MockHatsElectionsEligibility__factory(deployer).deploy();
      mockHatsElectionsEligibilityImplementationAddress =
        await mockHatsElectionsEligibilityImplementation.getAddress();

      const mockHatsModuleFactory = await new MockHatsModuleFactory__factory(deployer).deploy();
      mockHatsModuleFactoryAddress = await mockHatsModuleFactory.getAddress();

      keyValuePairs = await new KeyValuePairs__factory(deployer).deploy();
      erc6551Registry = await new ERC6551Registry__factory(deployer).deploy();
      mockHatsAccountImplementation = await new MockHatsAccount__factory(deployer).deploy();
      mockHatsAccountImplementationAddress = await mockHatsAccountImplementation.getAddress();
      decentHatsCreationModule = await new DecentHatsCreationModule__factory(deployer).deploy();
      decentHatsCreationModuleAddress = await decentHatsCreationModule.getAddress();
      moduleProxyFactory = await new ModuleProxyFactory__factory(deployer).deploy();
      decentAutonomousAdminMasterCopy = await new DecentAutonomousAdminV1__factory(
        deployer,
      ).deploy();

      const gnosisSafeProxyFactory = getGnosisSafeProxyFactory();
      const gnosisSafeL2Singleton = getGnosisSafeL2Singleton();
      const gnosisSafeL2SingletonAddress = await gnosisSafeL2Singleton.getAddress();

      const createGnosisSetupCalldata = GnosisSafeL2__factory.createInterface().encodeFunctionData(
        'setup',
        [
          [dao.address],
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

      // Deploy MockSablierV2LockupLinear
      mockSablier = await new MockSablierV2LockupLinear__factory(deployer).deploy();
      mockSablierAddress = await mockSablier.getAddress();

      mockERC20 = await new MockERC20__factory(deployer).deploy();
      mockERC20Address = await mockERC20.getAddress();

      await mockERC20.mint(gnosisSafeAddress, ethers.parseEther('1000000'));
    } catch (e) {
      console.error('AHHHHHH', e);
    }
  });

  describe('DecentHats as a Module', () => {
    let enableModuleTx: ContractTransactionResponse;

    beforeEach(async () => {
      enableModuleTx = await executeSafeTransaction({
        safe: gnosisSafe,
        to: gnosisSafeAddress,
        transactionData: GnosisSafeL2__factory.createInterface().encodeFunctionData(
          'enableModule',
          [decentHatsCreationModuleAddress],
        ),
        signers: [dao],
      });
    });

    it('Emits an ExecutionSuccess event', async () => {
      await expect(enableModuleTx).to.emit(gnosisSafe, 'ExecutionSuccess');
    });

    it('Emits an EnabledModule event', async () => {
      await expect(enableModuleTx)
        .to.emit(gnosisSafe, 'EnabledModule')
        .withArgs(decentHatsCreationModuleAddress);
    });

    describe('Creating a new Top Hat and Tree', () => {
      let createAndDeclareTreeTx1: ContractTransactionResponse;

      let topHatId: bigint;
      let adminHatId: bigint;
      let roleHatIds: bigint[];

      beforeEach(async () => {
        const lastTopHatId = await mockHats.lastTopHatId();
        const thisTopHatId = lastTopHatId + 1n;
        topHatId = topHatIdToHatId(thisTopHatId);
        adminHatId = await mockHats.getNextId(topHatId);
        roleHatIds = [
          await mockHats.getNextId(adminHatId),
          await mockHats.getNextIdOffset(adminHatId, 1),
        ];

        createAndDeclareTreeTx1 = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentHatsCreationModuleAddress,
          transactionData: DecentHatsCreationModule__factory.createInterface().encodeFunctionData(
            'createAndDeclareTree',
            [
              {
                hatsProtocol: mockHatsAddress,
                erc6551Registry: await erc6551Registry.getAddress(),
                hatsModuleFactory: mockHatsModuleFactoryAddress,
                moduleProxyFactory: await moduleProxyFactory.getAddress(),
                decentAutonomousAdminImplementation:
                  await decentAutonomousAdminMasterCopy.getAddress(),
                hatsAccountImplementation: mockHatsAccountImplementationAddress,
                keyValuePairs: await keyValuePairs.getAddress(),
                hatsElectionsEligibilityImplementation:
                  mockHatsElectionsEligibilityImplementationAddress,
                topHat: {
                  details: '',
                  imageURI: '',
                },
                adminHat: {
                  details: '',
                  imageURI: '',
                  isMutable: false,
                },
                hats: [
                  {
                    wearer: ethers.ZeroAddress,
                    details: '',
                    imageURI: '',
                    maxSupply: 1,
                    isMutable: false,
                    termEndDateTs: 0,
                    sablierStreamsParams: [],
                  },
                  {
                    wearer: ethers.ZeroAddress,
                    details: '',
                    imageURI: '',
                    maxSupply: 1,
                    isMutable: false,
                    termEndDateTs: 0,
                    sablierStreamsParams: [],
                  },
                ],
              },
            ],
          ),
          signers: [dao],
        });
      });

      it('Emits an ExecutionSuccess event', async () => {
        await expect(createAndDeclareTreeTx1).to.emit(gnosisSafe, 'ExecutionSuccess');
      });

      it('Emits an ExecutionFromModuleSuccess event', async () => {
        await expect(createAndDeclareTreeTx1)
          .to.emit(gnosisSafe, 'ExecutionFromModuleSuccess')
          .withArgs(decentHatsCreationModuleAddress);
      });

      it('Leaves the Hats contract with a correct lastTopHatId', async () => {
        expect(await mockHats.lastTopHatId()).to.equal(1n);
      });

      it('Emits some hatsTreeId ValueUpdated events', async () => {
        await expect(createAndDeclareTreeTx1)
          .to.emit(keyValuePairs, 'ValueUpdated')
          .withArgs(gnosisSafeAddress, 'topHatId', topHatId.toString());
      });

      describe('Multiple calls', () => {
        let createAndDeclareTreeTx2: ContractTransactionResponse;
        let newTopHatId: bigint;

        beforeEach(async () => {
          newTopHatId = topHatIdToHatId((await mockHats.lastTopHatId()) + 1n);

          createAndDeclareTreeTx2 = await executeSafeTransaction({
            safe: gnosisSafe,
            to: decentHatsCreationModuleAddress,
            transactionData: DecentHatsCreationModule__factory.createInterface().encodeFunctionData(
              'createAndDeclareTree',
              [
                {
                  hatsProtocol: mockHatsAddress,
                  hatsAccountImplementation: mockHatsAccountImplementationAddress,
                  erc6551Registry: await erc6551Registry.getAddress(),
                  keyValuePairs: await keyValuePairs.getAddress(),
                  topHat: {
                    details: '',
                    imageURI: '',
                  },
                  decentAutonomousAdminImplementation:
                    await decentAutonomousAdminMasterCopy.getAddress(),
                  moduleProxyFactory: await moduleProxyFactory.getAddress(),
                  adminHat: {
                    details: '',
                    imageURI: '',
                    isMutable: false,
                  },
                  hats: [],
                  hatsModuleFactory: mockHatsModuleFactoryAddress,
                  hatsElectionsEligibilityImplementation:
                    mockHatsElectionsEligibilityImplementationAddress,
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
            .withArgs(decentHatsCreationModuleAddress);
        });

        it('Leaves the Hats contract with a correct lastTopHatId', async () => {
          expect(await mockHats.lastTopHatId()).to.equal(2n);
        });

        it('Creates Top Hats with different IDs', async () => {
          await expect(createAndDeclareTreeTx2)
            .to.emit(keyValuePairs, 'ValueUpdated')
            .withArgs(gnosisSafeAddress, 'topHatId', newTopHatId.toString());
        });
      });

      describe('Creating Hats Accounts', () => {
        it('Generates the correct Addresses for the current Hats', async () => {
          const allHatsIds = [topHatId, adminHatId, ...roleHatIds];

          for (const hatId of allHatsIds) {
            const hatAccount = await getHatAccount(
              hatId,
              erc6551Registry,
              mockHatsAccountImplementationAddress,
              mockHatsAddress,
            );

            expect(await hatAccount.tokenId()).eq(hatId);
            expect(await hatAccount.tokenImplementation()).eq(mockHatsAddress);
          }
        });
      });
    });

    describe('Creating a new Top Hat and Tree with Termed Roles', () => {
      let createAndDeclareTreeTx: ContractTransactionResponse;
      let topHatId: bigint;

      beforeEach(async () => {
        topHatId = topHatIdToHatId((await mockHats.lastTopHatId()) + 1n);
        createAndDeclareTreeTx = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentHatsCreationModuleAddress,
          transactionData: DecentHatsCreationModule__factory.createInterface().encodeFunctionData(
            'createAndDeclareTree',
            [
              {
                hatsProtocol: mockHatsAddress,
                hatsAccountImplementation: mockHatsAccountImplementationAddress,
                erc6551Registry: await erc6551Registry.getAddress(),
                keyValuePairs: await keyValuePairs.getAddress(),
                topHat: {
                  details: '',
                  imageURI: '',
                },
                decentAutonomousAdminImplementation:
                  await decentAutonomousAdminMasterCopy.getAddress(),
                moduleProxyFactory: await moduleProxyFactory.getAddress(),
                adminHat: {
                  details: '',
                  imageURI: '',
                  isMutable: true,
                },
                hats: [
                  {
                    maxSupply: 1,
                    details: '',
                    imageURI: '',
                    isMutable: false,
                    wearer: '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
                    sablierStreamsParams: [],
                    termEndDateTs: BigInt(Date.now() + 100000),
                  },
                  {
                    maxSupply: 1,
                    details: '',
                    imageURI: '',
                    isMutable: false,
                    wearer: '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
                    sablierStreamsParams: [],
                    termEndDateTs: BigInt(Date.now() + 100000),
                  },
                ],
                hatsModuleFactory: mockHatsModuleFactoryAddress,
                hatsElectionsEligibilityImplementation:
                  mockHatsElectionsEligibilityImplementationAddress,
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
          .withArgs(decentHatsCreationModuleAddress);
      });

      it('Emits some hatsTreeId ValueUpdated events', async () => {
        await expect(createAndDeclareTreeTx)
          .to.emit(keyValuePairs, 'ValueUpdated')
          .withArgs(gnosisSafeAddress, 'topHatId', topHatId.toString());
      });
    });

    describe('Creating a new Top Hat and Tree with Sablier Streams', () => {
      let createAndDeclareTreeTx: ContractTransactionResponse;
      let currentBlockTimestamp: number;
      let topHatId: bigint;

      beforeEach(async () => {
        topHatId = topHatIdToHatId((await mockHats.lastTopHatId()) + 1n);
        currentBlockTimestamp = await time.latest();

        createAndDeclareTreeTx = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentHatsCreationModuleAddress,
          transactionData: DecentHatsCreationModule__factory.createInterface().encodeFunctionData(
            'createAndDeclareTree',
            [
              {
                hatsProtocol: mockHatsAddress,
                hatsAccountImplementation: mockHatsAccountImplementationAddress,
                erc6551Registry: await erc6551Registry.getAddress(),
                keyValuePairs: await keyValuePairs.getAddress(),
                topHat: {
                  details: '',
                  imageURI: '',
                },
                decentAutonomousAdminImplementation:
                  await decentAutonomousAdminMasterCopy.getAddress(),
                moduleProxyFactory: await moduleProxyFactory.getAddress(),
                adminHat: {
                  details: '',
                  imageURI: '',
                  isMutable: false,
                },
                hats: [
                  {
                    maxSupply: 1,
                    details: '',
                    imageURI: '',
                    isMutable: false,
                    wearer: ethers.ZeroAddress,
                    sablierStreamsParams: [
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
                    termEndDateTs: 0,
                  },
                  {
                    maxSupply: 1,
                    details: '',
                    imageURI: '',
                    isMutable: false,
                    wearer: ethers.ZeroAddress,
                    sablierStreamsParams: [],
                    termEndDateTs: 0,
                  },
                ],
                hatsModuleFactory: mockHatsModuleFactoryAddress,
                hatsElectionsEligibilityImplementation:
                  mockHatsElectionsEligibilityImplementationAddress,
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
          .withArgs(decentHatsCreationModuleAddress);
      });

      it('Emits some hatsTreeId ValueUpdated events', async () => {
        await expect(createAndDeclareTreeTx)
          .to.emit(keyValuePairs, 'ValueUpdated')
          .withArgs(gnosisSafeAddress, 'topHatId', topHatId.toString());
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
        currentBlockTimestamp = await time.latest();

        await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentHatsCreationModuleAddress,
          transactionData: DecentHatsCreationModule__factory.createInterface().encodeFunctionData(
            'createAndDeclareTree',
            [
              {
                hatsProtocol: mockHatsAddress,
                hatsAccountImplementation: mockHatsAccountImplementationAddress,
                erc6551Registry: await erc6551Registry.getAddress(),
                keyValuePairs: await keyValuePairs.getAddress(),
                topHat: {
                  details: '',
                  imageURI: '',
                },
                decentAutonomousAdminImplementation:
                  await decentAutonomousAdminMasterCopy.getAddress(),
                moduleProxyFactory: await moduleProxyFactory.getAddress(),
                adminHat: {
                  details: '',
                  imageURI: '',
                  isMutable: false,
                },
                hats: [
                  {
                    maxSupply: 1,
                    details: '',
                    imageURI: '',
                    isMutable: false,
                    wearer: ethers.ZeroAddress,
                    sablierStreamsParams: [
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
                    termEndDateTs: 0,
                  },
                ],
                hatsModuleFactory: mockHatsModuleFactoryAddress,
                hatsElectionsEligibilityImplementation:
                  mockHatsElectionsEligibilityImplementationAddress,
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
