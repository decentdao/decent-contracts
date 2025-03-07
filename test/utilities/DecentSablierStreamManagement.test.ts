import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import type { BigNumberish, ContractTransactionResponse } from 'ethers';
import { ethers } from 'hardhat';
import {
  DecentAutonomousAdminV1,
  DecentAutonomousAdminV1__factory,
  DecentHatsCreationModule,
  DecentHatsCreationModule__factory,
  DecentSablierStreamManagementModule,
  DecentSablierStreamManagementModule__factory,
  ERC6551Registry,
  ERC6551Registry__factory,
  GnosisSafeL2,
  GnosisSafeL2__factory,
  KeyValuePairs__factory,
  MockERC20,
  MockERC20__factory,
  MockHats,
  MockHats__factory,
  MockHatsAccount,
  MockHatsAccount__factory,
  MockHatsElectionsEligibility,
  MockHatsElectionsEligibility__factory,
  MockHatsModuleFactory,
  MockHatsModuleFactory__factory,
  MockSablierV2LockupLinear,
  MockSablierV2LockupLinear__factory,
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

describe('DecentSablierStreamManagement', () => {
  let dao: SignerWithAddress;
  let gnosisSafe: GnosisSafeL2;

  let mockHats: MockHats;
  let mockHatsAddress: string;

  let decentHatsCreationModule: DecentHatsCreationModule;
  let decentHatsCreationModuleAddress: string;

  let decentSablierManagement: DecentSablierStreamManagementModule;
  let decentSablierManagementAddress: string;

  let mockHatsAccountImplementation: MockHatsAccount;
  let mockHatsAccountImplementationAddress: string;

  let mockERC20: MockERC20;
  let mockERC20Address: string;

  let gnosisSafeAddress: string;

  let mockSablier: MockSablierV2LockupLinear;
  let mockSablierAddress: string;

  let erc6551Registry: ERC6551Registry;

  let currentBlockTimestamp: number;

  let streamId: BigNumberish;

  let enableModuleTx: ContractTransactionResponse;
  let createAndDeclareTreeWithRolesAndStreamsTx: ContractTransactionResponse;
  const streamFundsMax = ethers.parseEther('100');

  let roleHatId: bigint;
  let mockHatsModuleFactory: MockHatsModuleFactory;
  let moduleProxyFactory: ModuleProxyFactory;
  let decentAutonomousAdminMasterCopy: DecentAutonomousAdminV1;
  let hatsElectionsEligibilityImplementation: MockHatsElectionsEligibility;

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    const [deployer] = signers;
    [, dao] = signers;

    decentSablierManagement = await new DecentSablierStreamManagementModule__factory(
      deployer,
    ).deploy();
    decentSablierManagementAddress = await decentSablierManagement.getAddress();

    mockHatsAccountImplementation = await new MockHatsAccount__factory(deployer).deploy();
    mockHatsAccountImplementationAddress = await mockHatsAccountImplementation.getAddress();

    decentHatsCreationModule = await new DecentHatsCreationModule__factory(deployer).deploy();
    decentHatsCreationModuleAddress = await decentHatsCreationModule.getAddress();

    mockHatsModuleFactory = await new MockHatsModuleFactory__factory(deployer).deploy();
    moduleProxyFactory = await new ModuleProxyFactory__factory(deployer).deploy();
    decentAutonomousAdminMasterCopy = await new DecentAutonomousAdminV1__factory(deployer).deploy();
    hatsElectionsEligibilityImplementation = await new MockHatsElectionsEligibility__factory(
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

    // Set up the Safe with roles and streams
    await executeSafeTransaction({
      safe: gnosisSafe,
      to: gnosisSafeAddress,
      transactionData: GnosisSafeL2__factory.createInterface().encodeFunctionData('enableModule', [
        decentHatsCreationModuleAddress,
      ]),
      signers: [dao],
    });

    currentBlockTimestamp = await time.latest();

    mockHats = await new MockHats__factory(deployer).deploy();
    mockHatsAddress = await mockHats.getAddress();
    let keyValuePairs = await new KeyValuePairs__factory(deployer).deploy();
    erc6551Registry = await new ERC6551Registry__factory(deployer).deploy();

    const topHatId = topHatIdToHatId((await mockHats.lastTopHatId()) + 1n);
    const adminHatId = await mockHats.getNextId(topHatId);
    roleHatId = await mockHats.getNextId(adminHatId);

    createAndDeclareTreeWithRolesAndStreamsTx = await executeSafeTransaction({
      safe: gnosisSafe,
      to: decentHatsCreationModuleAddress,
      transactionData: DecentHatsCreationModule__factory.createInterface().encodeFunctionData(
        'createAndDeclareTree',
        [
          {
            hatsProtocol: mockHatsAddress,
            hatsAccountImplementation: mockHatsAccountImplementationAddress,
            hatsModuleFactory: await mockHatsModuleFactory.getAddress(),
            moduleProxyFactory: await moduleProxyFactory.getAddress(),
            decentAutonomousAdminImplementation: await decentAutonomousAdminMasterCopy.getAddress(),
            hatsElectionsEligibilityImplementation:
              await hatsElectionsEligibilityImplementation.getAddress(),
            erc6551Registry: await erc6551Registry.getAddress(),
            keyValuePairs: await keyValuePairs.getAddress(),
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
                maxSupply: 1,
                details: '',
                imageURI: '',
                isMutable: false,
                wearer: dao.address,
                termEndDateTs: 0,
                sablierStreamsParams: [
                  {
                    sablier: mockSablierAddress,
                    sender: gnosisSafeAddress,
                    totalAmount: streamFundsMax,
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
            ],
          },
        ],
      ),
      signers: [dao],
    });

    await expect(createAndDeclareTreeWithRolesAndStreamsTx).to.emit(gnosisSafe, 'ExecutionSuccess');
    await expect(createAndDeclareTreeWithRolesAndStreamsTx).to.emit(
      gnosisSafe,
      'ExecutionFromModuleSuccess',
    );

    const streamCreatedEvents = await mockSablier.queryFilter(mockSablier.filters.StreamCreated());
    expect(streamCreatedEvents.length).to.equal(1);

    streamId = streamCreatedEvents[0].args.streamId;

    // Enable the module
    enableModuleTx = await executeSafeTransaction({
      safe: gnosisSafe,
      to: gnosisSafeAddress,
      transactionData: GnosisSafeL2__factory.createInterface().encodeFunctionData('enableModule', [
        decentSablierManagementAddress,
      ]),
      signers: [dao],
    });
  });

  describe('Enabled as a Module', () => {
    it('Emits an ExecutionSuccess event', async () => {
      await expect(enableModuleTx).to.emit(gnosisSafe, 'ExecutionSuccess');
    });

    it('Emits an EnabledModule event', async () => {
      await expect(enableModuleTx)
        .to.emit(gnosisSafe, 'EnabledModule')
        .withArgs(decentSablierManagementAddress);
    });
  });

  describe('Withdrawing From Stream', () => {
    let withdrawTx: ContractTransactionResponse;

    describe('When the stream has funds', () => {
      beforeEach(async () => {
        // Advance time to the end of the stream
        await time.increaseTo(currentBlockTimestamp + 2592000);

        // No action has been taken yet on the stream. Balance should be untouched.
        expect(await mockSablier.withdrawableAmountOf(streamId)).to.eq(streamFundsMax);

        const recipientHatAccount = await getHatAccount(
          roleHatId,
          erc6551Registry,
          mockHatsAccountImplementationAddress,
          mockHatsAddress,
          dao,
        );

        withdrawTx = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentSablierManagementAddress,
          transactionData:
            DecentSablierStreamManagementModule__factory.createInterface().encodeFunctionData(
              'withdrawMaxFromStream',
              [mockSablierAddress, await recipientHatAccount.getAddress(), streamId, dao.address],
            ),
          signers: [dao],
        });

        await expect(withdrawTx).to.not.be.reverted;
      });

      it('Emits an ExecutionSuccess event', async () => {
        await expect(withdrawTx).to.emit(gnosisSafe, 'ExecutionSuccess');
      });

      it('Emits an ExecutionFromModuleSuccess event', async () => {
        await expect(withdrawTx)
          .to.emit(gnosisSafe, 'ExecutionFromModuleSuccess')
          .withArgs(decentSablierManagementAddress);
      });

      it('Withdraws the maximum amount from the stream', async () => {
        expect(await mockSablier.withdrawableAmountOf(streamId)).to.equal(0);
      });
    });

    describe('When the stream has no funds', () => {
      beforeEach(async () => {
        // Advance time to the end of the stream
        await time.increaseTo(currentBlockTimestamp + 2592000);

        const recipientHatAccount = await getHatAccount(
          roleHatId,
          erc6551Registry,
          mockHatsAccountImplementationAddress,
          mockHatsAddress,
          dao,
        );

        // The recipient withdraws the full amount
        await recipientHatAccount.execute(
          mockSablierAddress,
          0n,
          MockSablierV2LockupLinear__factory.createInterface().encodeFunctionData('withdrawMax', [
            streamId,
            dao.address,
          ]),
          0,
        );

        expect(await mockSablier.withdrawableAmountOf(streamId)).to.equal(0);

        withdrawTx = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentSablierManagementAddress,
          transactionData:
            DecentSablierStreamManagementModule__factory.createInterface().encodeFunctionData(
              'withdrawMaxFromStream',
              [mockSablierAddress, await recipientHatAccount.getAddress(), streamId, dao.address],
            ),
          signers: [dao],
        });
      });

      it('Emits an ExecutionSuccess event', async () => {
        await expect(withdrawTx).to.emit(gnosisSafe, 'ExecutionSuccess');
      });

      it('Does not emit an ExecutionFromModuleSuccess event', async () => {
        await expect(withdrawTx).to.not.emit(gnosisSafe, 'ExecutionFromModuleSuccess');
      });

      it('Does not revert', async () => {
        await expect(withdrawTx).to.not.be.reverted;
      });
    });
  });

  describe('Cancelling From Stream', () => {
    let cancelTx: ContractTransactionResponse;

    describe('When the stream is active', () => {
      beforeEach(async () => {
        // Advance time to before the end of the stream
        await time.increaseTo(currentBlockTimestamp + 60000);

        cancelTx = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentSablierManagementAddress,
          transactionData:
            DecentSablierStreamManagementModule__factory.createInterface().encodeFunctionData(
              'cancelStream',
              [mockSablierAddress, streamId],
            ),
          signers: [dao],
        });
      });

      it('Emits an ExecutionSuccess event', async () => {
        await expect(cancelTx).to.emit(gnosisSafe, 'ExecutionSuccess');
      });

      it('Emits an ExecutionFromModuleSuccess event', async () => {
        await expect(cancelTx)
          .to.emit(gnosisSafe, 'ExecutionFromModuleSuccess')
          .withArgs(decentSablierManagementAddress);
      });

      it('Cancels the stream', async () => {
        expect(await mockSablier.statusOf(streamId)).to.equal(3); // 3 === LockupLinear.Status.CANCELED
      });
    });

    describe('When the stream has expired', () => {
      beforeEach(async () => {
        // Advance time to the end of the stream, 30 days from now + 1 minute
        await time.increaseTo(currentBlockTimestamp + 2592000 + 60000);

        cancelTx = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentSablierManagementAddress,
          transactionData:
            DecentSablierStreamManagementModule__factory.createInterface().encodeFunctionData(
              'cancelStream',
              [mockSablierAddress, streamId],
            ),
          signers: [dao],
        });
      });

      it('Emits an ExecutionSuccess event', async () => {
        await expect(cancelTx).to.emit(gnosisSafe, 'ExecutionSuccess');
      });

      it('Does not emit an ExecutionFromModuleSuccess event', async () => {
        await expect(cancelTx).to.not.emit(gnosisSafe, 'ExecutionFromModuleSuccess');
      });

      it('Does not revert', async () => {
        await expect(cancelTx).to.not.be.reverted;
      });
    });

    describe('When the stream has been previously cancelled', () => {
      beforeEach(async () => {
        // Advance time to before the end of the stream
        await time.increaseTo(currentBlockTimestamp + 120000);

        const stream = await mockSablier.getStream(streamId);
        expect(stream.endTime).to.be.greaterThan(currentBlockTimestamp);

        // The safe cancels the stream
        await executeSafeTransaction({
          safe: gnosisSafe,
          to: mockSablierAddress,
          transactionData: MockSablierV2LockupLinear__factory.createInterface().encodeFunctionData(
            'cancel',
            [streamId],
          ),
          signers: [dao],
        });

        // Advance time to 4 minutes from now
        await time.increaseTo(currentBlockTimestamp + 240000);

        cancelTx = await executeSafeTransaction({
          safe: gnosisSafe,
          to: decentSablierManagementAddress,
          transactionData:
            DecentSablierStreamManagementModule__factory.createInterface().encodeFunctionData(
              'cancelStream',
              [mockSablierAddress, streamId],
            ),
          signers: [dao],
        });
      });

      it('Emits an ExecutionSuccess event', async () => {
        await expect(cancelTx).to.emit(gnosisSafe, 'ExecutionSuccess');
      });

      it('Does not emit an ExecutionFromModuleSuccess event', async () => {
        await expect(cancelTx).to.not.emit(gnosisSafe, 'ExecutionFromModuleSuccess');
      });

      it('Does not revert', async () => {
        await expect(cancelTx).to.not.be.reverted;
      });
    });
  });
});
