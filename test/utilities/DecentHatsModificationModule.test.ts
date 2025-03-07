import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import type { ContractTransactionResponse } from 'ethers';
import { ethers } from 'hardhat';
import {
  GnosisSafeL2,
  GnosisSafeL2__factory,
  DecentHatsModificationModule__factory,
  DecentHatsCreationModule__factory,
  KeyValuePairs,
  KeyValuePairs__factory,
  MockHats__factory,
  ERC6551Registry__factory,
  MockHatsAccount__factory,
  ERC6551Registry,
  DecentHatsModificationModule,
  MockHatsAccount,
  MockHats,
  MockSablierV2LockupLinear__factory,
  MockSablierV2LockupLinear,
  MockERC20__factory,
  MockERC20,
  ModuleProxyFactory,
  ModuleProxyFactory__factory,
  DecentAutonomousAdminV1,
  DecentAutonomousAdminV1__factory,
  MockHatsModuleFactory__factory,
  MockHatsElectionsEligibility__factory,
  DecentHatsCreationModule,
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

describe('DecentHatsModificationModule', () => {
  let safe: SignerWithAddress;

  let mockHats: MockHats;
  let mockHatsAddress: string;

  let keyValuePairs: KeyValuePairs;
  let gnosisSafe: GnosisSafeL2;

  let decentHatsCreationModule: DecentHatsCreationModule;
  let decentHatsCreationModuleAddress: string;

  let decentHatsModificationModule: DecentHatsModificationModule;
  let decentHatsModificationModuleAddress: string;

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
    const signers = await ethers.getSigners();
    const [deployer] = signers;
    [, safe] = signers;

    mockHats = await new MockHats__factory(deployer).deploy();
    mockHatsAddress = await mockHats.getAddress();
    keyValuePairs = await new KeyValuePairs__factory(deployer).deploy();
    erc6551Registry = await new ERC6551Registry__factory(deployer).deploy();
    mockHatsAccountImplementation = await new MockHatsAccount__factory(deployer).deploy();
    mockHatsAccountImplementationAddress = await mockHatsAccountImplementation.getAddress();
    decentHatsCreationModule = await new DecentHatsCreationModule__factory(deployer).deploy();
    decentHatsCreationModuleAddress = await decentHatsCreationModule.getAddress();
    decentHatsModificationModule = await new DecentHatsModificationModule__factory(
      deployer,
    ).deploy();
    decentHatsModificationModuleAddress = await decentHatsModificationModule.getAddress();
    moduleProxyFactory = await new ModuleProxyFactory__factory(deployer).deploy();
    decentAutonomousAdminMasterCopy = await new DecentAutonomousAdminV1__factory(deployer).deploy();

    const mockHatsModuleFactory = await new MockHatsModuleFactory__factory(deployer).deploy();
    mockHatsModuleFactoryAddress = await mockHatsModuleFactory.getAddress();

    const mockHatsElectionsEligibilityImplementation =
      await new MockHatsElectionsEligibility__factory(deployer).deploy();
    mockHatsElectionsEligibilityImplementationAddress =
      await mockHatsElectionsEligibilityImplementation.getAddress();

    const gnosisSafeProxyFactory = getGnosisSafeProxyFactory();
    const gnosisSafeL2Singleton = getGnosisSafeL2Singleton();
    const gnosisSafeL2SingletonAddress = await gnosisSafeL2Singleton.getAddress();

    const createGnosisSetupCalldata = GnosisSafeL2__factory.createInterface().encodeFunctionData(
      'setup',
      [
        [safe.address],
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
  });

  describe('DecentHatsModificationModule', () => {
    let enableDecentHatsModificationModuleTx: ContractTransactionResponse;

    beforeEach(async () => {
      // Create a tree for the Safe
      await executeSafeTransaction({
        safe: gnosisSafe,
        to: gnosisSafeAddress,
        transactionData: GnosisSafeL2__factory.createInterface().encodeFunctionData(
          'enableModule',
          [decentHatsCreationModuleAddress],
        ),
        signers: [safe],
      });
      await executeSafeTransaction({
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
              hats: [],
            },
          ],
        ),
        signers: [safe],
      });

      enableDecentHatsModificationModuleTx = await executeSafeTransaction({
        safe: gnosisSafe,
        to: gnosisSafeAddress,
        transactionData: GnosisSafeL2__factory.createInterface().encodeFunctionData(
          'enableModule',
          [decentHatsModificationModuleAddress],
        ),
        signers: [safe],
      });
    });

    describe('Enabled as a module', () => {
      it('Emits an ExecutionSuccess event', async () => {
        await expect(enableDecentHatsModificationModuleTx).to.emit(gnosisSafe, 'ExecutionSuccess');
      });

      it('Emits an EnabledModule event', async () => {
        await expect(enableDecentHatsModificationModuleTx)
          .to.emit(gnosisSafe, 'EnabledModule')
          .withArgs(decentHatsModificationModuleAddress);
      });
    });

    describe('Creating a new untermed hat on existing Tree', () => {
      let topHatAccount: MockHatsAccount;
      let currentBlockTimestamp: number;
      let topHatId: bigint;
      let adminHatId: bigint;
      let createNewHatData: {
        safe: GnosisSafeL2;
        to: string;
        transactionData: string;
        signers: SignerWithAddress[];
      };

      beforeEach(async () => {
        currentBlockTimestamp = await time.latest();
        topHatId = topHatIdToHatId(await mockHats.lastTopHatId());
        adminHatId = await mockHats.getNextId(topHatId);

        topHatAccount = await getHatAccount(
          topHatId,
          erc6551Registry,
          mockHatsAccountImplementationAddress,
          mockHatsAddress,
        );

        createNewHatData = {
          safe: gnosisSafe,
          to: decentHatsModificationModuleAddress,
          transactionData:
            DecentHatsModificationModule__factory.createInterface().encodeFunctionData(
              'createRoleHats',
              [
                {
                  hatsProtocol: mockHatsAddress,
                  erc6551Registry: await erc6551Registry.getAddress(),
                  topHatAccount: await topHatAccount.getAddress(),
                  hatsAccountImplementation: mockHatsAccountImplementationAddress,
                  adminHatId,
                  topHatId,
                  hats: [
                    {
                      wearer: await topHatAccount.getAddress(), // any non-zero address,
                      details: '',
                      imageURI: '',
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
                      ],
                      termEndDateTs: 0,
                      maxSupply: 1,
                      isMutable: true,
                    },
                  ],
                  hatsElectionsEligibilityImplementation:
                    mockHatsElectionsEligibilityImplementationAddress,
                  hatsModuleFactory: mockHatsModuleFactoryAddress,
                  keyValuePairs: await keyValuePairs.getAddress(),
                },
              ],
            ),
          signers: [safe],
        };
      });

      it('Emits an ExecutionSuccess event', async () => {
        await expect(executeSafeTransaction(createNewHatData)).to.emit(
          gnosisSafe,
          'ExecutionSuccess',
        );
      });

      it('Emits an ExecutionFromModuleSuccess event', async () => {
        await expect(executeSafeTransaction(createNewHatData))
          .to.emit(gnosisSafe, 'ExecutionFromModuleSuccess')
          .withArgs(decentHatsModificationModuleAddress);
      });

      it('Actually creates the new hat', async () => {
        const nextHatIdBeforeCreatingNewHats = await mockHats.getNextId(adminHatId);

        const tx = await executeSafeTransaction(createNewHatData);
        await tx.wait();

        const nextHatIdAfterCreatingNewHats = await mockHats.getNextId(adminHatId);
        expect(nextHatIdAfterCreatingNewHats).to.not.equal(nextHatIdBeforeCreatingNewHats);
      });
    });

    describe('Creating a new termed hat on existing Tree', () => {
      let topHatAccount: MockHatsAccount;
      let currentBlockTimestamp: number;
      let topHatId: bigint;
      let adminHatId: bigint;
      let newHatId: bigint;

      let createNewHatData: {
        safe: GnosisSafeL2;
        to: string;
        transactionData: string;
        signers: SignerWithAddress[];
      };

      beforeEach(async () => {
        currentBlockTimestamp = await time.latest();
        topHatId = topHatIdToHatId(await mockHats.lastTopHatId());
        adminHatId = await mockHats.getNextId(topHatId);
        newHatId = await mockHats.getNextId(adminHatId);

        topHatAccount = await getHatAccount(
          topHatId,
          erc6551Registry,
          mockHatsAccountImplementationAddress,
          mockHatsAddress,
        );

        createNewHatData = {
          safe: gnosisSafe,
          to: decentHatsModificationModuleAddress,
          transactionData:
            DecentHatsModificationModule__factory.createInterface().encodeFunctionData(
              'createRoleHats',
              [
                {
                  hatsProtocol: mockHatsAddress,
                  erc6551Registry: await erc6551Registry.getAddress(),
                  topHatAccount: await topHatAccount.getAddress(),
                  hatsAccountImplementation: mockHatsAccountImplementationAddress,
                  adminHatId,
                  topHatId,
                  hats: [
                    {
                      wearer: await topHatAccount.getAddress(), // any non-zero address,
                      details: '',
                      imageURI: '',
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
                      ],
                      termEndDateTs: currentBlockTimestamp + 2592000, // 30 days from now
                      maxSupply: 1,
                      isMutable: true,
                    },
                  ],
                  hatsElectionsEligibilityImplementation:
                    mockHatsElectionsEligibilityImplementationAddress,
                  hatsModuleFactory: mockHatsModuleFactoryAddress,
                  keyValuePairs: await keyValuePairs.getAddress(),
                },
              ],
            ),
          signers: [safe],
        };
      });

      it('Emits an ExecutionSuccess event', async () => {
        await expect(executeSafeTransaction(createNewHatData)).to.emit(
          gnosisSafe,
          'ExecutionSuccess',
        );
      });

      it('Emits an ExecutionFromModuleSuccess event', async () => {
        await expect(executeSafeTransaction(createNewHatData))
          .to.emit(gnosisSafe, 'ExecutionFromModuleSuccess')
          .withArgs(decentHatsModificationModuleAddress);
      });

      it('Emits a HatCreated event', async () => {
        await expect(executeSafeTransaction(createNewHatData)).to.emit(mockHats, 'HatCreated');

        const hatCreatedEvents = await mockHats.queryFilter(mockHats.filters.HatCreated(), 0);
        expect(hatCreatedEvents.length).to.equal(3); // 1 for the top hat, 1 for the admin hat, 1 for the new hat

        const latestEvent = hatCreatedEvents[hatCreatedEvents.length - 1];
        expect(latestEvent.args.id).to.equal(newHatId);
      });

      it('Actually creates the new hat', async () => {
        const nextHatIdBeforeCreatingNewHats = await mockHats.getNextId(adminHatId);

        await executeSafeTransaction(createNewHatData);

        const nextHatIdAfterCreatingNewHats = await mockHats.getNextId(adminHatId);
        expect(nextHatIdAfterCreatingNewHats).to.not.equal(nextHatIdBeforeCreatingNewHats);
      });
    });
  });
});
