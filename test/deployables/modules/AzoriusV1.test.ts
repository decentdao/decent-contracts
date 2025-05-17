import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  AzoriusV1,
  AzoriusV1__factory,
  ERC1967Proxy__factory,
  IAzoriusV1__factory,
  IERC165__factory,
  IVersion__factory,
  MockAvatar,
  MockAvatar__factory,
  MockERC20Votes,
  MockERC20Votes__factory,
  MockVotingStrategy,
  MockVotingStrategy__factory,
  UUPSUpgradeable,
} from '../../../typechain-types';
import { calculateInterfaceId } from '../../helpers/utils';
import { runUUPSUpgradeabilityTests } from '../../helpers/uupsUpgradeabilityTests';

// Helper functions for deploying AzoriusV1 instances using ERC1967Proxy
async function deployAzoriusProxy(
  proxyDeployer: SignerWithAddress,
  implementation: string,
  owner: SignerWithAddress,
  avatar: string,
  target: string,
  strategies: string[],
  timelockPeriod: number,
  executionPeriod: number,
): Promise<AzoriusV1> {
  // Combine selector and encoded params
  const fullInitData =
    AzoriusV1__factory.createInterface().getFunction('initialize').selector +
    ethers.AbiCoder.defaultAbiCoder()
      .encode(
        ['address', 'address', 'address', 'address[]', 'uint32', 'uint32'],
        [owner.address, avatar, target, strategies, timelockPeriod, executionPeriod],
      )
      .slice(2);

  // Deploy the proxy with the implementation
  const proxy = await new ERC1967Proxy__factory(proxyDeployer).deploy(implementation, fullInitData);

  // Return a contract instance connected to the proxy
  return AzoriusV1__factory.connect(await proxy.getAddress(), owner);
}

// Helper function for deploying AzoriusV1 using setUp instead of initialize
async function deployAzoriusProxyWithSetUp(
  proxyDeployer: SignerWithAddress,
  implementation: string,
  owner: SignerWithAddress,
  avatar: string,
  target: string,
  strategies: string[],
  timelockPeriod: number,
  executionPeriod: number,
): Promise<AzoriusV1> {
  // Create the call to setUp with the encoded parameters
  const fullInitData = AzoriusV1__factory.createInterface().encodeFunctionData('setUp', [
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'address', 'address[]', 'uint32', 'uint32'],
      [owner.address, avatar, target, strategies, timelockPeriod, executionPeriod],
    ),
  ]);

  // Deploy the proxy with the implementation
  const proxy = await new ERC1967Proxy__factory(proxyDeployer).deploy(implementation, fullInitData);

  // Return a contract instance connected to the proxy
  return AzoriusV1__factory.connect(await proxy.getAddress(), owner);
}

