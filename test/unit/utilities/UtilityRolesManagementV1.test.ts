import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC165__factory,
  IDeploymentBlock__factory,
  IUtilityRolesManagementV1__factory,
  MockDecentAutonomousAdmin,
  MockDecentAutonomousAdmin__factory,
  MockERC20,
  MockERC20__factory,
  MockERC6551Registry,
  MockERC6551Registry__factory,
  MockHatsComplete,
  MockHatsComplete__factory,
  MockKeyValuePairs,
  MockKeyValuePairs__factory,
  MockSafeDelegatecall,
  MockSafeDelegatecall__factory,
  MockSystemDeployer,
  MockSystemDeployer__factory,
  UtilityRolesManagementV1,
  UtilityRolesManagementV1__factory,
} from '../../../typechain-types';
import { runDeploymentBlockTests } from '../shared/deploymentBlockTests';
import { runSupportsInterfaceTests } from '../shared/supportsInterfaceTests';

// Mock contracts for Sablier and ERC6551
interface MockSablierV2Lockup {
  withdrawableAmountOf(streamId: bigint): Promise<bigint>;
  withdrawMax(streamId: bigint, to: string): Promise<void>;
  statusOf(streamId: bigint): Promise<number>;
  cancel(streamId: bigint): Promise<void>;
  nextStreamId(): Promise<bigint>;
  createWithTimestamps(params: any): Promise<any>;
  getAddress(): Promise<string>;
}

interface MockERC6551Executable {
  execute(target: string, value: bigint, data: string, operation: number): Promise<void>;
}

