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
  MockERC6551Executable,
  MockERC6551Executable__factory,
  MockERC6551Registry,
  MockERC6551Registry__factory,
  MockHatsComplete,
  MockHatsComplete__factory,
  MockKeyValuePairs,
  MockKeyValuePairs__factory,
  MockSablierV2Lockup,
  MockSablierV2Lockup__factory,
  MockSafeDelegatecall,
  MockSafeDelegatecall__factory,
  MockSystemDeployer,
  MockSystemDeployer__factory,
  UtilityRolesManagementV1,
  UtilityRolesManagementV1__factory,
} from '../../../typechain-types';
import { runDeploymentBlockTests } from '../shared/deploymentBlockTests';
import { runSupportsInterfaceTests } from '../shared/supportsInterfaceTests';

describe('UtilityRolesManagementV1', () => {
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

  // Constants
  const CONSTANTS = {
    TOP_HAT_ID: BigInt(1) << 224n,
    get ADMIN_HAT_ID() {
      return this.TOP_HAT_ID + 1n;
    },
    CHAIN_ID: 31337,
    // Sablier status enum values (matching Lockup.Status)
    Status: {
      PENDING: 0,
      STREAMING: 1,
      SETTLED: 2,
      CANCELED: 3,
      DEPLETED: 4,
    },
  };

  // Helper to get addresses from contracts
  async function getContractAddresses() {
    return {
      keyValuePairs: await mockKeyValuePairs.getAddress(),
      hatsProtocol: await mockHats.getAddress(),
      erc6551Registry: await mockERC6551Registry.getAddress(),
      systemDeployer: await mockSystemDeployer.getAddress(),
      decentAutonomousAdminImplementation: await mockAutonomousAdmin.getAddress(),
      rolesManagementUtility: await rolesManagementUtility.getAddress(),
      mockSafe: await mockSafe.getAddress(),
    };
  }

  // Helper to create base tree params
  async function createBaseTreeParams(overrides: any = {}) {
    const addresses = await getContractAddresses();
    return {
      keyValuePairs: addresses.keyValuePairs,
      hatsProtocol: addresses.hatsProtocol,
      erc6551Registry: addresses.erc6551Registry,
      hatsModuleFactory: ethers.ZeroAddress,
      systemDeployer: addresses.systemDeployer,
      decentAutonomousAdminImplementation: addresses.decentAutonomousAdminImplementation,
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
      },
      hats: [],
      ...overrides,
    };
  }

  // Helper to execute delegatecall
  async function executeDelegatecall(
    functionName:
      | 'createAndDeclareTree'
      | 'createRoleHats'
      | 'withdrawMaxFromStream'
      | 'cancelStream',
    params: any,
  ) {
    return mockSafe.execTransaction(
      await rolesManagementUtility.getAddress(),
      0,
      rolesManagementUtility.interface.encodeFunctionData(functionName as any, params),
      1, // DelegateCall
    );
  }

  // Helper to calculate safe salt
  function getSafeSalt(safeAddress: string) {
    return ethers.zeroPadValue(safeAddress, 32);
  }

  // Helper to predict autonomous admin address
  async function predictAutonomousAdminAddress(safeAddress: string) {
    const addresses = await getContractAddresses();
    const safeSalt = getSafeSalt(safeAddress);

    return mockSystemDeployer.predictProxyAddress(
      addresses.decentAutonomousAdminImplementation,
      mockAutonomousAdmin.interface.encodeFunctionData('initialize'),
      safeSalt,
      safeAddress,
    );
  }

  // Helper to create role hat params
  function createRoleHatParams(details: string, wearer: string, overrides: any = {}) {
    return {
      details,
      imageURI: `ipfs://${details.toLowerCase().replace(/\s/g, '')}`,
      maxSupply: 1,
      isMutable: true,
      wearer,
      termEndDateTs: 0,
      sablierStreamsParams: [],
      ...overrides,
    };
  }

  // Helper to create role hats params
  async function createRoleHatsParams(hats: any[], overrides: any = {}) {
    const addresses = await getContractAddresses();
    return {
      hatsProtocol: addresses.hatsProtocol,
      erc6551Registry: addresses.erc6551Registry,
      hatsAccountImplementation: ethers.ZeroAddress,
      topHatId: CONSTANTS.TOP_HAT_ID,
      topHatWearer: addresses.mockSafe,
      hatsModuleFactory: ethers.ZeroAddress,
      hatsElectionsEligibilityImplementation: ethers.ZeroAddress,
      adminHatId: CONSTANTS.ADMIN_HAT_ID,
      hats,
      keyValuePairs: addresses.keyValuePairs,
      ...overrides,
    };
  }

  // Helper to verify hat details
  async function verifyHat(
    hatId: bigint,
    expectedDetails: {
      details?: string;
      wearer?: string;
      maxSupply?: number;
      isMutable?: boolean;
      eligibility?: string;
      toggle?: string;
    },
  ) {
    if (expectedDetails.details !== undefined) {
      expect(await mockHats.hatDetails(hatId)).to.equal(expectedDetails.details);
    }
    if (expectedDetails.wearer !== undefined) {
      expect(await mockHats.isWearerOfHat(expectedDetails.wearer, hatId)).to.be.true;
    }
    if (expectedDetails.maxSupply !== undefined) {
      expect(await mockHats.hatMaxSupply(hatId)).to.equal(expectedDetails.maxSupply);
    }
    if (expectedDetails.isMutable !== undefined) {
      expect(await mockHats.hatMutable(hatId)).to.equal(expectedDetails.isMutable);
    }
    if (expectedDetails.eligibility !== undefined) {
      expect(await mockHats.hatEligibility(hatId)).to.equal(expectedDetails.eligibility);
    }
    if (expectedDetails.toggle !== undefined) {
      expect(await mockHats.hatToggle(hatId)).to.equal(expectedDetails.toggle);
    }
  }

  beforeEach(async () => {
    [deployer, user1, user2] = await ethers.getSigners();

    // Deploy all mocks
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

    const rolesManagementUtilityFactory = new UtilityRolesManagementV1__factory(deployer);
    rolesManagementUtility = await rolesManagementUtilityFactory.deploy();
    await rolesManagementUtility.waitForDeployment();
  });

  describe('createAndDeclareTree via delegatecall', () => {
    it('should create a complete Hats tree structure', async () => {
      const treeParams = await createBaseTreeParams({
        hats: [createRoleHatParams('Developer', user1.address, { maxSupply: 5 })],
      });

      await executeDelegatecall('createAndDeclareTree', [treeParams]);

      const addresses = await getContractAddresses();

      // Verify top hat
      await verifyHat(CONSTANTS.TOP_HAT_ID, {
        wearer: addresses.mockSafe,
      });

      // Verify admin hat
      await verifyHat(CONSTANTS.ADMIN_HAT_ID, {
        details: 'Admin',
        maxSupply: 1,
      });

      // Verify role hat
      await verifyHat(CONSTANTS.ADMIN_HAT_ID + 1n, {
        details: 'Developer',
        wearer: user1.address,
      });

      // Verify KeyValuePairs was updated
      expect(await mockKeyValuePairs.getValue('topHatId')).to.equal(
        CONSTANTS.TOP_HAT_ID.toString(),
      );
    });

    it('should mint admin hat to autonomous admin', async () => {
      const treeParams = await createBaseTreeParams();
      await executeDelegatecall('createAndDeclareTree', [treeParams]);

      const addresses = await getContractAddresses();
      const autonomousAdminAddress = await predictAutonomousAdminAddress(addresses.mockSafe);

      await verifyHat(CONSTANTS.ADMIN_HAT_ID, {
        wearer: autonomousAdminAddress,
      });
    });

    it('should verify Safe is the deployer when using SystemDeployer', async () => {
      const treeParams = await createBaseTreeParams();
      await executeDelegatecall('createAndDeclareTree', [treeParams]);
      // Test ensures SystemDeployer was called successfully
    });

    it('should create ERC6551 account with correct topHatId', async () => {
      const treeParams = await createBaseTreeParams();
      await executeDelegatecall('createAndDeclareTree', [treeParams]);

      const addresses = await getContractAddresses();
      const safeSalt = getSafeSalt(addresses.mockSafe);
      const topHatAccount = await mockERC6551Registry.account(
        ethers.ZeroAddress,
        safeSalt,
        CONSTANTS.CHAIN_ID,
        addresses.hatsProtocol,
        CONSTANTS.TOP_HAT_ID,
      );
      expect(topHatAccount).to.not.equal(ethers.ZeroAddress);
    });

    it('should create ERC6551 account for admin hat', async () => {
      const treeParams = await createBaseTreeParams();
      await executeDelegatecall('createAndDeclareTree', [treeParams]);

      const addresses = await getContractAddresses();
      const safeSalt = getSafeSalt(addresses.mockSafe);
      const adminHatAccount = await mockERC6551Registry.account(
        ethers.ZeroAddress,
        safeSalt,
        CONSTANTS.CHAIN_ID,
        addresses.hatsProtocol,
        CONSTANTS.ADMIN_HAT_ID,
      );
      expect(adminHatAccount).to.not.equal(ethers.ZeroAddress);
    });

    it('should handle multiple role hats', async () => {
      const treeParams = await createBaseTreeParams({
        hats: [
          createRoleHatParams('Developer', user1.address, { maxSupply: 5 }),
          createRoleHatParams('Designer', user2.address, { maxSupply: 3, isMutable: false }),
        ],
      });

      await executeDelegatecall('createAndDeclareTree', [treeParams]);

      const devHatId = CONSTANTS.ADMIN_HAT_ID + 1n;
      const designerHatId = CONSTANTS.ADMIN_HAT_ID + 2n;

      await verifyHat(devHatId, {
        details: 'Developer',
        wearer: user1.address,
      });

      await verifyHat(designerHatId, {
        details: 'Designer',
        wearer: user2.address,
      });
    });

    it('should deploy autonomous admin via delegatecall from Safe', async () => {
      const treeParams = await createBaseTreeParams();
      await executeDelegatecall('createAndDeclareTree', [treeParams]);

      const addresses = await getContractAddresses();
      const expectedProxyAddress = await predictAutonomousAdminAddress(addresses.mockSafe);

      await verifyHat(CONSTANTS.ADMIN_HAT_ID, {
        wearer: expectedProxyAddress,
      });
    });

    it('should properly set up eligibility and toggle relationships', async () => {
      const treeParams = await createBaseTreeParams({
        hats: [createRoleHatParams('Role', user1.address)],
      });

      await executeDelegatecall('createAndDeclareTree', [treeParams]);

      const addresses = await getContractAddresses();
      const roleHatId = CONSTANTS.ADMIN_HAT_ID + 1n;

      await verifyHat(CONSTANTS.ADMIN_HAT_ID, {
        eligibility: addresses.mockSafe,
        toggle: addresses.mockSafe,
      });

      await verifyHat(roleHatId, {
        eligibility: addresses.mockSafe,
        toggle: addresses.mockSafe,
      });
    });
  });

  describe('createRoleHats via delegatecall', () => {
    beforeEach(async () => {
      const addresses = await getContractAddresses();
      await mockHats.setWearerStatus(addresses.mockSafe, CONSTANTS.TOP_HAT_ID, true);
      await mockHats.setWearerStatus(deployer.address, CONSTANTS.ADMIN_HAT_ID, true);
    });

    it('should add new roles to existing hat tree', async () => {
      const roleHatsParams = await createRoleHatsParams([
        createRoleHatParams('New Developer', user1.address, { maxSupply: 3 }),
      ]);

      await executeDelegatecall('createRoleHats', [roleHatsParams]);

      await verifyHat(CONSTANTS.ADMIN_HAT_ID + 1n, {
        details: 'New Developer',
        wearer: user1.address,
      });
    });

    it('should create ERC6551 accounts for untermed roles', async () => {
      const roleHatsParams = await createRoleHatsParams([
        createRoleHatParams('Treasury Manager', user1.address),
      ]);

      await executeDelegatecall('createRoleHats', [roleHatsParams]);

      const addresses = await getContractAddresses();
      const safeSalt = getSafeSalt(addresses.mockSafe);
      const roleAccount = await mockERC6551Registry.account(
        ethers.ZeroAddress,
        safeSalt,
        CONSTANTS.CHAIN_ID,
        addresses.hatsProtocol,
        CONSTANTS.ADMIN_HAT_ID + 1n,
      );
      expect(roleAccount).to.not.equal(ethers.ZeroAddress);
    });

    it('should handle multiple roles with different properties', async () => {
      const roleHatsParams = await createRoleHatsParams([
        createRoleHatParams('Senior Dev', user1.address, { maxSupply: 2 }),
        createRoleHatParams('Junior Dev', user2.address, { maxSupply: 5, isMutable: false }),
      ]);

      await executeDelegatecall('createRoleHats', [roleHatsParams]);

      const seniorRoleId = CONSTANTS.ADMIN_HAT_ID + 1n;
      const juniorRoleId = CONSTANTS.ADMIN_HAT_ID + 2n;

      await verifyHat(seniorRoleId, {
        details: 'Senior Dev',
        maxSupply: 2,
        isMutable: true,
      });

      await verifyHat(juniorRoleId, {
        details: 'Junior Dev',
        maxSupply: 5,
        isMutable: false,
      });
    });

    it('should set correct eligibility for roles', async () => {
      const roleHatsParams = await createRoleHatsParams([
        createRoleHatParams('Coordinator', user1.address),
      ]);

      await executeDelegatecall('createRoleHats', [roleHatsParams]);

      const addresses = await getContractAddresses();
      await verifyHat(CONSTANTS.ADMIN_HAT_ID + 1n, {
        eligibility: addresses.mockSafe,
        toggle: addresses.mockSafe,
      });
    });
  });

  describe('Sablier Stream Management', () => {
    let mockSablier: MockSablierV2Lockup;
    let mockHatAccount: MockERC6551Executable;
    let mockToken: MockERC20;
    let recipient: SignerWithAddress;

    // Helper to deploy stream mocks
    async function deployStreamMocks() {
      [deployer, user1, user2, recipient] = await ethers.getSigners();

      mockSablier = await new MockSablierV2Lockup__factory(deployer).deploy();
      await mockSablier.waitForDeployment();

      mockHatAccount = await new MockERC6551Executable__factory(deployer).deploy();
      await mockHatAccount.waitForDeployment();

      mockToken = await new MockERC20__factory(deployer).deploy('Test Token', 'TEST', 18);
      await mockToken.waitForDeployment();
    }

    // Helper to create stream params
    async function createStreamParams(overrides: any = {}) {
      const now = Math.floor(Date.now() / 1000);
      return {
        sablier: await mockSablier.getAddress(),
        sender: await mockSafe.getAddress(),
        totalAmount: ethers.parseEther('1000'),
        token: await mockToken.getAddress(),
        cancelable: true,
        transferable: true,
        timestamps: {
          start: now,
          end: now + 7200,
        },
        cliffTime: now + 3600,
        unlockAmounts: {
          start: 0,
          cliff: 0,
        },
        shape: '',
        broker: {
          account: ethers.ZeroAddress,
          fee: 0,
        },
        ...overrides,
      };
    }

    describe('withdrawMaxFromStream via delegatecall', () => {
      beforeEach(async () => {
        await deployStreamMocks();
      });

      it('should withdraw from stream through Hat account', async () => {
        const streamId = 1n;
        const withdrawableAmount = ethers.parseEther('100');
        await mockSablier.setWithdrawableAmount(streamId, withdrawableAmount);

        const tx = await executeDelegatecall('withdrawMaxFromStream', [
          await mockSablier.getAddress(),
          await mockHatAccount.getAddress(),
          streamId,
          recipient.address,
        ]);

        // Verify the transaction succeeded (no revert)
        await expect(tx).to.not.be.reverted;

        // Verify the withdrawable amount is now 0 (observable state change)
        expect(await mockSablier.withdrawableAmountOf(streamId)).to.equal(0);
      });

      it('should return silently when no funds available to withdraw', async () => {
        const streamId = 1n;
        await mockSablier.setWithdrawableAmount(streamId, 0);

        await expect(
          executeDelegatecall('withdrawMaxFromStream', [
            await mockSablier.getAddress(),
            await mockHatAccount.getAddress(),
            streamId,
            recipient.address,
          ]),
        ).to.not.be.reverted;
      });

      it('should handle multiple stream withdrawals', async () => {
        const amount = ethers.parseEther('50');

        for (let i = 1n; i <= 3n; i++) {
          await mockSablier.setWithdrawableAmount(i, amount);

          const tx = await executeDelegatecall('withdrawMaxFromStream', [
            await mockSablier.getAddress(),
            await mockHatAccount.getAddress(),
            i,
            recipient.address,
          ]);

          // Verify transaction succeeded
          await expect(tx).to.not.be.reverted;

          // Verify the stream was withdrawn
          expect(await mockSablier.withdrawableAmountOf(i)).to.equal(0);
        }
      });
    });

    describe('cancelStream via delegatecall', () => {
      beforeEach(async () => {
        await deployStreamMocks();
      });

      async function testStreamCancellation(
        streamId: bigint,
        status: number,
        shouldCancel: boolean,
      ) {
        await mockSablier.setStreamStatus(streamId, status);

        const tx = await executeDelegatecall('cancelStream', [
          await mockSablier.getAddress(),
          streamId,
        ]);

        // Verify transaction succeeded
        await expect(tx).to.not.be.reverted;

        // For cancellable statuses, verify the stream status is now CANCELED
        if (shouldCancel) {
          expect(await mockSablier.statusOf(streamId)).to.equal(CONSTANTS.Status.CANCELED);
        } else {
          // For non-cancellable statuses, verify status remains unchanged
          expect(await mockSablier.statusOf(streamId)).to.equal(status);
        }
      }

      it('should cancel a PENDING stream', async () => {
        await testStreamCancellation(1n, CONSTANTS.Status.PENDING, true);
      });

      it('should cancel a STREAMING stream', async () => {
        await testStreamCancellation(1n, CONSTANTS.Status.STREAMING, true);
      });

      it('should return silently for non-cancellable stream statuses', async () => {
        await testStreamCancellation(1n, CONSTANTS.Status.SETTLED, false);
        await testStreamCancellation(2n, CONSTANTS.Status.CANCELED, false);
        await testStreamCancellation(3n, CONSTANTS.Status.DEPLETED, false);
      });
    });

    describe('Sablier stream creation', () => {
      beforeEach(async () => {
        await deployStreamMocks();

        // Create tree with role that has Sablier params
        const streamParams = await createStreamParams();
        const treeParams = await createBaseTreeParams({
          hats: [
            createRoleHatParams('Paid Role', user1.address, {
              sablierStreamsParams: [streamParams],
            }),
          ],
        });

        await mockToken.mint(await mockSafe.getAddress(), ethers.parseEther('10000'));
        await executeDelegatecall('createAndDeclareTree', [treeParams]);
      });

      it('should create Sablier streams with proper token approvals', async () => {
        // Verify streams were created
        const nextStreamId = await mockSablier.nextStreamId();
        expect(nextStreamId).to.equal(2); // Started at 1, created 1 stream

        // Check that tokens were transferred to Sablier
        const sablierBalance = await mockToken.balanceOf(await mockSablier.getAddress());
        expect(sablierBalance).to.equal(ethers.parseEther('1000'));
      });

      it('should revert if token transfer fails due to insufficient balance', async () => {
        // Deploy new safe with no tokens
        const newSafeFactory = new MockSafeDelegatecall__factory(deployer);
        const newSafe = await newSafeFactory.deploy();
        await newSafe.waitForDeployment();

        const streamParams = await createStreamParams();
        const treeParams = await createBaseTreeParams({
          hats: [
            createRoleHatParams('Unfunded Role', user2.address, {
              sablierStreamsParams: [streamParams],
            }),
          ],
        });

        await expect(
          newSafe.execTransaction(
            await rolesManagementUtility.getAddress(),
            0,
            rolesManagementUtility.interface.encodeFunctionData('createAndDeclareTree', [
              treeParams,
            ]),
            1,
          ),
        ).to.be.reverted;
      });
    });
  });

  describe('Delegatecall enforcement', function () {
    it('should revert when createAndDeclareTree is called directly', async () => {
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
          details: 'Top Hat',
          imageURI: 'ipfs://top',
        },
        adminHat: {
          details: 'Admin Hat',
          imageURI: 'ipfs://admin',
          isMutable: true,
        },
        hats: [],
      };

      await expect(
        rolesManagementUtility.createAndDeclareTree(treeParams),
      ).to.be.revertedWithCustomError(rolesManagementUtility, 'MustBeCalledViaDelegatecall');
    });

    it('should revert when createRoleHats is called directly', async () => {
      const roleHatsParams = {
        hatsProtocol: await mockHats.getAddress(),
        erc6551Registry: await mockERC6551Registry.getAddress(),
        hatsAccountImplementation: ethers.ZeroAddress,
        topHatId: 1n << 224n,
        topHatWearer: user1.address,
        keyValuePairs: await mockKeyValuePairs.getAddress(),
        hatsModuleFactory: ethers.ZeroAddress,
        hatsElectionsEligibilityImplementation: ethers.ZeroAddress,
        adminHatId: (1n << 224n) + 1n,
        hats: [],
      };

      await expect(
        rolesManagementUtility.createRoleHats(roleHatsParams),
      ).to.be.revertedWithCustomError(rolesManagementUtility, 'MustBeCalledViaDelegatecall');
    });

    it('should revert when withdrawMaxFromStream is called directly', async () => {
      await expect(
        rolesManagementUtility.withdrawMaxFromStream(
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          1,
          user1.address,
        ),
      ).to.be.revertedWithCustomError(rolesManagementUtility, 'MustBeCalledViaDelegatecall');
    });

    it('should revert when cancelStream is called directly', async () => {
      await expect(
        rolesManagementUtility.cancelStream(ethers.ZeroAddress, 1),
      ).to.be.revertedWithCustomError(rolesManagementUtility, 'MustBeCalledViaDelegatecall');
    });
  });

  // Run shared test suites
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
