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
  strategyAddress: string,
  timelockPeriod: number,
  executionPeriod: number,
): Promise<AzoriusV1> {
  // Combine selector and encoded params
  const fullInitData =
    AzoriusV1__factory.createInterface().getFunction('initialize').selector +
    ethers.AbiCoder.defaultAbiCoder()
      .encode(
        ['address', 'address', 'address', 'address', 'uint32', 'uint32'],
        [owner.address, avatar, target, strategyAddress, timelockPeriod, executionPeriod],
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
  strategyAddress: string,
  timelockPeriod: number,
  executionPeriod: number,
): Promise<AzoriusV1> {
  // Create the call to setUp with the encoded parameters
  const fullInitData = AzoriusV1__factory.createInterface().encodeFunctionData('setUp', [
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'address', 'address', 'uint32', 'uint32'],
      [owner.address, avatar, target, strategyAddress, timelockPeriod, executionPeriod],
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
  let mockStrategy: MockVotingStrategy;
  let mockStrategyAddress: string;

  beforeEach(async () => {
    // Get signers
    [proxyDeployer, owner, proposer, user, nonOwner] = await ethers.getSigners();

    // Deploy implementation contract
    implementation = await new AzoriusV1__factory(proxyDeployer).deploy();
    masterCopy = await implementation.getAddress();

    // Deploy a default mock strategy for use in many tests
    mockStrategy = await new MockVotingStrategy__factory(proxyDeployer).deploy(proposer.address);
    mockStrategyAddress = await mockStrategy.getAddress();
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
          mockStrategyAddress,
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
          await avatar.getAddress(),
          mockStrategyAddress,
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
          mockStrategyAddress,
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
          mockStrategyAddress,
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
          mockStrategyAddress,
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
          mockStrategyAddress,
          100,
          200,
        );

        expect(await azorius.avatar()).to.equal(ethers.ZeroAddress);
        expect(await azorius.getFunction('target')()).to.equal(ethers.ZeroAddress);
      });
    });

    describe('Strategy parameter', () => {
      it('should initialize with a valid strategy', async () => {
        const localMockStrategy = await new MockVotingStrategy__factory(proxyDeployer).deploy(
          proposer.address,
        );
        const localMockStrategyAddress = await localMockStrategy.getAddress();

        azorius = await deployAzoriusProxy(
          proxyDeployer,
          masterCopy,
          owner,
          await avatar.getAddress(),
          await avatar.getAddress(),
          localMockStrategyAddress,
          100,
          200,
        );
        expect(await azorius.strategy()).to.equal(localMockStrategyAddress);
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
          mockStrategyAddress,
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
          mockStrategyAddress,
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
          mockStrategyAddress,
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
          mockStrategyAddress,
          100,
          200,
        );

        await expect(
          azorius.initialize(
            owner.address,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            mockStrategyAddress,
            0,
            0,
          ),
        ).to.be.revertedWithCustomError(azorius, 'InvalidInitialization');
      });

      it('Should have initialization disabled in the implementation', async function () {
        const implementationContract = AzoriusV1__factory.connect(masterCopy, proxyDeployer);

        await expect(
          implementationContract.initialize(
            owner.address,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            mockStrategyAddress,
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
          mockStrategyAddress,
          100,
          200,
        );

        // Verify initialization was successful
        expect(await azorius.owner()).to.equal(owner.address);
        expect(await azorius.avatar()).to.equal(await avatar.getAddress());
        expect(await azorius.getFunction('target')()).to.equal(await avatar.getAddress());
        expect(await azorius.strategy()).to.equal(mockStrategyAddress);
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
          mockStrategyAddress,
          100,
          200,
        );

        // Encode parameters correctly for setUp
        const innerParams = ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'address', 'address', 'address', 'uint32', 'uint32'],
          [
            owner.address,
            await avatar.getAddress(),
            await avatar.getAddress(),
            mockStrategyAddress,
            100,
            200,
          ],
        );

        // Attempt to call setUp again - should revert
        await expect(azorius.setUp(innerParams)).to.be.revertedWithCustomError(
          azorius,
          'InvalidInitialization',
        );
      });
    });
  });

  describe('Proposal Tests', () => {
    let azorius: AzoriusV1;
    let avatar: MockAvatar;
    let mockToken: MockERC20Votes;

    const TIMELOCK_PERIOD = 100; // blocks
    const EXECUTION_PERIOD = 200; // blocks

    beforeEach(async () => {
      // Deploy mock contracts
      mockToken = await new MockERC20Votes__factory(proxyDeployer).deploy();

      // Deploy avatar
      avatar = await new MockAvatar__factory(proxyDeployer).deploy();

      // Deploy Azorius with initial strategy
      azorius = await deployAzoriusProxy(
        proxyDeployer,
        masterCopy,
        owner,
        await avatar.getAddress(),
        await avatar.getAddress(),
        mockStrategyAddress,
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
          .submitProposal('0x', [proposalTx], proposalMetadata);

        const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
        if (!receipt) throw new Error('Transaction failed');

        const event = azorius.interface.decodeEventLog(
          'ProposalCreated',
          receipt.logs[0].data,
          receipt.logs[0].topics,
        );

        // Check that the event emits the correct values
        expect(event.proposalId).to.equal(0n);
        expect(event.proposer).to.equal(proposer.address);
        expect(event.transactions[0].to).to.equal(proposalTx.to);
        expect(event.transactions[0].value).to.equal(proposalTx.value);
        expect(event.transactions[0].data).to.equal(proposalTx.data);
        expect(event.transactions[0].operation).to.equal(proposalTx.operation);
        expect(event.metadata).to.equal(proposalMetadata);
      });

      it('should not allow non-proposer to submit proposal', async () => {
        await expect(
          azorius.connect(user).submitProposal('0x', [proposalTx], 'Test proposal'),
        ).to.be.revertedWithCustomError(azorius, 'InvalidProposer');
      });
    });

    describe('Proposal Transaction Management', () => {
      it('should revert when accessing proposalState for an uninitialized proposal', async () => {
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
        await azorius.connect(proposer).submitProposal('0x', [proposalTx], 'Test proposal');

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
        await azorius.connect(proposer).submitProposal('0x', [tx1, tx2], 'Test proposal');

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
        await azorius.connect(proposer).submitProposal('0x', [proposalTx], 'Test proposal');

        proposalId = 0;

        // Set voting end block to future block and mark as passed by default on the mockStrategy
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

        // End voting immediately on the mock strategy
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

        // End voting immediately on the mock strategy
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
        // Set voting to passed on the mock strategy
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
        // Set voting to passed on the mock strategy
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

          // Set a future voting end timestamp on mock strategy
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

          // Set exact timestamps for voting end on mock strategy
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

        await azorius.connect(proposer).submitProposal('0x', [tx1, tx2], 'Test proposal');

        // Set voting to passed and move past timelock on mock strategy
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
          const [, , , executionCounter] = await azorius.getProposal(0);
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
          const [, , , finalExecutionCounter] = await azorius.getProposal(0);
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
        // Submit proposal with both transactions (proposalId will be 1 for this new proposal)
        await azorius.connect(proposer).submitProposal('0x', [tx1, tx2], 'Test proposal');

        // Get current block number and set up proposal state for the new proposal (ID 1)
        const currentBlockTimestamp = await time.latest();
        await mockStrategy.setVotingTimestamps(
          1, // new proposalId
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
        mockStrategyAddress,
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
        mockStrategyAddress,
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
        mockStrategyAddress,
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