describe('AzoriusV1', () => {
  // eoas
  let proxyDeployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let proposer: SignerWithAddress;
  let user: SignerWithAddress;
  let nonOwner: SignerWithAddress;

  // mocks and mastercopies
  let implementation: AzoriusV1;
  let masterCopy: string;

  // constants
  const SENTINEL_STRATEGY = '0x0000000000000000000000000000000000000001';

  beforeEach(async () => {
    // Get signers
    [proxyDeployer, owner, proposer, user, nonOwner] = await ethers.getSigners();

    // Deploy implementation contract
    implementation = await new AzoriusV1__factory(proxyDeployer).deploy();
    masterCopy = await implementation.getAddress();
  });

  describe('Initialization', () => {
    let azorius: AzoriusV1;
    let avatar: MockAvatar;

    beforeEach(async () => {
      avatar = await new MockAvatar__factory(proxyDeployer).deploy();
    });

    describe('Owner parameter', () => {
      it('Sets correct owner', async () => {
        azorius = await deployAzoriusProxy(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          await avatar.getAddress(),
          [],
          100,
          200,
        );

        expect(await azorius.owner()).to.equal(owner.address);
      });
    });

    describe('Avatar and Target parameters', () => {
      it('should initialize with same avatar and target', async () => {
        azorius = await deployAzoriusProxy(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          await avatar.getAddress(), // Same as avatar
          [],
          100,
          200,
        );

        expect(await azorius.avatar()).to.equal(await avatar.getAddress());
        expect(await azorius.getFunction('target')()).to.equal(await avatar.getAddress());
      });

      it('should initialize with different target than avatar', async () => {
        azorius = await deployAzoriusProxy(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          user.address,
          [],
          100,
          200,
        );

        expect(await azorius.avatar()).to.equal(await avatar.getAddress());
        expect(await azorius.getFunction('target')()).to.equal(user.address);
      });

      it('should allow zero address avatar', async () => {
        azorius = await deployAzoriusProxy(
          proxyDeployer,
          masterCopy,
          owner,
          ethers.ZeroAddress,
          await avatar.getAddress(),
          [],
          100,
          200,
        );

        expect(await azorius.avatar()).to.equal(ethers.ZeroAddress);
      });

      it('should allow zero address target', async () => {
        azorius = await deployAzoriusProxy(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          ethers.ZeroAddress,
          [],
          100,
          200,
        );

        expect(await azorius.getFunction('target')()).to.equal(ethers.ZeroAddress);
      });

      it('should allow both avatar and target to be zero address', async () => {
        azorius = await deployAzoriusProxy(
          proxyDeployer,
          masterCopy,
          owner,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          [],
          100,
          200,
        );

        expect(await azorius.avatar()).to.equal(ethers.ZeroAddress);
        expect(await azorius.getFunction('target')()).to.equal(ethers.ZeroAddress);
      });
    });

    describe('Strategies parameter', () => {
      describe('No strategies', () => {
        it('should initialize with no strategies', async () => {
          azorius = await deployAzoriusProxy(
            proxyDeployer,
            masterCopy,
            owner,
            await avatar.getAddress(),
            await avatar.getAddress(),
            [], // empty strategies array
            100,
            200,
          );

          const [strategies, next] = await azorius.getStrategies(SENTINEL_STRATEGY, 1);
          expect(strategies.length).to.equal(0);
          expect(next).to.equal(SENTINEL_STRATEGY);
        });

        it('should not allow zero address strategy', async () => {
          await expect(
            deployAzoriusProxy(
              proxyDeployer,
              masterCopy,
              owner,
              await avatar.getAddress(),
              await avatar.getAddress(),
              [ethers.ZeroAddress],
              100,
              200,
            ),
          ).to.be.reverted;
        });

        it('should not allow sentinel address as strategy', async () => {
          await expect(
            deployAzoriusProxy(
              proxyDeployer,
              masterCopy,
              owner,
              await avatar.getAddress(),
              await avatar.getAddress(),
              [SENTINEL_STRATEGY],
              100,
              200,
            ),
          ).to.be.reverted;
        });
      });

      describe('Single strategy', () => {
        let mockStrategy: MockVotingStrategy;

        beforeEach(async () => {
          // Deploy a strategy for testing
          mockStrategy = await new MockVotingStrategy__factory(proxyDeployer).deploy(
            proposer.address,
          );
        });

        it('should initialize with single strategy', async () => {
          azorius = await deployAzoriusProxy(
            proxyDeployer,
            masterCopy,
            owner,
            await avatar.getAddress(),
            await avatar.getAddress(),
            [await mockStrategy.getAddress()],
            100,
            200,
          );

          void expect(await azorius.isStrategyEnabled(await mockStrategy.getAddress())).to.be.true;
          const [strategies, next] = await azorius.getStrategies(SENTINEL_STRATEGY, 10);
          expect(strategies.length).to.equal(1);
          expect(strategies[0]).to.equal(await mockStrategy.getAddress());
          expect(next).to.equal(SENTINEL_STRATEGY);
        });
      });

      describe('Multiple strategies', () => {
        it('should initialize with multiple strategies in correct order', async () => {
          // Deploy multiple strategies
          const strategy1 = await new MockVotingStrategy__factory(proxyDeployer).deploy(
            proposer.address,
          );
          const strategy2 = await new MockVotingStrategy__factory(proxyDeployer).deploy(
            proposer.address,
          );
          const strategy3 = await new MockVotingStrategy__factory(proxyDeployer).deploy(
            proposer.address,
          );

          const initialStrategies = [
            await strategy1.getAddress(),
            await strategy2.getAddress(),
            await strategy3.getAddress(),
          ];

          azorius = await deployAzoriusProxy(
            proxyDeployer,
            masterCopy,
            owner,
            await avatar.getAddress(),
            await avatar.getAddress(),
            initialStrategies,
            100,
            200,
          );

          // Verify all strategies are enabled
          for (const strategy of initialStrategies) {
            void expect(await azorius.isStrategyEnabled(strategy)).to.be.true;
          }

          // Verify strategies are in correct order (reverse of input order due to linked list structure)
          const [strategies, next] = await azorius.getStrategies(SENTINEL_STRATEGY, 10);
          expect(strategies.length).to.equal(initialStrategies.length);
          for (let i = 0; i < strategies.length; i++) {
            expect(strategies[i]).to.equal(initialStrategies[initialStrategies.length - 1 - i]);
          }
          expect(next).to.equal(SENTINEL_STRATEGY);
        });

        it('should not allow duplicate strategies', async () => {
          const mockStrategy = await new MockVotingStrategy__factory(proxyDeployer).deploy(
            proposer.address,
          );

          await expect(
            deployAzoriusProxy(
              proxyDeployer,
              masterCopy,
              owner,
              await avatar.getAddress(),
              await avatar.getAddress(),
              [await mockStrategy.getAddress(), await mockStrategy.getAddress()],
              100,
              200,
            ),
          ).to.be.reverted;
        });
      });
    });

    describe('Timelock and Execution periods', () => {
      it('should initialize with non-zero periods', async () => {
        const timelockPeriod = 100;
        const executionPeriod = 200;

        azorius = await deployAzoriusProxy(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          await avatar.getAddress(),
          [],
          timelockPeriod,
          executionPeriod,
        );

        expect(await azorius.timelockPeriod()).to.equal(timelockPeriod);
        expect(await azorius.executionPeriod()).to.equal(executionPeriod);
      });

      it('should initialize with zero periods', async () => {
        azorius = await deployAzoriusProxy(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          await avatar.getAddress(),
          [],
          0,
          0,
        );

        expect(await azorius.timelockPeriod()).to.equal(0);
        expect(await azorius.executionPeriod()).to.equal(0);
      });

      it('should initialize with max uint32 periods', async () => {
        const maxUint32 = 2 ** 32 - 1;

        azorius = await deployAzoriusProxy(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          await avatar.getAddress(),
          [],
          maxUint32,
          maxUint32,
        );

        expect(await azorius.timelockPeriod()).to.equal(maxUint32);
        expect(await azorius.executionPeriod()).to.equal(maxUint32);
      });
    });

    describe('Reinitialization prevention', () => {
      it('should not allow reinitialization', async () => {
        azorius = await deployAzoriusProxy(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          await avatar.getAddress(),
          [],
          100,
          200,
        );

        await expect(
          azorius.initialize(owner.address, ethers.ZeroAddress, ethers.ZeroAddress, [], 0, 0),
        ).to.be.revertedWithCustomError(azorius, 'InvalidInitialization');
      });

      it('Should have initialization disabled in the implementation', async function () {
        const implementationContract = AzoriusV1__factory.connect(masterCopy, proxyDeployer);

        await expect(
          implementationContract.initialize(
            owner.address,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            [],
            0,
            0,
          ),
        ).to.be.revertedWithCustomError(implementationContract, 'InvalidInitialization');
      });
    });

    describe('setUp function', () => {
      it('should correctly initialize contract when using setUp', async () => {
        azorius = await deployAzoriusProxyWithSetUp(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          await avatar.getAddress(),
          [],
          100,
          200,
        );

        // Verify initialization was successful
        expect(await azorius.owner()).to.equal(owner.address);
        expect(await azorius.avatar()).to.equal(await avatar.getAddress());
        expect(await azorius.getFunction('target')()).to.equal(await avatar.getAddress());
        expect(await azorius.timelockPeriod()).to.equal(100);
        expect(await azorius.executionPeriod()).to.equal(200);
      });

      it('should not allow setUp to be called again after initialization', async () => {
        azorius = await deployAzoriusProxyWithSetUp(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          await avatar.getAddress(),
          [],
          100,
          200,
        );

        // Encode parameters correctly for setUp
        const innerParams = ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'address', 'address', 'address[]', 'uint32', 'uint32'],
          [owner.address, await avatar.getAddress(), await avatar.getAddress(), [], 100, 200],
        );

        // Attempt to call setUp again - should revert
        await expect(azorius.setUp(innerParams)).to.be.revertedWithCustomError(
          azorius,
          'InvalidInitialization',
        );
      });
    });
  });

  describe('Strategy Tests', () => {
    let azorius: AzoriusV1;
    let mockStrategy: MockVotingStrategy;
    let strategyList: string[];

    beforeEach(async () => {
      // Deploy initial strategy
      mockStrategy = await new MockVotingStrategy__factory(proxyDeployer).deploy(proposer.address);

      // Deploy avatar
      const avatar = await new MockAvatar__factory(proxyDeployer).deploy();

      // Deploy Azorius with initial strategy
      azorius = await deployAzoriusProxy(
        proxyDeployer,
        masterCopy,
        owner,
        await avatar.getAddress(),
        await avatar.getAddress(),
        [await mockStrategy.getAddress()],
        0,
        0,
      );
    });

    describe('Strategy Management', () => {
      let newStrategy: MockVotingStrategy;

      beforeEach(async () => {
        // Deploy new strategy for testing
        newStrategy = await new MockVotingStrategy__factory(proxyDeployer).deploy(proposer.address);
      });

      describe('Enabling and disabling strategies via owner', () => {
        beforeEach(async () => {
          await azorius.enableStrategy(await newStrategy.getAddress());
        });

        it('should allow owner to enable new strategy', async () => {
          void expect(await azorius.isStrategyEnabled(await newStrategy.getAddress())).to.be.true;
        });

        it('should allow owner to disable strategy', async () => {
          await azorius.disableStrategy(SENTINEL_STRATEGY, await newStrategy.getAddress());
          void expect(await azorius.isStrategyEnabled(await newStrategy.getAddress())).to.be.false;
        });
      });

      describe('Enabling and disabling strategies via non-owner', () => {
        it('should not allow non-owner to enable strategy', async () => {
          await expect(
            azorius.connect(user).enableStrategy(await newStrategy.getAddress()),
          ).to.be.revertedWithCustomError(azorius, 'OwnableUnauthorizedAccount');
        });
      });

      describe('Invalid strategy addresses', () => {
        it('should not allow enabling zero address strategy', async () => {
          await expect(azorius.enableStrategy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
            azorius,
            'InvalidStrategy',
          );
        });

        it('should not allow enabling sentinel strategy', async () => {
          await expect(azorius.enableStrategy(SENTINEL_STRATEGY)).to.be.revertedWithCustomError(
            azorius,
            'InvalidStrategy',
          );
        });
      });
    });

    describe('Strategy Pagination', () => {
      let foundStrategies: Set<string>;

      beforeEach(async () => {
        // First disable the initial strategy that was added during Azorius setup
        await azorius
          .connect(owner)
          .disableStrategy(SENTINEL_STRATEGY, await mockStrategy.getAddress());

        // Deploy 6 mock strategies
        strategyList = [];
        for (let i = 0; i < 6; i++) {
          const strategy = await new MockVotingStrategy__factory(proxyDeployer).deploy(
            proposer.address,
          );
          strategyList.push(await strategy.getAddress());
          await azorius.connect(owner).enableStrategy(await strategy.getAddress());
        }
        foundStrategies = new Set<string>();
      });

      it('should paginate through strategies correctly with page size of 2', async () => {
        // Start from SENTINEL_STRATEGY
        let startAddress = SENTINEL_STRATEGY;
        let hasMore = true;

        while (hasMore) {
          const [pageStrategies, next] = await azorius.getStrategies(startAddress, 2);

          // Add found strategies to our set
          for (const strategy of pageStrategies) {
            foundStrategies.add(strategy.toLowerCase());
          }

          // If we got an empty page with next=SENTINEL_STRATEGY, it means startAddress is the last strategy
          if (pageStrategies.length === 0 && next === SENTINEL_STRATEGY) {
            // Add the last strategy to our set
            if (startAddress !== SENTINEL_STRATEGY) {
              foundStrategies.add(startAddress.toLowerCase());
            }
            hasMore = false;
          }
          // If we got an empty page with next=0x0, we've reached the end
          else if (
            pageStrategies.length === 0 &&
            next === '0x0000000000000000000000000000000000000000'
          ) {
            hasMore = false;
          }
          // If we got a non-empty page with next=SENTINEL_STRATEGY, we've reached the end
          else if (next === SENTINEL_STRATEGY) {
            hasMore = false;
          }
          // Otherwise, continue to the next page
          else {
            // Add the current strategy to our set before moving to the next page
            if (startAddress !== SENTINEL_STRATEGY) {
              foundStrategies.add(startAddress.toLowerCase());
            }
            startAddress = next;
          }
        }

        // Verify we found all strategies
        expect(foundStrategies.size).to.equal(strategyList.length);
        for (const strategy of strategyList) {
          void expect(foundStrategies.has(strategy.toLowerCase())).to.be.true;
        }

        // Verify the linked list order (strategies should be in reverse order since newest are added at the front)
        const [allStrategies] = await azorius.getStrategies(SENTINEL_STRATEGY, strategyList.length);
        for (let i = 0; i < strategyList.length; i++) {
          void expect(allStrategies[i].toLowerCase()).to.equal(
            strategyList[strategyList.length - 1 - i].toLowerCase(),
          );
        }
      });

      it('should return all strategies when page size is larger than total count', async () => {
        const [allStrategies, next] = await azorius.getStrategies(SENTINEL_STRATEGY, 100);

        // Should return all strategies in one page
        expect(allStrategies.length).to.equal(strategyList.length);
        expect(next).to.equal(SENTINEL_STRATEGY);

        // Verify the order (newest first)
        for (let i = 0; i < strategyList.length; i++) {
          void expect(allStrategies[i].toLowerCase()).to.equal(
            strategyList[strategyList.length - 1 - i].toLowerCase(),
          );
        }
      });

      it('should handle pagination from middle of the list', async () => {
        // Get the first page to find a middle strategy
        const [firstPage] = await azorius.getStrategies(SENTINEL_STRATEGY, 2);
        const middleStrategy = firstPage[1]; // Second strategy in the list

        // Start pagination from the middle strategy
        const [remainingStrategies, next] = await azorius.getStrategies(middleStrategy, 100);

        // Should return all strategies after the middle strategy
        expect(remainingStrategies.length).to.be.greaterThan(0);
        expect(remainingStrategies.length).to.be.lessThan(strategyList.length);

        // The next pointer should be SENTINEL_STRATEGY since we requested all remaining strategies
        expect(next).to.equal(SENTINEL_STRATEGY);

        // Verify that we don't find the middle strategy or any strategies before it
        for (const strategy of remainingStrategies) {
          void expect(strategy.toLowerCase()).to.not.equal(middleStrategy.toLowerCase());
          void expect(firstPage[0].toLowerCase()).to.not.equal(strategy.toLowerCase());
        }
      });

      it('should revert with InvalidStartAddress when using a non-existent strategy', async () => {
        const nonExistentStrategy = '0x0000000000000000000000000000000000000002';

        await expect(azorius.getStrategies(nonExistentStrategy, 10)).to.be.revertedWithCustomError(
          azorius,
          'InvalidStartAddress',
        );
      });

      it('should handle pagination with large numbers of strategies', async () => {
        // Deploy 50 more strategies (for a total of 56)
        const moreStrategies = [];
        for (let i = 6; i < 56; i++) {
          const strategy = await new MockVotingStrategy__factory(proxyDeployer).deploy(
            proposer.address,
          );
          moreStrategies.push(await strategy.getAddress());
          await azorius.connect(owner).enableStrategy(await strategy.getAddress());
        }

        // Combine all strategies
        const allStrategies = [...strategyList, ...moreStrategies];

        // Get all strategies in one go
        const [retrievedStrategies] = await azorius.getStrategies(SENTINEL_STRATEGY, 1000);

        // Verify we found all strategies
        expect(retrievedStrategies.length).to.equal(allStrategies.length);

        // Convert to sets for easier comparison
        const foundSet = new Set(retrievedStrategies.map((s: string) => s.toLowerCase()));
        const expectedSet = new Set(allStrategies.map((s: string) => s.toLowerCase()));

        // Verify each expected strategy is found
        for (const strategy of expectedSet) {
          void expect(foundSet.has(strategy)).to.be.true;
        }

        // Verify each found strategy was expected
        for (const strategy of foundSet) {
          void expect(expectedSet.has(strategy)).to.be.true;
        }
      });

      it('should maintain correct linked list structure when adding multiple strategies', async () => {
        // Add multiple strategies
        const newStrategies: string[] = [];
        for (let i = 10; i < 15; i++) {
          const strategy = await new MockVotingStrategy__factory(proxyDeployer).deploy(
            proposer.address,
          );
          newStrategies.push(await strategy.getAddress());
          await azorius.connect(owner).enableStrategy(await strategy.getAddress());
        }

        // Get all strategies in one go
        const [allStrategies] = await azorius.getStrategies(SENTINEL_STRATEGY, 1000);

        // Verify the order of our new strategies (they should be at the front, in reverse order)
        for (let i = 0; i < newStrategies.length; i++) {
          expect(allStrategies[i]).to.equal(newStrategies[newStrategies.length - 1 - i]);
        }
      });

      it('should maintain correct linked list structure when removing strategies', async () => {
        // First get all current strategies
        const [currentStrategies] = await azorius.getStrategies(SENTINEL_STRATEGY, 100);

        // Remove strategies from different positions and verify the list remains valid
        const positions = ['first', 'middle', 'last'];
        for (const position of positions) {
          let strategyToRemove: string;
          let prevStrategy: string;

          if (position === 'first') {
            strategyToRemove = currentStrategies[0];
            prevStrategy = SENTINEL_STRATEGY;
          } else if (position === 'middle') {
            const midIndex = Math.floor(currentStrategies.length / 2);
            strategyToRemove = currentStrategies[midIndex];
            prevStrategy = currentStrategies[midIndex - 1];
          } else {
            // last
            strategyToRemove = currentStrategies[currentStrategies.length - 1];
            prevStrategy = currentStrategies[currentStrategies.length - 2];
          }

          // Remove the strategy
          await azorius.connect(owner).disableStrategy(prevStrategy, strategyToRemove);

          // Verify the strategy is disabled
          void expect(await azorius.isStrategyEnabled(strategyToRemove)).to.be.false;

          // Get updated list
          const [updatedStrategies] = await azorius.getStrategies(SENTINEL_STRATEGY, 100);

          // Verify the removed strategy is not in the list
          expect(updatedStrategies).to.not.include(strategyToRemove);

          // Verify the list is still properly linked
          if (position === 'first') {
            const [firstPage] = await azorius.getStrategies(SENTINEL_STRATEGY, 1);
            if (firstPage.length > 0) {
              expect(firstPage[0]).to.not.equal(strategyToRemove);
            }
          } else if (position === 'last') {
            const lastStrategy = updatedStrategies[updatedStrategies.length - 1];
            const [, next] = await azorius.getStrategies(lastStrategy, 1);
            expect(next).to.equal(SENTINEL_STRATEGY);
          } else {
            // middle
            const [nextStrategies] = await azorius.getStrategies(prevStrategy, 1);
            if (nextStrategies.length > 0) {
              expect(nextStrategies[0]).to.not.equal(strategyToRemove);
            }
          }
        }
      });

      it('should revert with InvalidCount when count is zero', async () => {
        await expect(azorius.getStrategies(SENTINEL_STRATEGY, 0)).to.be.revertedWithCustomError(
          azorius,
          'InvalidCount',
        );
      });

      it('should return last strategy as _next when not all strategies fit in the array', async () => {
        // First, clear any existing strategies (from previous tests)
        // and create a fresh Azorius instance
        const mockAvatar = await new MockAvatar__factory(proxyDeployer).deploy();
        azorius = await deployAzoriusProxy(
          proxyDeployer,
          masterCopy,
          owner,
          await mockAvatar.getAddress(),
          await mockAvatar.getAddress(),
          [], // empty strategies array
          100,
          200,
        );

        // Enable three strategies
        const strategy1 = await new MockVotingStrategy__factory(proxyDeployer).deploy(
          proposer.address,
        );
        const strategy2 = await new MockVotingStrategy__factory(proxyDeployer).deploy(
          proposer.address,
        );
        const strategy3 = await new MockVotingStrategy__factory(proxyDeployer).deploy(
          proposer.address,
        );

        await azorius.enableStrategy(await strategy1.getAddress());
        await azorius.enableStrategy(await strategy2.getAddress());
        await azorius.enableStrategy(await strategy3.getAddress());

        // Request only 2 strategies when there are 3 total
        const [returnedStrategies, next] = await azorius.getStrategies(SENTINEL_STRATEGY, 2);

        // Verify the behavior
        expect(returnedStrategies.length).to.equal(2);

        // The _next pointer should equal the last returned strategy when there are more strategies
        // This matches the updated contract logic
        expect(next).to.equal(returnedStrategies[1]);
      });

      it('should handle the case where all strategies are returned correctly', async () => {
        // First, clear any existing strategies (from previous tests)
        // and create a fresh Azorius instance
        const mockAvatar = await new MockAvatar__factory(proxyDeployer).deploy();
        azorius = await deployAzoriusProxy(
          proxyDeployer,
          masterCopy,
          owner,
          await mockAvatar.getAddress(),
          await mockAvatar.getAddress(),
          [], // empty strategies array
          100,
          200,
        );

        // Enable just one strategy
        const strategy = await new MockVotingStrategy__factory(proxyDeployer).deploy(
          proposer.address,
        );
        await azorius.enableStrategy(await strategy.getAddress());

        // Request strategies with count>1 to ensure we get all strategies
        const [returnedStrategies, next] = await azorius.getStrategies(SENTINEL_STRATEGY, 2);

        // Verify returned data
        expect(returnedStrategies.length).to.equal(1);
        expect(returnedStrategies[0]).to.equal(await strategy.getAddress());

        // Since _next becomes SENTINEL_STRATEGY in the loop (we've reached the end of the list),
        // it should remain SENTINEL_STRATEGY as per the contract logic
        expect(next).to.equal(SENTINEL_STRATEGY);
      });
    });
  });

  describe('Proposal Tests', () => {
    let azorius: AzoriusV1;
    let avatar: MockAvatar;
    let mockToken: MockERC20Votes;
    let mockStrategy: MockVotingStrategy;

    const TIMELOCK_PERIOD = 100; // blocks
    const EXECUTION_PERIOD = 200; // blocks

    beforeEach(async () => {
      // Deploy mock contracts
      mockToken = await new MockERC20Votes__factory(proxyDeployer).deploy();

      // Deploy initial strategy
      mockStrategy = await new MockVotingStrategy__factory(proxyDeployer).deploy(proposer.address);

      // Deploy avatar
      avatar = await new MockAvatar__factory(proxyDeployer).deploy();

      // Deploy Azorius with initial strategy
      azorius = await deployAzoriusProxy(
        proxyDeployer,
        masterCopy,
        owner,
        await avatar.getAddress(),
        await avatar.getAddress(),
        [await mockStrategy.getAddress()],
        TIMELOCK_PERIOD,
        EXECUTION_PERIOD,
      );
    });

    describe('Proposal Management', () => {
      let proposalTx: {
        to: string;
        value: number;
        data: string;
        operation: number;
      };

      beforeEach(async () => {
        // Create a mock transaction for proposals
        proposalTx = {
          to: await mockToken.getAddress(),
          value: 0,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
          operation: 0, // Call
        };
      });

      it('should allow proposer to submit proposal', async () => {
        const proposalMetadata = 'Test proposal';

        const tx = await azorius
          .connect(proposer)
          .submitProposal(await mockStrategy.getAddress(), '0x', [proposalTx], proposalMetadata);

        const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
        if (!receipt) throw new Error('Transaction failed');

        const event = azorius.interface.decodeEventLog(
          'ProposalCreated',
          receipt.logs[0].data,
          receipt.logs[0].topics,
        );

        // Check that the event emits the correct values
        expect(event.proposalId).to.equal(0n);
        expect(event.strategy).to.equal(await mockStrategy.getAddress());
        expect(event.proposer).to.equal(proposer.address);
        expect(event.transactions[0].to).to.equal(proposalTx.to);
        expect(event.transactions[0].value).to.equal(proposalTx.value);
        expect(event.transactions[0].data).to.equal(proposalTx.data);
        expect(event.transactions[0].operation).to.equal(proposalTx.operation);
        expect(event.metadata).to.equal(proposalMetadata);
      });

      it('should not allow non-proposer to submit proposal', async () => {
        await expect(
          azorius
            .connect(user)
            .submitProposal(await mockStrategy.getAddress(), '0x', [proposalTx], 'Test proposal'),
        ).to.be.revertedWithCustomError(azorius, 'InvalidProposer');
      });

      it('should not allow proposal submission with disabled strategy', async () => {
        const newStrategy = await new MockVotingStrategy__factory(proxyDeployer).deploy(
          proposer.address,
        );

        await expect(
          azorius
            .connect(proposer)
            .submitProposal(await newStrategy.getAddress(), '0x', [proposalTx], 'Test proposal'),
        ).to.be.revertedWithCustomError(azorius, 'StrategyDisabled');
      });
    });

    describe('Proposal Transaction Management', () => {
      it('should revert when accessing invalid proposal tx hash', async () => {
        // First check if proposal exists
        await expect(azorius.proposalState(999)).to.be.revertedWithCustomError(
          azorius,
          'InvalidProposal',
        );
      });

      it('should revert when accessing invalid tx index', async () => {
        // Create a mock transaction for proposals
        const proposalTx = {
          to: await mockToken.getAddress(),
          value: 0,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
          operation: 0, // Call
        };

        // First create a valid proposal
        await azorius
          .connect(proposer)
          .submitProposal(await mockStrategy.getAddress(), '0x', [proposalTx], 'Test proposal');

        // Try to access an invalid tx index
        await expect(azorius.getProposalTxHash(0, 999)).to.be.reverted; // Will revert with array out of bounds
      });

      it('should return correct hashes for multiple transactions', async () => {
        // Create multiple transactions
        const tx1 = {
          to: await mockToken.getAddress(),
          value: 0,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
          operation: 0,
        };
        const tx2 = {
          to: await mockToken.getAddress(),
          value: 0,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 200]),
          operation: 0,
        };

        // Submit proposal with multiple transactions
        await azorius
          .connect(proposer)
          .submitProposal(await mockStrategy.getAddress(), '0x', [tx1, tx2], 'Test proposal');

        // Get hashes directly
        const hash1 = await azorius.getTxHash(tx1.to, tx1.value, tx1.data, tx1.operation);
        const hash2 = await azorius.getTxHash(tx2.to, tx2.value, tx2.data, tx2.operation);

        // Verify proposal tx hashes match
        expect(await azorius.getProposalTxHash(0, 0)).to.equal(hash1);
        expect(await azorius.getProposalTxHash(0, 1)).to.equal(hash2);

        // Also verify getProposalTxHashes returns all hashes
        const hashes = await azorius.getProposalTxHashes(0);
        expect(hashes.length).to.equal(2);
        expect(hashes[0]).to.equal(hash1);
        expect(hashes[1]).to.equal(hash2);
      });
    });

    describe('Proposal State and Execution', () => {
      let proposalId: number;
      let proposalTx: {
        to: string;
        value: number;
        data: string;
        operation: number;
      };

      beforeEach(async () => {
        // Create a mock transaction for proposals
        proposalTx = {
          to: await mockToken.getAddress(),
          value: 0,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
          operation: 0, // Call
        };

        // Submit a proposal
        await azorius
          .connect(proposer)
          .submitProposal(await mockStrategy.getAddress(), '0x', [proposalTx], 'Test proposal');

        proposalId = 0;

        // Set voting end block to future block and mark as passed by default
        const currentBlockTimestamp = await time.latest();

        await mockStrategy.setVotingTimestamps(
          proposalId,
          currentBlockTimestamp,
          currentBlockTimestamp + 10,
        );
        await mockStrategy.setIsPassed(proposalId, true);
      });

      it('should track proposal state correctly', async () => {
        // Initially active (voting not ended)
        expect(await azorius.proposalState(proposalId)).to.equal(0); // ACTIVE

        const currentBlockTimestamp = await time.latest();

        // End voting immediately
        await mockStrategy.setVotingTimestamps(proposalId, 0, currentBlockTimestamp);

        // Should be in timelock since we set isPassed to true in beforeEach
        expect(await azorius.proposalState(proposalId)).to.equal(1); // TIMELOCKED

        // Move past timelock
        await time.increase(TIMELOCK_PERIOD);

        // Should be executable
        expect(await azorius.proposalState(proposalId)).to.equal(2); // EXECUTABLE

        // Move past execution period
        await time.increase(EXECUTION_PERIOD);

        // Should be expired
        expect(await azorius.proposalState(proposalId)).to.equal(4); // EXPIRED
      });

      it('should execute proposal transactions when executable', async () => {
        // Mint tokens to the avatar (who will execute the transfer)
        await mockToken.mint(await avatar.getAddress(), 1000);

        // End voting immediately
        const currentBlockTimestamp = await time.latest();
        const votingEnd = currentBlockTimestamp + 10;
        await mockStrategy.setVotingTimestamps(proposalId, currentBlockTimestamp, votingEnd);

        // Move past timelock
        await time.increaseTo(votingEnd + TIMELOCK_PERIOD);

        // Enable the module on the avatar to be able to execute the proposal
        await avatar.enableModule(await azorius.getAddress());

        // Execute proposal
        await azorius.executeProposal(
          proposalId,
          [proposalTx.to],
          [proposalTx.value],
          [proposalTx.data],
          [proposalTx.operation],
        );

        // Verify token transfer
        expect(await mockToken.balanceOf(user.address)).to.equal(100);
      });

      it('should not execute proposal before timelock period', async () => {
        // Set voting to passed
        await mockStrategy.setVotingTimestamps(proposalId, 0, 0);
        await mockStrategy.setIsPassed(proposalId, true);

        await expect(
          azorius.executeProposal(
            proposalId,
            [proposalTx.to],
            [proposalTx.value],
            [proposalTx.data],
            [proposalTx.operation],
          ),
        ).to.be.revertedWithCustomError(azorius, 'ProposalNotExecutable');
      });

      it('should not execute proposal after execution period', async () => {
        // Set voting to passed
        await mockStrategy.setVotingTimestamps(proposalId, 0, 0);
        await mockStrategy.setIsPassed(proposalId, true);

        // Move past timelock and execution period
        await time.increase(TIMELOCK_PERIOD + EXECUTION_PERIOD + 1);

        await expect(
          azorius.executeProposal(
            proposalId,
            [proposalTx.to],
            [proposalTx.value],
            [proposalTx.data],
            [proposalTx.operation],
          ),
        ).to.be.revertedWithCustomError(azorius, 'ProposalNotExecutable');
      });

      describe('Timestamp-based proposal state transitions', () => {
        beforeEach(async () => {
          // Setup is already done in the parent beforeEach
          // Just need to reset the proposal state for our tests
          const currentTimestamp = await time.latest();

          // Set a future voting end timestamp
          await mockStrategy.setVotingTimestamps(
            proposalId,
            currentTimestamp,
            currentTimestamp + 100,
          );
          await mockStrategy.setIsPassed(proposalId, true);
        });

        it('should correctly transition between states based on timestamps', async () => {
          const currentTimestamp = await time.latest();

          // Initially active
          expect(await azorius.proposalState(proposalId)).to.equal(0); // ACTIVE

          // Advance time just past voting end
          await time.increaseTo(currentTimestamp + 101);

          // Verify state changes to TIMELOCKED
          expect(await azorius.proposalState(proposalId)).to.equal(1); // TIMELOCKED

          // Advance time past timelock period
          await time.increaseTo(currentTimestamp + 101 + TIMELOCK_PERIOD);

          // Verify state changes to EXECUTABLE
          expect(await azorius.proposalState(proposalId)).to.equal(2); // EXECUTABLE

          // Advance time past execution period
          await time.increaseTo(currentTimestamp + 101 + TIMELOCK_PERIOD + EXECUTION_PERIOD);

          // Verify state changes to EXPIRED
          expect(await azorius.proposalState(proposalId)).to.equal(4); // EXPIRED
        });

        it('should handle exact boundary conditions in timestamp transitions', async () => {
          const currentTimestamp = await time.latest();

          // Set exact timestamps for voting end
          await mockStrategy.setVotingTimestamps(
            proposalId,
            currentTimestamp,
            currentTimestamp + 100,
          );

          // At exactly the voting end time
          await time.increaseTo(currentTimestamp + 100);
          expect(await azorius.proposalState(proposalId)).to.equal(0); // Should still be ACTIVE at exactly the end timestamp

          // One second after voting end
          await time.increaseTo(currentTimestamp + 101);
          expect(await azorius.proposalState(proposalId)).to.equal(1); // Should be TIMELOCKED after end timestamp

          // At exactly the end of timelock period
          await time.increaseTo(currentTimestamp + 101 + TIMELOCK_PERIOD);
          expect(await azorius.proposalState(proposalId)).to.equal(2); // Should be EXECUTABLE

          // At exactly the end of execution period
          await time.increaseTo(currentTimestamp + 101 + TIMELOCK_PERIOD + EXECUTION_PERIOD);
          expect(await azorius.proposalState(proposalId)).to.equal(4); // Should be EXPIRED at exactly end of execution period
        });
      });
    });

    describe('Proposal Execution Edge Cases', () => {
      let tx1: {
        to: string;
        value: number;
        data: string;
        operation: number;
      };

      let tx2: {
        to: string;
        value: number;
        data: string;
        operation: number;
      };

      beforeEach(async () => {
        // Submit a proposal with multiple transactions
        tx1 = {
          to: await mockToken.getAddress(),
          value: 0,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
          operation: 0,
        };
        tx2 = {
          to: await mockToken.getAddress(),
          value: 0,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 200]),
          operation: 0,
        };

        await azorius
          .connect(proposer)
          .submitProposal(await mockStrategy.getAddress(), '0x', [tx1, tx2], 'Test proposal');

        // Set voting to passed and move past timelock
        await mockStrategy.setVotingTimestamps(0, 0, 0);
        await mockStrategy.setIsPassed(0, true);
        await time.increase(TIMELOCK_PERIOD);

        // Mint tokens to avatar for execution
        await mockToken.mint(await avatar.getAddress(), 1000);
        await avatar.enableModule(await azorius.getAddress());
      });

      describe('Partial execution', () => {
        beforeEach(async () => {
          // Get current block number
          const currentBlockTimestamp = await time.latest();
          await mockStrategy.setVotingTimestamps(
            0,
            currentBlockTimestamp,
            currentBlockTimestamp + 10,
          );

          // Move past voting and timelock period
          await time.increase(10 + TIMELOCK_PERIOD);
        });

        it('should allow partial execution of proposal transactions', async () => {
          // Execute only the first transaction
          await azorius.executeProposal(0, [tx1.to], [tx1.value], [tx1.data], [tx1.operation]);

          // Verify first transaction was executed
          expect(await mockToken.balanceOf(user.address)).to.equal(100);

          // Verify execution counter was incremented
          const [, , , , executionCounter] = await azorius.getProposal(0);
          expect(executionCounter).to.equal(1);
        });

        it('should allow execution of remaining transactions after partial execution', async () => {
          // Execute first transaction
          await azorius.executeProposal(0, [tx1.to], [tx1.value], [tx1.data], [tx1.operation]);

          // Execute the second transaction
          await azorius.executeProposal(0, [tx2.to], [tx2.value], [tx2.data], [tx2.operation]);

          // Verify second transaction was executed (balance should now be 300)
          expect(await mockToken.balanceOf(user.address)).to.equal(300);

          // Verify execution counter was incremented again
          const [, , , , finalExecutionCounter] = await azorius.getProposal(0);
          expect(finalExecutionCounter).to.equal(2);

          // Verify proposal state is now EXECUTED
          expect(await azorius.proposalState(0)).to.equal(3); // EXECUTED
        });
      });

      it('should revert on invalid array lengths', async () => {
        // Try to execute with mismatched array lengths
        await expect(
          azorius.executeProposal(
            0,
            [tx1.to],
            [], // Empty value array
            [tx1.data],
            [tx1.operation],
          ),
        ).to.be.revertedWithCustomError(azorius, 'InvalidArrayLengths');
      });

      it('should revert on execution counter overflow', async () => {
        // Submit proposal with both transactions
        await azorius
          .connect(proposer)
          .submitProposal(await mockStrategy.getAddress(), '0x', [tx1, tx2], 'Test proposal');

        // Get current block number and set up proposal state
        const currentBlockTimestamp = await time.latest();
        await mockStrategy.setVotingTimestamps(
          1,
          currentBlockTimestamp,
          currentBlockTimestamp + 10,
        );
        await mockStrategy.setIsPassed(1, true);

        // Move past voting and timelock period
        await time.increase(10 + TIMELOCK_PERIOD);

        // Verify proposal is executable
        expect(await azorius.proposalState(1)).to.equal(2); // EXECUTABLE

        // First execute all transactions
        await azorius.executeProposal(
          1,
          [tx1.to, tx2.to],
          [tx1.value, tx2.value],
          [tx1.data, tx2.data],
          [tx1.operation, tx2.operation],
        );

        // Try to execute more transactions than exist
        await expect(
          azorius.executeProposal(1, [tx1.to], [tx1.value], [tx1.data], [tx1.operation]),
        ).to.be.revertedWithCustomError(azorius, 'InvalidTxs');
      });
    });

    describe('Transaction Hash Generation', () => {
      it('should generate correct transaction hash', async () => {
        const tx = {
          to: await mockToken.getAddress(),
          value: 0,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
          operation: 0,
        };

        const txHash = await azorius.getTxHash(tx.to, tx.value, tx.data, tx.operation);

        expect(txHash).to.be.properHex(64); // 32 bytes (64 chars) + 0x prefix
      });

      it('should generate different hashes for different transactions', async () => {
        const tx1 = {
          to: await mockToken.getAddress(),
          value: 0,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
          operation: 0,
        };

        const tx2 = {
          to: await mockToken.getAddress(),
          value: 0,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 200]),
          operation: 0,
        };

        const txHash1 = await azorius.getTxHash(tx1.to, tx1.value, tx1.data, tx1.operation);
        const txHash2 = await azorius.getTxHash(tx2.to, tx2.value, tx2.data, tx2.operation);

        expect(txHash1).to.not.equal(txHash2);
      });
    });
  });

  describe('Version', () => {
    let azorius: AzoriusV1;

    beforeEach(async () => {
      azorius = await deployAzoriusProxy(
        proxyDeployer,
        masterCopy,
        proxyDeployer,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        [],
        0,
        0,
      );
    });

    // Use the shared version test utility
    it('should return the correct version number', async () => {
      expect(await azorius.getVersion()).to.equal(1);
    });
  });

  describe('ERC165', function () {
    let azoriusInstance: AzoriusV1;
    let iAzoriusV1InterfaceId: string;
    let iVersionInterfaceId: string;
    let iERC165InterfaceId: string;

    beforeEach(async function () {
      // Deploy a new instance for testing
      azoriusInstance = await deployAzoriusProxy(
        proxyDeployer,
        masterCopy,
        proxyDeployer,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        [],
        0,
        0,
      );

      // Dynamically calculate interface IDs
      const IAzoriusV1Interface = IAzoriusV1__factory.createInterface();
      iAzoriusV1InterfaceId = calculateInterfaceId(IAzoriusV1Interface);

      const IVersionInterface = IVersion__factory.createInterface();
      iVersionInterfaceId = calculateInterfaceId(IVersionInterface);

      const IERC165Interface = IERC165__factory.createInterface();
      iERC165InterfaceId = calculateInterfaceId(IERC165Interface);
    });

    it('Should support IERC165 interface', async function () {
      const supported = await azoriusInstance.supportsInterface(iERC165InterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IAzoriusV1 interface', async function () {
      const supported = await azoriusInstance.supportsInterface(iAzoriusV1InterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IVersion interface', async function () {
      const supported = await azoriusInstance.supportsInterface(iVersionInterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should not support random interface', async function () {
      const randomInterfaceId = '0x12345678';
      const supported = await azoriusInstance.supportsInterface(randomInterfaceId);
      void expect(supported).to.be.false;
    });
  });

  describe('UUPS Upgradeability', function () {
    let azorius: AzoriusV1;

    beforeEach(async function () {
      // Deploy azorius proxy
      azorius = await deployAzoriusProxy(
        proxyDeployer,
        masterCopy,
        owner,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        [],
        0,
        0,
      );
    });

    // Run UUPS upgradeability tests
    runUUPSUpgradeabilityTests({
      getContract: () => azorius as unknown as UUPSUpgradeable,
      createNewImplementation: async () => {
        const newImplementation = await new AzoriusV1__factory(owner).deploy();
        return newImplementation as unknown as UUPSUpgradeable;
      },
      owner: () => owner,
      nonOwner: () => nonOwner,
    });
  });
});