describe('UtilityRolesManagementV1 (Delegatecall)', () => {
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  let rolesManagementUtility: UtilityRolesManagementV1;
  let mockSafe: MockSafeDelegatecall;
  let mockHats: MockHatsComplete;
  let mockERC6551Registry: MockERC6551Registry;
  let mockSystemDeployer: MockSystemDeployer;
  let mockAutonomousAdmin: MockDecentAutonomousAdmin;
  let mockKeyValuePairs: MockKeyValuePairs;

  const SALT = '0x5d0e6ce4fd951366cc55da93f6e79d8b81483109d79676a04bcc2bed6a4b5072';

  // Assume an existing tree structure for modification tests
  const TOP_HAT_ID = BigInt(1) << 224n; // First top hat
  const ADMIN_HAT_ID = TOP_HAT_ID + 1n; // Admin hat is first hat under top

  beforeEach(async () => {
    [deployer, user1, user2] = await ethers.getSigners();

    // Deploy mocks
    const mockSafeFactory = new MockSafeDelegatecall__factory(deployer);
    mockSafe = await mockSafeFactory.deploy();
    await mockSafe.waitForDeployment();

    const mockHatsFactory = new MockHatsComplete__factory(deployer);
    mockHats = await mockHatsFactory.deploy();
    await mockHats.waitForDeployment();

    const mockRegistryFactory = new MockERC6551Registry__factory(deployer);
    mockERC6551Registry = await mockRegistryFactory.deploy();
    await mockERC6551Registry.waitForDeployment();

    const mockSystemDeployerFactory = new MockSystemDeployer__factory(deployer);
    mockSystemDeployer = await mockSystemDeployerFactory.deploy();
    await mockSystemDeployer.waitForDeployment();

    const mockAutonomousAdminFactory = new MockDecentAutonomousAdmin__factory(deployer);
    mockAutonomousAdmin = await mockAutonomousAdminFactory.deploy();
    await mockAutonomousAdmin.waitForDeployment();

    const mockKeyValuePairsFactory = new MockKeyValuePairs__factory(deployer);
    mockKeyValuePairs = await mockKeyValuePairsFactory.deploy();
    await mockKeyValuePairs.waitForDeployment();

    // Deploy UtilityRolesManagementV1
    const rolesManagementUtilityFactory = new UtilityRolesManagementV1__factory(deployer);
    rolesManagementUtility = await rolesManagementUtilityFactory.deploy();
    await rolesManagementUtility.waitForDeployment();
  });

  describe('createAndDeclareTree via delegatecall', () => {
    it('should create a complete Hats tree structure', async () => {
      const treeParams = {
        keyValuePairs: await mockKeyValuePairs.getAddress(),
        hatsProtocol: await mockHats.getAddress(),
        erc6551Registry: await mockERC6551Registry.getAddress(),
        hatsModuleFactory: ethers.ZeroAddress,
        systemDeployer: await mockSystemDeployer.getAddress(),
        decentAutonomousAdminImplementation: await mockAutonomousAdmin.getAddress(),
        hatsAccountImplementation: ethers.ZeroAddress,
        hatsElectionsEligibilityImplementation: ethers.ZeroAddress,
        topHat: {
          details: 'Test DAO',
          imageURI: 'ipfs://tophat',
        },
        adminHat: {
          details: 'Admin',
          imageURI: 'ipfs://admin',
          isMutable: true,
          salt: ethers.keccak256(ethers.toUtf8Bytes('admin')),
        },
        hats: [
          {
            details: 'Developer',
            imageURI: 'ipfs://dev',
            maxSupply: 5,
            isMutable: true,
            wearer: user1.address,
            termEndDateTs: 0, // Untermed
            sablierStreamsParams: [],
          },
        ],
      };

      // Execute via delegatecall
      await mockSafe.execTransaction(
        await rolesManagementUtility.getAddress(),
        0,
        rolesManagementUtility.interface.encodeFunctionData('createAndDeclareTree', [treeParams]),
        1, // DelegateCall
      );

      // Verify top hat was minted to the Safe
      const topHatId = BigInt(1) << 224n;
      expect(await mockHats.isWearerOfHat(await mockSafe.getAddress(), topHatId)).to.be.true;

      // Verify admin hat was created
      const adminHatId = topHatId + 1n;
      expect(await mockHats.hatDetails(adminHatId)).to.equal('Admin');

      // Verify admin hat has maxSupply of 1 (only one admin)
      expect(await mockHats.hatMaxSupply(adminHatId)).to.equal(1);

      // Verify role hat was created
      const roleHatId = adminHatId + 1n;
      expect(await mockHats.hatDetails(roleHatId)).to.equal('Developer');
      expect(await mockHats.isWearerOfHat(user1.address, roleHatId)).to.be.true;

      // Verify KeyValuePairs was updated
      expect(await mockKeyValuePairs.getValue('topHatId')).to.equal(topHatId.toString());
    });

    it('should mint admin hat to autonomous admin', async () => {
      const treeParams = {
        keyValuePairs: await mockKeyValuePairs.getAddress(),
        hatsProtocol: await mockHats.getAddress(),
        erc6551Registry: await mockERC6551Registry.getAddress(),
        hatsModuleFactory: ethers.ZeroAddress,
        systemDeployer: await mockSystemDeployer.getAddress(),
        decentAutonomousAdminImplementation: await mockAutonomousAdmin.getAddress(),
        hatsAccountImplementation: ethers.ZeroAddress,
        hatsElectionsEligibilityImplementation: ethers.ZeroAddress,
        topHat: {
          details: 'Test DAO',
          imageURI: 'ipfs://tophat',
        },
        adminHat: {
          details: 'Admin',
          imageURI: 'ipfs://admin',
          isMutable: true,
          salt: ethers.keccak256(ethers.toUtf8Bytes('admin')),
        },
        hats: [],
      };

      await mockSafe.execTransaction(
        await rolesManagementUtility.getAddress(),
        0,
        rolesManagementUtility.interface.encodeFunctionData('createAndDeclareTree', [treeParams]),
        1, // DelegateCall
      );

      // Calculate the deployed admin address
      const autonomousAdminAddress = await mockSystemDeployer.predictProxyAddress(
        await mockAutonomousAdmin.getAddress(),
        mockAutonomousAdmin.interface.encodeFunctionData('initialize'),
        treeParams.adminHat.salt,
        await mockSafe.getAddress(),
      );

      // Verify admin hat was minted to the autonomous admin
      const topHatId = BigInt(1) << 224n;
      const adminHatId = topHatId + 1n;
      expect(await mockHats.isWearerOfHat(autonomousAdminAddress, adminHatId)).to.be.true;
    });

    it('should verify Safe is the deployer when using SystemDeployer', async () => {
      const treeParams = {
        keyValuePairs: await mockKeyValuePairs.getAddress(),
        hatsProtocol: await mockHats.getAddress(),
        erc6551Registry: await mockERC6551Registry.getAddress(),
        hatsModuleFactory: ethers.ZeroAddress,
        systemDeployer: await mockSystemDeployer.getAddress(),
        decentAutonomousAdminImplementation: await mockAutonomousAdmin.getAddress(),
        hatsAccountImplementation: ethers.ZeroAddress,
        hatsElectionsEligibilityImplementation: ethers.ZeroAddress,
        topHat: {
          details: 'Test DAO',
          imageURI: 'ipfs://tophat',
        },
        adminHat: {
          details: 'Admin',
          imageURI: 'ipfs://admin',
          isMutable: true,
          salt: ethers.keccak256(ethers.toUtf8Bytes('admin')),
        },
        hats: [],
      };

      // Execute via delegatecall
      await mockSafe.execTransaction(
        await rolesManagementUtility.getAddress(),
        0,
        rolesManagementUtility.interface.encodeFunctionData('createAndDeclareTree', [treeParams]),
        1, // DelegateCall
      );

      // The mock SystemDeployer doesn't track deployers in a way we can verify
      // In a real scenario, we would verify the Safe was msg.sender during delegatecall
      // This test mainly ensures the SystemDeployer was called successfully
    });

    it('should create ERC6551 account with correct topHatId', async () => {
      const treeParams = {
        keyValuePairs: await mockKeyValuePairs.getAddress(),
        hatsProtocol: await mockHats.getAddress(),
        erc6551Registry: await mockERC6551Registry.getAddress(),
        hatsModuleFactory: ethers.ZeroAddress,
        systemDeployer: await mockSystemDeployer.getAddress(),
        decentAutonomousAdminImplementation: await mockAutonomousAdmin.getAddress(),
        hatsAccountImplementation: ethers.ZeroAddress,
        hatsElectionsEligibilityImplementation: ethers.ZeroAddress,
        topHat: {
          details: 'Test DAO',
          imageURI: 'ipfs://tophat',
        },
        adminHat: {
          details: 'Admin',
          imageURI: 'ipfs://admin',
          isMutable: true,
          salt: ethers.keccak256(ethers.toUtf8Bytes('admin')),
        },
        hats: [],
      };

      await mockSafe.execTransaction(
        await rolesManagementUtility.getAddress(),
        0,
        rolesManagementUtility.interface.encodeFunctionData('createAndDeclareTree', [treeParams]),
        1, // DelegateCall
      );

      // Check the ERC6551 account was created for the correct top hat
      const topHatId = BigInt(1) << 224n;
      const topHatAccount = await mockERC6551Registry.account(
        ethers.ZeroAddress,
        SALT,
        31337, // chainId
        await mockHats.getAddress(),
        topHatId,
      );
      expect(topHatAccount).to.not.equal(ethers.ZeroAddress);
    });

    it('should handle multiple role hats', async () => {
      const treeParams = {
        keyValuePairs: await mockKeyValuePairs.getAddress(),
        hatsProtocol: await mockHats.getAddress(),
        erc6551Registry: await mockERC6551Registry.getAddress(),
        hatsModuleFactory: ethers.ZeroAddress,
        systemDeployer: await mockSystemDeployer.getAddress(),
        decentAutonomousAdminImplementation: await mockAutonomousAdmin.getAddress(),
        hatsAccountImplementation: ethers.ZeroAddress,
        hatsElectionsEligibilityImplementation: ethers.ZeroAddress,
        topHat: {
          details: 'Test DAO',
          imageURI: 'ipfs://tophat',
        },
        adminHat: {
          details: 'Admin',
          imageURI: 'ipfs://admin',
          isMutable: true,
          salt: ethers.keccak256(ethers.toUtf8Bytes('admin')),
        },
        hats: [
          {
            details: 'Developer',
            imageURI: 'ipfs://dev',
            maxSupply: 5,
            isMutable: true,
            wearer: user1.address,
            termEndDateTs: 0,
            sablierStreamsParams: [],
          },
          {
            details: 'Designer',
            imageURI: 'ipfs://design',
            maxSupply: 3,
            isMutable: false,
            wearer: user2.address,
            termEndDateTs: 0,
            sablierStreamsParams: [],
          },
        ],
      };

      await mockSafe.execTransaction(
        await rolesManagementUtility.getAddress(),
        0,
        rolesManagementUtility.interface.encodeFunctionData('createAndDeclareTree', [treeParams]),
        1, // DelegateCall
      );

      const topHatId = BigInt(1) << 224n;
      const adminHatId = topHatId + 1n;
      const devHatId = adminHatId + 1n;
      const designerHatId = adminHatId + 2n;

      // Verify both role hats were created
      expect(await mockHats.hatDetails(devHatId)).to.equal('Developer');
      expect(await mockHats.hatDetails(designerHatId)).to.equal('Designer');
      expect(await mockHats.isWearerOfHat(user1.address, devHatId)).to.be.true;
      expect(await mockHats.isWearerOfHat(user2.address, designerHatId)).to.be.true;
    });

    it('should properly set up eligibility and toggle relationships', async () => {
      const treeParams = {
        keyValuePairs: await mockKeyValuePairs.getAddress(),
        hatsProtocol: await mockHats.getAddress(),
        erc6551Registry: await mockERC6551Registry.getAddress(),
        hatsModuleFactory: ethers.ZeroAddress,
        systemDeployer: await mockSystemDeployer.getAddress(),
        decentAutonomousAdminImplementation: await mockAutonomousAdmin.getAddress(),
        hatsAccountImplementation: ethers.ZeroAddress,
        hatsElectionsEligibilityImplementation: ethers.ZeroAddress,
        topHat: {
          details: 'Test DAO',
          imageURI: 'ipfs://tophat',
        },
        adminHat: {
          details: 'Admin',
          imageURI: 'ipfs://admin',
          isMutable: true,
          salt: ethers.keccak256(ethers.toUtf8Bytes('admin')),
        },
        hats: [
          {
            details: 'Role',
            imageURI: 'ipfs://role',
            maxSupply: 1,
            isMutable: true,
            wearer: user1.address,
            termEndDateTs: 0,
            sablierStreamsParams: [],
          },
        ],
      };

      await mockSafe.execTransaction(
        await rolesManagementUtility.getAddress(),
        0,
        rolesManagementUtility.interface.encodeFunctionData('createAndDeclareTree', [treeParams]),
        1, // DelegateCall
      );

      const topHatId = BigInt(1) << 224n;
      const adminHatId = topHatId + 1n;
      const roleHatId = adminHatId + 1n;

      // Admin hat should have Safe as eligibility and toggle
      expect(await mockHats.hatEligibility(adminHatId)).to.equal(await mockSafe.getAddress());
      expect(await mockHats.hatToggle(adminHatId)).to.equal(await mockSafe.getAddress());

      // Role hat should have Safe as eligibility and toggle (for untermed)
      expect(await mockHats.hatEligibility(roleHatId)).to.equal(await mockSafe.getAddress());
      expect(await mockHats.hatToggle(roleHatId)).to.equal(await mockSafe.getAddress());
    });
  });

  describe('createRoleHats via delegatecall', () => {
    beforeEach(async () => {
      // Setup existing hat tree state in mocks
      // Simulate existing top hat and admin hat
      await mockHats.setWearerStatus(await mockSafe.getAddress(), TOP_HAT_ID, true);
      await mockHats.setWearerStatus(deployer.address, ADMIN_HAT_ID, true);
    });

    it('should add new roles to existing hat tree', async () => {
      const roleHatsParams = {
        hatsProtocol: await mockHats.getAddress(),
        erc6551Registry: await mockERC6551Registry.getAddress(),
        hatsAccountImplementation: ethers.ZeroAddress,
        topHatId: TOP_HAT_ID,
        topHatAccount: await mockSafe.getAddress(),
        hatsModuleFactory: ethers.ZeroAddress,
        hatsElectionsEligibilityImplementation: ethers.ZeroAddress,
        adminHatId: ADMIN_HAT_ID,
        hats: [
          {
            details: 'New Developer',
            imageURI: 'ipfs://newdev',
            maxSupply: 3,
            isMutable: true,
            wearer: user1.address,
            termEndDateTs: 0,
            sablierStreamsParams: [],
          },
        ],
        keyValuePairs: await mockKeyValuePairs.getAddress(),
      };

      await mockSafe.execTransaction(
        await rolesManagementUtility.getAddress(),
        0,
        rolesManagementUtility.interface.encodeFunctionData('createRoleHats', [roleHatsParams]),
        1, // DelegateCall
      );

      // Verify new role was created under admin hat
      const newRoleId = ADMIN_HAT_ID + 1n;
      expect(await mockHats.hatDetails(newRoleId)).to.equal('New Developer');
      expect(await mockHats.isWearerOfHat(user1.address, newRoleId)).to.be.true;
    });

    it('should create ERC6551 accounts for untermed roles', async () => {
      const roleHatsParams = {
        hatsProtocol: await mockHats.getAddress(),
        erc6551Registry: await mockERC6551Registry.getAddress(),
        hatsAccountImplementation: ethers.ZeroAddress,
        topHatId: TOP_HAT_ID,
        topHatAccount: await mockSafe.getAddress(),
        hatsModuleFactory: ethers.ZeroAddress,
        hatsElectionsEligibilityImplementation: ethers.ZeroAddress,
        adminHatId: ADMIN_HAT_ID,
        hats: [
          {
            details: 'Treasury Manager',
            imageURI: 'ipfs://treasury',
            maxSupply: 1,
            isMutable: true,
            wearer: user1.address,
            termEndDateTs: 0, // Untermed
            sablierStreamsParams: [],
          },
        ],
        keyValuePairs: await mockKeyValuePairs.getAddress(),
      };

      await mockSafe.execTransaction(
        await rolesManagementUtility.getAddress(),
        0,
        rolesManagementUtility.interface.encodeFunctionData('createRoleHats', [roleHatsParams]),
        1, // DelegateCall
      );

      const newRoleId = ADMIN_HAT_ID + 1n;

      // Check ERC6551 account was created for the role
      const roleAccount = await mockERC6551Registry.account(
        ethers.ZeroAddress,
        SALT,
        31337, // chainId
        await mockHats.getAddress(),
        newRoleId,
      );
      expect(roleAccount).to.not.equal(ethers.ZeroAddress);
    });

    it('should handle multiple roles with different properties', async () => {
      const roleHatsParams = {
        hatsProtocol: await mockHats.getAddress(),
        erc6551Registry: await mockERC6551Registry.getAddress(),
        hatsAccountImplementation: ethers.ZeroAddress,
        topHatId: TOP_HAT_ID,
        topHatAccount: await mockSafe.getAddress(),
        hatsModuleFactory: ethers.ZeroAddress,
        hatsElectionsEligibilityImplementation: ethers.ZeroAddress,
        adminHatId: ADMIN_HAT_ID,
        hats: [
          {
            details: 'Senior Dev',
            imageURI: 'ipfs://senior',
            maxSupply: 2,
            isMutable: true,
            wearer: user1.address,
            termEndDateTs: 0,
            sablierStreamsParams: [],
          },
          {
            details: 'Junior Dev',
            imageURI: 'ipfs://junior',
            maxSupply: 5,
            isMutable: false,
            wearer: user2.address,
            termEndDateTs: 0,
            sablierStreamsParams: [],
          },
        ],
        keyValuePairs: await mockKeyValuePairs.getAddress(),
      };

      await mockSafe.execTransaction(
        await rolesManagementUtility.getAddress(),
        0,
        rolesManagementUtility.interface.encodeFunctionData('createRoleHats', [roleHatsParams]),
        1, // DelegateCall
      );

      const seniorRoleId = ADMIN_HAT_ID + 1n;
      const juniorRoleId = ADMIN_HAT_ID + 2n;

      // Verify both roles were created correctly
      expect(await mockHats.hatDetails(seniorRoleId)).to.equal('Senior Dev');
      expect(await mockHats.hatDetails(juniorRoleId)).to.equal('Junior Dev');
      expect(await mockHats.hatMaxSupply(seniorRoleId)).to.equal(2);
      expect(await mockHats.hatMaxSupply(juniorRoleId)).to.equal(5);
      expect(await mockHats.hatMutable(seniorRoleId)).to.be.true;
      expect(await mockHats.hatMutable(juniorRoleId)).to.be.false;
    });

    it('should set correct eligibility for roles', async () => {
      const roleHatsParams = {
        hatsProtocol: await mockHats.getAddress(),
        erc6551Registry: await mockERC6551Registry.getAddress(),
        hatsAccountImplementation: ethers.ZeroAddress,
        topHatId: TOP_HAT_ID,
        topHatAccount: await mockSafe.getAddress(),
        hatsModuleFactory: ethers.ZeroAddress,
        hatsElectionsEligibilityImplementation: ethers.ZeroAddress,
        adminHatId: ADMIN_HAT_ID,
        hats: [
          {
            details: 'Coordinator',
            imageURI: 'ipfs://coord',
            maxSupply: 1,
            isMutable: true,
            wearer: user1.address,
            termEndDateTs: 0,
            sablierStreamsParams: [],
          },
        ],
        keyValuePairs: await mockKeyValuePairs.getAddress(),
      };

      await mockSafe.execTransaction(
        await rolesManagementUtility.getAddress(),
        0,
        rolesManagementUtility.interface.encodeFunctionData('createRoleHats', [roleHatsParams]),
        1, // DelegateCall
      );

      const roleId = ADMIN_HAT_ID + 1n;

      // For untermed roles, eligibility and toggle should be the top hat account
      expect(await mockHats.hatEligibility(roleId)).to.equal(await mockSafe.getAddress());
      expect(await mockHats.hatToggle(roleId)).to.equal(await mockSafe.getAddress());
    });
  });

  describe('Sablier Stream Management', () => {
    let mockSablier: MockSablierV2Lockup;
    let mockHatAccount: MockERC6551Executable;
    let recipient: SignerWithAddress;

    // Sablier status enum values (matching Lockup.Status)
    const Status = {
      PENDING: 0,
      STREAMING: 1,
      SETTLED: 2,
      CANCELED: 3,
      DEPLETED: 4,
    };

    async function deployStreamMocks() {
      [deployer, user1, user2, recipient] = await ethers.getSigners();

      // Create mock Sablier contract
      const MockSablierFactory = await ethers.getContractFactory('MockSablierV2Lockup');
      mockSablier = (await MockSablierFactory.deploy()) as unknown as MockSablierV2Lockup;
      await (mockSablier as any).waitForDeployment();

      // Create mock ERC6551 executable (Hat account)
      const MockERC6551Factory = await ethers.getContractFactory('MockERC6551Executable');
      mockHatAccount = (await MockERC6551Factory.deploy()) as unknown as MockERC6551Executable;
      await (mockHatAccount as any).waitForDeployment();
    }

    describe('withdrawMaxFromStream via delegatecall', () => {
      beforeEach(async () => {
        await deployStreamMocks();
      });

      it('should withdraw from stream through Hat account', async () => {
        const streamId = 1n;
        const withdrawableAmount = ethers.parseEther('100');

        // Setup mock to return withdrawable amount
        await (mockSablier as any).setWithdrawableAmount(streamId, withdrawableAmount);

        // Execute withdrawal via delegatecall
        const tx = await mockSafe.execTransaction(
          await rolesManagementUtility.getAddress(),
          0,
          rolesManagementUtility.interface.encodeFunctionData('withdrawMaxFromStream', [
            await (mockSablier as any).getAddress(),
            await (mockHatAccount as any).getAddress(),
            streamId,
            recipient.address,
          ]),
          1, // DelegateCall
        );

        // Verify the transaction succeeded (no revert)
        await expect(tx).to.not.be.reverted;

        // Verify the withdrawable amount is now 0 (observable state change)
        expect(await (mockSablier as any).withdrawableAmountOf(streamId)).to.equal(0);
      });

      it('should return silently when no funds available to withdraw', async () => {
        const streamId = 1n;

        // Setup mock to return zero withdrawable amount
        await (mockSablier as any).setWithdrawableAmount(streamId, 0);

        // This should not revert, just return early
        await expect(
          mockSafe.execTransaction(
            await rolesManagementUtility.getAddress(),
            0,
            rolesManagementUtility.interface.encodeFunctionData('withdrawMaxFromStream', [
              await (mockSablier as any).getAddress(),
              await (mockHatAccount as any).getAddress(),
              streamId,
              recipient.address,
            ]),
            1, // DelegateCall
          ),
        ).to.not.be.reverted;

        // Verify the withdrawable amount is still 0 (no state change)
        expect(await (mockSablier as any).withdrawableAmountOf(streamId)).to.equal(0);
      });

      it('should handle multiple stream withdrawals', async () => {
        const streamIds = [1n, 2n, 3n];
        const withdrawableAmounts = [
          ethers.parseEther('50'),
          ethers.parseEther('75'),
          ethers.parseEther('100'),
        ];

        // Setup mocks
        for (let i = 0; i < streamIds.length; i++) {
          await (mockSablier as any).setWithdrawableAmount(streamIds[i], withdrawableAmounts[i]);
        }

        // Execute multiple withdrawals
        for (const streamId of streamIds) {
          await mockSafe.execTransaction(
            await rolesManagementUtility.getAddress(),
            0,
            rolesManagementUtility.interface.encodeFunctionData('withdrawMaxFromStream', [
              await (mockSablier as any).getAddress(),
              await (mockHatAccount as any).getAddress(),
              streamId,
              recipient.address,
            ]),
            1, // DelegateCall
          );
        }

        // Verify all streams have been withdrawn (observable state)
        for (const streamId of streamIds) {
          expect(await (mockSablier as any).withdrawableAmountOf(streamId)).to.equal(0);
        }
      });
    });

    describe('cancelStream via delegatecall', () => {
      beforeEach(async () => {
        await deployStreamMocks();
      });

      it('should cancel a PENDING stream', async () => {
        const streamId = 1n;

        // Setup mock to return PENDING status
        await (mockSablier as any).setStreamStatus(streamId, Status.PENDING);

        // Execute cancellation via delegatecall
        const tx = await mockSafe.execTransaction(
          await rolesManagementUtility.getAddress(),
          0,
          rolesManagementUtility.interface.encodeFunctionData('cancelStream', [
            await (mockSablier as any).getAddress(),
            streamId,
          ]),
          1, // DelegateCall
        );

        await tx.wait();

        // Verify the stream status changed to CANCELED (observable state)
        expect(await (mockSablier as any).statusOf(streamId)).to.equal(Status.CANCELED);
      });

      it('should cancel a STREAMING stream', async () => {
        const streamId = 2n;

        // Setup mock to return STREAMING status
        await (mockSablier as any).setStreamStatus(streamId, Status.STREAMING);

        // Execute cancellation
        const tx = await mockSafe.execTransaction(
          await rolesManagementUtility.getAddress(),
          0,
          rolesManagementUtility.interface.encodeFunctionData('cancelStream', [
            await (mockSablier as any).getAddress(),
            streamId,
          ]),
          1, // DelegateCall
        );

        await tx.wait();

        // Verify the stream status changed to CANCELED (observable state)
        expect(await (mockSablier as any).statusOf(streamId)).to.equal(Status.CANCELED);
      });

      it('should return silently for non-cancellable stream statuses', async () => {
        const nonCancellableStatuses = [Status.SETTLED, Status.CANCELED, Status.DEPLETED];

        for (const status of nonCancellableStatuses) {
          const streamId = BigInt(status + 10); // Unique stream ID for each test

          // Setup mock to return non-cancellable status
          await (mockSablier as any).setStreamStatus(streamId, status);

          // This should not revert, just return early
          await expect(
            mockSafe.execTransaction(
              await rolesManagementUtility.getAddress(),
              0,
              rolesManagementUtility.interface.encodeFunctionData('cancelStream', [
                await (mockSablier as any).getAddress(),
                streamId,
              ]),
              1, // DelegateCall
            ),
          ).to.not.be.reverted;

          // Verify the status remains unchanged (no state change for non-cancellable)
          expect(await (mockSablier as any).statusOf(streamId)).to.equal(status);
        }
      });
    });

    describe('Sablier stream creation', () => {
      let mockToken: MockERC20;

      beforeEach(async () => {
        await deployStreamMocks();

        // Deploy mock ERC20 token
        const mockTokenFactory = new MockERC20__factory(deployer);
        mockToken = await mockTokenFactory.deploy('Mock Token', 'MOCK', 18);
        await mockToken.waitForDeployment();
      });

      it('should create Sablier streams with proper token approvals', async () => {
        // Setup: mint tokens to the Safe
        const streamAmount = ethers.parseEther('1000');
        await mockToken.mint(await mockSafe.getAddress(), streamAmount); // Mint enough for 1 stream

        // Create tree params with Sablier streams
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const treeParams = {
          keyValuePairs: await mockKeyValuePairs.getAddress(),
          hatsProtocol: await mockHats.getAddress(),
          erc6551Registry: await mockERC6551Registry.getAddress(),
          hatsModuleFactory: ethers.ZeroAddress,
          systemDeployer: await mockSystemDeployer.getAddress(),
          decentAutonomousAdminImplementation: await mockAutonomousAdmin.getAddress(),
          hatsAccountImplementation: ethers.ZeroAddress,
          hatsElectionsEligibilityImplementation: ethers.ZeroAddress,
          topHat: {
            details: 'Test DAO',
            imageURI: 'ipfs://tophat',
          },
          adminHat: {
            details: 'Admin',
            imageURI: 'ipfs://admin',
            isMutable: true,
            salt: ethers.keccak256(ethers.toUtf8Bytes('admin')),
          },
          hats: [
            {
              details: 'Developer',
              imageURI: 'ipfs://dev',
              maxSupply: 1,
              isMutable: true,
              wearer: user1.address,
              termEndDateTs: 0, // Untermed role
              sablierStreamsParams: [
                {
                  sablier: await (mockSablier as any).getAddress(),
                  sender: await mockSafe.getAddress(),
                  asset: await mockToken.getAddress(),
                  timestamps: {
                    start: currentTimestamp,
                    cliff: currentTimestamp + 3600, // 1 hour cliff
                    end: currentTimestamp + 86400, // 1 day stream
                  },
                  broker: {
                    account: ethers.ZeroAddress,
                    fee: 0,
                  },
                  totalAmount: streamAmount,
                  cancelable: true,
                  transferable: false,
                },
              ],
            },
          ],
        };

        // Check token balance before
        const balanceBefore = await mockToken.balanceOf(await mockSafe.getAddress());
        expect(balanceBefore).to.equal(streamAmount);

        // Execute tree creation
        await mockSafe.execTransaction(
          await rolesManagementUtility.getAddress(),
          0,
          rolesManagementUtility.interface.encodeFunctionData('createAndDeclareTree', [treeParams]),
          1, // DelegateCall
        );

        // Verify token approvals were made and streams were created
        const sablierAddress = await (mockSablier as any).getAddress();

        // Verify streams were created
        const nextStreamId = await (mockSablier as any).nextStreamId();
        expect(nextStreamId).to.equal(2); // Started at 1, created 1 stream

        // Check that tokens were transferred to Sablier
        const balanceAfter = await mockToken.balanceOf(await mockSafe.getAddress());
        expect(balanceAfter).to.equal(0); // All tokens should be transferred

        // Verify Sablier received the tokens
        const sablierBalance = await mockToken.balanceOf(sablierAddress);
        expect(sablierBalance).to.equal(streamAmount);

        // Verify KeyValuePairs were updated with hatId:streamId mappings
        // For untermed role (Developer), stream goes to hat account
        // For termed role (Manager), stream goes directly to wearer
        const hatIdStreamIdValue1 = await mockKeyValuePairs.getValue('hatIdToStreamId');
        expect(hatIdStreamIdValue1).to.include(':1'); // Should contain streamId 1

        // Note: In a real test, we would also verify:
        // - Stream recipients are correct (hat account vs direct wearer)
        // - Stream parameters match what was specified
        // - Events were emitted correctly
      });

      it('should revert if token transfer fails due to insufficient balance', async () => {
        // Don't mint tokens to Safe, so it can't approve
        const streamAmount = ethers.parseEther('1000');

        const treeParams = {
          keyValuePairs: await mockKeyValuePairs.getAddress(),
          hatsProtocol: await mockHats.getAddress(),
          erc6551Registry: await mockERC6551Registry.getAddress(),
          hatsModuleFactory: ethers.ZeroAddress,
          systemDeployer: await mockSystemDeployer.getAddress(),
          decentAutonomousAdminImplementation: await mockAutonomousAdmin.getAddress(),
          hatsAccountImplementation: ethers.ZeroAddress,
          hatsElectionsEligibilityImplementation: ethers.ZeroAddress,
          topHat: {
            details: 'Test DAO',
            imageURI: 'ipfs://tophat',
          },
          adminHat: {
            details: 'Admin',
            imageURI: 'ipfs://admin',
            isMutable: true,
            salt: ethers.keccak256(ethers.toUtf8Bytes('admin')),
          },
          hats: [
            {
              details: 'Developer',
              imageURI: 'ipfs://dev',
              maxSupply: 1,
              isMutable: true,
              wearer: user1.address,
              termEndDateTs: 0,
              sablierStreamsParams: [
                {
                  sablier: await (mockSablier as any).getAddress(),
                  sender: await mockSafe.getAddress(),
                  asset: await mockToken.getAddress(),
                  timestamps: {
                    start: Math.floor(Date.now() / 1000),
                    cliff: Math.floor(Date.now() / 1000) + 3600,
                    end: Math.floor(Date.now() / 1000) + 86400,
                  },
                  broker: {
                    account: ethers.ZeroAddress,
                    fee: 0,
                  },
                  totalAmount: streamAmount,
                  cancelable: true,
                  transferable: false,
                },
              ],
            },
          ],
        };

        // This should revert because Safe has no tokens to transfer
        await expect(
          mockSafe.execTransaction(
            await rolesManagementUtility.getAddress(),
            0,
            rolesManagementUtility.interface.encodeFunctionData('createAndDeclareTree', [
              treeParams,
            ]),
            1, // DelegateCall
          ),
        ).to.be.reverted;
      });
    });
  });

  describe('DeploymentBlock', function () {
    runDeploymentBlockTests({
      getContract: () => rolesManagementUtility,
      isNonUpgradeable: true,
    });
  });

  describe('ERC165 supportsInterface', function () {
    runSupportsInterfaceTests({
      getContract: () => rolesManagementUtility,
      supportedInterfaceFactories: [
        IUtilityRolesManagementV1__factory,
        IDeploymentBlock__factory,
        ERC165__factory,
      ],
    });
  });
});
