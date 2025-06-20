import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  IDeploymentBlockV1,
  IDeploymentBlockV1__factory,
  IERC165__factory,
  IModuleAzoriusV1__factory,
  IVersion__factory,
  MockAvatar,
  MockAvatar__factory,
  MockERC20Votes,
  MockERC20Votes__factory,
  MockVotingStrategy,
  MockVotingStrategy__factory,
  ModuleAzoriusV1,
  ModuleAzoriusV1__factory,
  UUPSUpgradeable,
} from '../../../typechain-types';
import { runDeploymentBlockTests } from '../../shared/deploymentBlockTests';
import { runSupportsInterfaceTests } from '../../shared/supportsInterfaceTests';
import { runUUPSUpgradeabilityTests } from '../../shared/uupsUpgradeabilityTests';

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
): Promise<ModuleAzoriusV1> {
  // Combine selector and encoded params
  const fullInitData = ModuleAzoriusV1__factory.createInterface().encodeFunctionData('initialize', [
    owner.address,
    avatar,
    target,
    strategyAddress,
    timelockPeriod,
    executionPeriod,
  ]);

  // Deploy the proxy with the implementation
  const proxy = await new ERC1967Proxy__factory(proxyDeployer).deploy(implementation, fullInitData);

  // Return a contract instance connected to the proxy
  return ModuleAzoriusV1__factory.connect(await proxy.getAddress(), owner);
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
): Promise<ModuleAzoriusV1> {
  // Create the call to setUp with the encoded parameters
  const fullInitData = ModuleAzoriusV1__factory.createInterface().encodeFunctionData('setUp', [
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'address', 'address', 'uint32', 'uint32'],
      [owner.address, avatar, target, strategyAddress, timelockPeriod, executionPeriod],
    ),
  ]);

  // Deploy the proxy with the implementation
  const proxy = await new ERC1967Proxy__factory(proxyDeployer).deploy(implementation, fullInitData);

  // Return a contract instance connected to the proxy
  return ModuleAzoriusV1__factory.connect(await proxy.getAddress(), owner);
}

describe('ModuleAzoriusV1', () => {
  // eoas
  let proxyDeployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let proposer: SignerWithAddress;
  let user: SignerWithAddress;
  let nonOwner: SignerWithAddress;

  // mocks and mastercopies
  let implementation: ModuleAzoriusV1;
  let masterCopy: string;
  let mockStrategy: MockVotingStrategy;
  let mockStrategyAddress: string;

  beforeEach(async () => {
    // Get signers
    [proxyDeployer, owner, proposer, user, nonOwner] = await ethers.getSigners();

    // Deploy implementation contract
    implementation = await new ModuleAzoriusV1__factory(proxyDeployer).deploy();
    masterCopy = await implementation.getAddress();

    // Deploy a default mock strategy for use in many tests
    mockStrategy = await new MockVotingStrategy__factory(proxyDeployer).deploy(proposer.address);
    mockStrategyAddress = await mockStrategy.getAddress();
  });

  describe('Initialization', () => {
    let azorius: ModuleAzoriusV1;
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
        const implementationContract = ModuleAzoriusV1__factory.connect(masterCopy, proxyDeployer);

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
    let azorius: ModuleAzoriusV1;
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
          .submitProposal([proposalTx], proposalMetadata, ethers.ZeroAddress, ethers.ZeroHash);

        const receipt = await tx.wait();
        if (!receipt) throw new Error('Transaction failed to be mined');

        const eventFragment = azorius.interface.getEvent('ProposalCreated');
        const eventLog = receipt.logs?.find(log => log.topics[0] === eventFragment.topicHash);
        if (!eventLog) throw new Error('ProposalCreated event not found in logs');

        const event = azorius.interface.decodeEventLog(
          eventFragment, // Use the fragment directly for more robustness
          eventLog.data,
          eventLog.topics as string[],
        );

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
          azorius
            .connect(user)
            .submitProposal([proposalTx], 'Test proposal', ethers.ZeroAddress, ethers.ZeroHash),
        ).to.be.revertedWithCustomError(azorius, 'InvalidProposer');
      });

      it('should allow submitting a proposal with zero transactions and verify its state progression', async () => {
        const proposalMetadata = 'Zero transaction proposal';
        const proposalId = await azorius.totalProposalCount();

        // Submit with empty transactions array
        await expect(
          azorius
            .connect(proposer)
            .submitProposal([], proposalMetadata, ethers.ZeroAddress, ethers.ZeroHash),
        )
          .to.emit(azorius, 'ProposalCreated')
          .withArgs(mockStrategyAddress, proposalId, proposer.address, [], proposalMetadata);

        expect(await azorius.totalProposalCount()).to.equal(proposalId + 1n);
        const [, txHashes, , ,] = await azorius.getProposal(Number(proposalId));
        expect(txHashes.length).to.equal(0);

        // Simulate voting ended and passed
        const currentTimestamp = await time.latest();
        await mockStrategy.setVotingTimestamps(
          Number(proposalId),
          currentTimestamp,
          currentTimestamp + 10,
        );
        await mockStrategy.setIsPassed(Number(proposalId), true);

        // Advance time past voting
        const timeToAdvanceTo = currentTimestamp + 11;
        await time.increaseTo(timeToAdvanceTo);

        const currentState = await azorius.proposalState(Number(proposalId));

        // For a zero-transaction proposal that has passed, the state should directly be EXECUTED
        // regardless of the timelock period, because the condition
        // `_proposal.executionCounter == _proposal.txHashes.length` (0 == 0) is met first.
        expect(currentState).to.equal(3); // EXECUTED
      });
    });

    describe('Proposal Transaction Management', () => {
      it('should revert when accessing proposalState for an uninitialized proposal', async () => {
        await expect(azorius.proposalState(999)).to.be.revertedWithCustomError(
          azorius,
          'InvalidProposal',
        );
      });

      it('should revert when accessing proposalState with proposalId equal to totalProposalCount', async () => {
        // No proposals submitted yet, so totalProposalCount is 0.
        // Accessing proposalState(0) should revert.
        await expect(azorius.proposalState(0)).to.be.revertedWithCustomError(
          azorius,
          'InvalidProposal',
        );

        // Submit one proposal
        const proposalTx = {
          to: await mockToken.getAddress(),
          value: 0,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
          operation: 0, // Call
        };
        await azorius
          .connect(proposer)
          .submitProposal([proposalTx], 'Test proposal', ethers.ZeroAddress, ethers.ZeroHash);
        // Now totalProposalCount is 1. Accessing proposalState(1) should revert.
        await expect(azorius.proposalState(1)).to.be.revertedWithCustomError(
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
          .submitProposal([proposalTx], 'Test proposal', ethers.ZeroAddress, ethers.ZeroHash);

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
          .submitProposal([tx1, tx2], 'Test proposal', ethers.ZeroAddress, ethers.ZeroHash);

        // Get hashes directly
        const hash1 = await azorius.getTxHash(tx1);
        const hash2 = await azorius.getTxHash(tx2);

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

    describe('getProposal', () => {
      it('should return correct details for an existing proposal', async () => {
        const proposalTx = {
          to: await mockToken.getAddress(),
          value: 0,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
          operation: 0, // Call
        };
        const metadata = 'Test GetProposal';

        // Submit the proposal
        await azorius
          .connect(proposer)
          .submitProposal([proposalTx], metadata, ethers.ZeroAddress, ethers.ZeroHash);
        const proposalId = 0;

        const expectedTxHash = await azorius.getTxHash(proposalTx);

        const [strategy, txHashes, timelock, execution, counter] =
          await azorius.getProposal(proposalId);

        expect(strategy).to.equal(mockStrategyAddress);
        expect(txHashes.length).to.equal(1);
        expect(txHashes[0]).to.equal(expectedTxHash);
        expect(timelock).to.equal(TIMELOCK_PERIOD); // Assuming TIMELOCK_PERIOD is available from outer scope
        expect(execution).to.equal(EXECUTION_PERIOD); // Assuming EXECUTION_PERIOD is available from outer scope
        expect(counter).to.equal(0); // Execution counter should be 0 initially
      });

      it('should return default/zero values for a non-existent proposalId (higher than totalProposalCount)', async () => {
        const nonExistentProposalId = (await azorius.totalProposalCount()) + 1n; // Get current count and add 1
        // Solidity will return default values for a mapping if the key doesn't exist
        // or if the proposal struct was never initialized for that ID.

        const [strategy, txHashes, timelock, execution, counter] = await azorius.getProposal(
          Number(nonExistentProposalId), // Convert BigInt to number if necessary for your ethers version
        );

        expect(strategy).to.equal(ethers.ZeroAddress);
        expect(txHashes.length).to.equal(0);
        expect(timelock).to.equal(0);
        expect(execution).to.equal(0);
        expect(counter).to.equal(0);
      });

      it('should return details correctly after partial execution', async () => {
        const tx1 = {
          to: await mockToken.getAddress(),
          value: 0,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 50]),
          operation: 0,
        };
        const tx2 = {
          to: await mockToken.getAddress(),
          value: 0,
          data: mockToken.interface.encodeFunctionData('transfer', [owner.address, 50]),
          operation: 0,
        };
        await azorius
          .connect(proposer)
          .submitProposal([tx1, tx2], 'Partial Exec Test', ethers.ZeroAddress, ethers.ZeroHash);
        const proposalId = 0;

        // --- Setup for execution ---
        await mockStrategy.setIsPassed(proposalId, true); // Mark as passed
        await avatar.enableModule(await azorius.getAddress());
        await mockToken.mint(await avatar.getAddress(), 100);

        // 1. Get current chain time
        const chainTimeBeforeStrategyUpdate = await time.latest();

        // 2. Set strategy's voting timestamps relative to current chain time
        const strategyVotingStart = chainTimeBeforeStrategyUpdate;
        const strategyVotingEnd = chainTimeBeforeStrategyUpdate + 10; // Voting ends 10s from this point
        await mockStrategy.setVotingTimestamps(proposalId, strategyVotingStart, strategyVotingEnd);

        // 3. Proposal's timelock period is fixed when it's created (TIMELOCK_PERIOD = 100)
        const proposalStoredTimelock = TIMELOCK_PERIOD;

        // 4. Calculate target execution timestamp to be just after timelock expires
        const targetExecutionTimestamp = strategyVotingEnd + proposalStoredTimelock + 1;

        // 5. Set the next block's timestamp.
        await time.increaseTo(targetExecutionTimestamp);

        // Execute only the first transaction
        await azorius.executeProposal(proposalId, [tx1]);

        const [, , , , counter] = await azorius.getProposal(proposalId);
        expect(counter).to.equal(1); // Execution counter should be 1
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
          .submitProposal([proposalTx], 'Test proposal', ethers.ZeroAddress, ethers.ZeroHash);

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
        await azorius.executeProposal(proposalId, [proposalTx]);

        // Verify token transfer
        expect(await mockToken.balanceOf(user.address)).to.equal(100);
      });

      it('should not execute proposal before timelock period', async () => {
        // Set voting to passed on the mock strategy
        await mockStrategy.setVotingTimestamps(proposalId, 0, 0);
        await mockStrategy.setIsPassed(proposalId, true);

        await expect(
          azorius.executeProposal(proposalId, [proposalTx]),
        ).to.be.revertedWithCustomError(azorius, 'ProposalNotExecutable');
      });

      it('should not execute proposal after execution period', async () => {
        // Set voting to passed on the mock strategy
        await mockStrategy.setVotingTimestamps(proposalId, 0, 0);
        await mockStrategy.setIsPassed(proposalId, true);

        // Move past timelock and execution period
        await time.increase(TIMELOCK_PERIOD + EXECUTION_PERIOD + 1);

        await expect(
          azorius.executeProposal(proposalId, [proposalTx]),
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

      it('should correctly transition to FAILED state if strategy returns isPassed as false', async () => {
        const proposalIdToFail = 0; // Assuming proposal 0 is already submitted from beforeEach

        // Ensure voting ends and proposal is marked as NOT passed by the strategy
        const currentTimestamp = await time.latest();
        await mockStrategy.setVotingTimestamps(
          proposalIdToFail,
          currentTimestamp,
          currentTimestamp + 10,
        );
        await mockStrategy.setIsPassed(proposalIdToFail, false); // Key change: proposal does not pass

        // Advance time past voting period
        await time.increaseTo(currentTimestamp + 11);

        // Verify state is FAILED
        expect(await azorius.proposalState(proposalIdToFail)).to.equal(5); // FAILED (Enum.ProposalState.FAILED)
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
          .submitProposal([tx1, tx2], 'Test proposal', ethers.ZeroAddress, ethers.ZeroHash);

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
          await azorius.executeProposal(0, [tx1]);

          // Verify first transaction was executed
          expect(await mockToken.balanceOf(user.address)).to.equal(100);

          // Verify execution counter was incremented
          const [, , , , executionCounter] = await azorius.getProposal(0);
          expect(executionCounter).to.equal(1);
        });

        it('should allow execution of remaining transactions after partial execution', async () => {
          // Execute first transaction
          await azorius.executeProposal(0, [tx1]);

          // Execute the second transaction
          await azorius.executeProposal(0, [tx2]);

          // Verify second transaction was executed (balance should now be 300)
          expect(await mockToken.balanceOf(user.address)).to.equal(300);

          // Verify execution counter was incremented again
          const [, , , , finalExecutionCounter] = await azorius.getProposal(0);
          expect(finalExecutionCounter).to.equal(2);

          // Verify proposal state is now EXECUTED
          expect(await azorius.proposalState(0)).to.equal(3); // EXECUTED
        });
      });

      it('should revert on execution counter overflow', async () => {
        // Submit proposal with both transactions (proposalId will be 1 for this new proposal)
        await azorius
          .connect(proposer)
          .submitProposal([tx1, tx2], 'Test proposal', ethers.ZeroAddress, ethers.ZeroHash);

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
        await azorius.executeProposal(1, [tx1, tx2]);

        // Try to execute more transactions than exist
        await expect(azorius.executeProposal(1, [tx1])).to.be.revertedWithCustomError(
          azorius,
          'InvalidTxs',
        );
      });

      describe('executeProposal Specific Reverts', () => {
        let proposalId: number;
        let validTx: {
          to: string;
          value: number;
          data: string;
          operation: number;
        };

        beforeEach(async () => {
          // Submit a standard proposal to be used for these revert tests
          validTx = {
            to: await mockToken.getAddress(),
            value: 0,
            data: mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
            operation: 0, // Call
          };
          // Get the next proposalId before submitting
          proposalId = Number(await azorius.totalProposalCount());
          await azorius
            .connect(proposer)
            .submitProposal([validTx], 'Test for Reverts', ethers.ZeroAddress, ethers.ZeroHash);

          // Setup proposal to be EXECUTABLE for most tests here
          const chainTimeBeforeStrategyUpdate = await time.latest();
          const strategyVotingStart = chainTimeBeforeStrategyUpdate;
          const strategyVotingEnd = chainTimeBeforeStrategyUpdate + 10;
          await mockStrategy.setVotingTimestamps(
            proposalId,
            strategyVotingStart,
            strategyVotingEnd,
          );
          await mockStrategy.setIsPassed(proposalId, true);

          const targetExecutionTimestamp = strategyVotingEnd + TIMELOCK_PERIOD + 1;
          if (targetExecutionTimestamp <= (await time.latest())) {
            await time.increaseTo(targetExecutionTimestamp);
          } else {
            await time.setNextBlockTimestamp(targetExecutionTimestamp);
          }
        });

        it('should revert with InvalidTxs if targets array is empty', async () => {
          await expect(azorius.executeProposal(proposalId, [])).to.be.revertedWithCustomError(
            azorius,
            'InvalidTxs',
          );
        });

        it('should revert with InvalidTxHash if provided tx details do not match stored hash', async () => {
          const invalidTxData = mockToken.interface.encodeFunctionData('transfer', [
            user.address,
            999, // Different amount means different data, thus different hash
          ]);
          const invalidTx = {
            to: validTx.to,
            value: validTx.value,
            data: invalidTxData,
            operation: validTx.operation,
          };
          await expect(
            azorius.executeProposal(proposalId, [invalidTx]),
          ).to.be.revertedWithCustomError(azorius, 'InvalidTxHash');
        });
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

        const txHash = await azorius.getTxHash(tx);

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

        const txHash1 = await azorius.getTxHash(tx1);
        const txHash2 = await azorius.getTxHash(tx2);

        expect(txHash1).to.not.equal(txHash2);
      });
    });

    describe('generateTxHashData', () => {
      let txParams: {
        to: string;
        value: bigint;
        data: string;
        operation: number;
      };
      let nonce: bigint;

      beforeEach(async () => {
        // Re-deploy Azorius and mocks if they are not available in this scope
        // For this specific case, Azorius is deployed in the parent 'Proposal Tests' scope
        // and mockToken is also available.
        txParams = {
          to: await mockToken.getAddress(),
          value: 0n,
          data: mockToken.interface.encodeFunctionData('transfer', [user.address, 100]),
          operation: 0, // Call
        };
        nonce = 0n;
      });

      it('should generate a non-empty bytes string', async () => {
        const hashData = await azorius.generateTxHashData(txParams, nonce);
        expect(hashData).to.be.a('string');
        expect(hashData).to.not.equal('0x');
        expect(ethers.isHexString(hashData)).to.be.true;
      });

      it('should produce different hash data for different nonces', async () => {
        const hashData1 = await azorius.generateTxHashData(
          txParams,
          0n, // Nonce 0
        );
        const hashData2 = await azorius.generateTxHashData(
          txParams,
          1n, // Nonce 1
        );
        expect(hashData1).to.not.equal(hashData2);
      });

      it('should produce different hash data for different to addresses', async () => {
        const hashData1 = await azorius.generateTxHashData(txParams, nonce);

        txParams.to = owner.address; // Different 'to'
        const hashData2 = await azorius.generateTxHashData(txParams, nonce);
        expect(hashData1).to.not.equal(hashData2);
      });

      it('should produce different hash data for different values', async () => {
        const hashData1 = await azorius.generateTxHashData(txParams, nonce);
        txParams.value = 1n; // Different value
        const hashData2 = await azorius.generateTxHashData(txParams, nonce);
        expect(hashData1).to.not.equal(hashData2);
      });

      it('should produce different hash data for different data', async () => {
        const hashData1 = await azorius.generateTxHashData(txParams, nonce);
        txParams.data = mockToken.interface.encodeFunctionData('transfer', [user.address, 200]); // Different data
        const differentData = mockToken.interface.encodeFunctionData('transfer', [
          user.address,
          200,
        ]);
        txParams.data = differentData;
        const hashData2 = await azorius.generateTxHashData(txParams, nonce);
        expect(hashData1).to.not.equal(hashData2);
      });

      it('should produce different hash data for different operations', async () => {
        const hashData1 = await azorius.generateTxHashData(txParams, nonce);
        txParams.operation = 1; // Different operation
        const hashData2 = await azorius.generateTxHashData(txParams, nonce);
        expect(hashData1).to.not.equal(hashData2);
      });
    });
  });

  describe('Owner Functions', () => {
    let azorius: ModuleAzoriusV1;
    let avatar: MockAvatar;

    const INITIAL_TIMELOCK_PERIOD = 100;
    const INITIAL_EXECUTION_PERIOD = 200;

    beforeEach(async () => {
      // Deploy avatar
      avatar = await new MockAvatar__factory(proxyDeployer).deploy();

      // Deploy Azorius
      azorius = await deployAzoriusProxy(
        proxyDeployer,
        masterCopy,
        owner,
        await avatar.getAddress(),
        await avatar.getAddress(),
        mockStrategyAddress,
        INITIAL_TIMELOCK_PERIOD,
        INITIAL_EXECUTION_PERIOD,
      );
    });

    describe('updateTimelockPeriod', () => {
      const NEW_TIMELOCK_PERIOD = 300;

      it('should allow owner to update timelock period', async () => {
        await expect(azorius.connect(owner).updateTimelockPeriod(NEW_TIMELOCK_PERIOD))
          .to.emit(azorius, 'TimelockPeriodUpdated')
          .withArgs(NEW_TIMELOCK_PERIOD);
        expect(await azorius.timelockPeriod()).to.equal(NEW_TIMELOCK_PERIOD);
      });

      it('should not allow non-owner to update timelock period', async () => {
        await expect(azorius.connect(nonOwner).updateTimelockPeriod(NEW_TIMELOCK_PERIOD))
          .to.be.revertedWithCustomError(azorius, 'OwnableUnauthorizedAccount')
          .withArgs(nonOwner.address);
      });

      it('should apply updated timelock period to new proposals', async () => {
        // Update the timelock period
        await azorius.connect(owner).updateTimelockPeriod(NEW_TIMELOCK_PERIOD);

        // Submit a new proposal
        const proposalTx = {
          to: owner.address, // Simple target for testing
          value: 0,
          data: '0x',
          operation: 0,
        };
        await azorius
          .connect(proposer)
          .submitProposal([proposalTx], 'New proposal', ethers.ZeroAddress, ethers.ZeroHash);
        const proposalId = 0; // First proposal

        const [, , timelock, ,] = await azorius.getProposal(proposalId);
        expect(timelock).to.equal(NEW_TIMELOCK_PERIOD);
      });

      it('should not apply updated timelock period to existing proposals', async () => {
        // Submit a proposal with the initial timelock period
        const proposalTx = {
          to: owner.address,
          value: 0,
          data: '0x',
          operation: 0,
        };
        await azorius
          .connect(proposer)
          .submitProposal([proposalTx], 'Existing proposal', ethers.ZeroAddress, ethers.ZeroHash);
        const existingProposalId = 0;

        // Update the timelock period
        await azorius.connect(owner).updateTimelockPeriod(NEW_TIMELOCK_PERIOD);

        // Check the timelock period of the existing proposal
        const [, , timelock, ,] = await azorius.getProposal(existingProposalId);
        expect(timelock).to.equal(INITIAL_TIMELOCK_PERIOD);

        // Submit a new proposal to ensure it gets the new period
        await azorius
          .connect(proposer)
          .submitProposal(
            [proposalTx],
            'New proposal post-update',
            ethers.ZeroAddress,
            ethers.ZeroHash,
          );
        const newProposalId = 1;
        const [, , newTimelock, ,] = await azorius.getProposal(newProposalId);
        expect(newTimelock).to.equal(NEW_TIMELOCK_PERIOD);
      });
    });

    describe('updateExecutionPeriod', () => {
      const NEW_EXECUTION_PERIOD = 400;

      it('should allow owner to update execution period', async () => {
        await expect(azorius.connect(owner).updateExecutionPeriod(NEW_EXECUTION_PERIOD))
          .to.emit(azorius, 'ExecutionPeriodUpdated')
          .withArgs(NEW_EXECUTION_PERIOD);
        expect(await azorius.executionPeriod()).to.equal(NEW_EXECUTION_PERIOD);
      });

      it('should not allow non-owner to update execution period', async () => {
        await expect(azorius.connect(nonOwner).updateExecutionPeriod(NEW_EXECUTION_PERIOD))
          .to.be.revertedWithCustomError(azorius, 'OwnableUnauthorizedAccount')
          .withArgs(nonOwner.address);
      });

      it('should apply updated execution period to new proposals', async () => {
        await azorius.connect(owner).updateExecutionPeriod(NEW_EXECUTION_PERIOD);

        const proposalTx = {
          to: owner.address,
          value: 0,
          data: '0x',
          operation: 0,
        };
        await azorius
          .connect(proposer)
          .submitProposal([proposalTx], 'New proposal', ethers.ZeroAddress, ethers.ZeroHash);
        const proposalId = 0;

        const [, , , executionPeriod] = await azorius.getProposal(proposalId);
        expect(executionPeriod).to.equal(NEW_EXECUTION_PERIOD);
      });

      it('should not apply updated execution period to existing proposals', async () => {
        const proposalTx = {
          to: owner.address,
          value: 0,
          data: '0x',
          operation: 0,
        };
        await azorius
          .connect(proposer)
          .submitProposal([proposalTx], 'Existing proposal', ethers.ZeroAddress, ethers.ZeroHash);
        const existingProposalId = 0;

        await azorius.connect(owner).updateExecutionPeriod(NEW_EXECUTION_PERIOD);

        const [, , , executionPeriod] = await azorius.getProposal(existingProposalId);
        expect(executionPeriod).to.equal(INITIAL_EXECUTION_PERIOD);

        await azorius
          .connect(proposer)
          .submitProposal(
            [proposalTx],
            'New proposal post-update',
            ethers.ZeroAddress,
            ethers.ZeroHash,
          );
        const newProposalId = 1;
        const [, , , newExecution] = await azorius.getProposal(newProposalId);
        expect(newExecution).to.equal(NEW_EXECUTION_PERIOD);
      });
    });

    describe('updateStrategy', () => {
      let newMockStrategy: MockVotingStrategy;
      let newMockStrategyAddress: string;

      beforeEach(async () => {
        // Deploy a new mock strategy for testing updates
        newMockStrategy = await new MockVotingStrategy__factory(proxyDeployer).deploy(
          proposer.address,
        );
        newMockStrategyAddress = await newMockStrategy.getAddress();
      });

      it('should allow owner to update strategy', async () => {
        await expect(azorius.connect(owner).updateStrategy(newMockStrategyAddress))
          .to.emit(azorius, 'StrategyUpdated')
          .withArgs(newMockStrategyAddress);
        expect(await azorius.strategy()).to.equal(newMockStrategyAddress);
      });

      it('should not allow non-owner to update strategy', async () => {
        await expect(azorius.connect(nonOwner).updateStrategy(newMockStrategyAddress))
          .to.be.revertedWithCustomError(azorius, 'OwnableUnauthorizedAccount')
          .withArgs(nonOwner.address);
      });

      it('should not allow updating to a zero address', async () => {
        await expect(
          azorius.connect(owner).updateStrategy(ethers.ZeroAddress),
        ).to.be.revertedWithCustomError(azorius, 'InvalidStrategy');
      });

      it('should apply updated strategy to new proposals', async () => {
        await azorius.connect(owner).updateStrategy(newMockStrategyAddress);

        const proposalTx = {
          to: owner.address,
          value: 0,
          data: '0x',
          operation: 0,
        };
        await azorius
          .connect(proposer)
          .submitProposal([proposalTx], 'New proposal', ethers.ZeroAddress, ethers.ZeroHash);
        const proposalId = 0;

        const [strategyAddress, , , ,] = await azorius.getProposal(proposalId);
        expect(strategyAddress).to.equal(newMockStrategyAddress);
      });

      it('should not apply updated strategy to existing proposals', async () => {
        const proposalTx = {
          to: owner.address,
          value: 0,
          data: '0x',
          operation: 0,
        };
        await azorius
          .connect(proposer)
          .submitProposal([proposalTx], 'Existing proposal', ethers.ZeroAddress, ethers.ZeroHash);
        const existingProposalId = 0;

        await azorius.connect(owner).updateStrategy(newMockStrategyAddress);

        const [strategyAddress, , , ,] = await azorius.getProposal(existingProposalId);
        expect(strategyAddress).to.equal(mockStrategyAddress); // Original strategy

        await azorius
          .connect(proposer)
          .submitProposal(
            [proposalTx],
            'New proposal post-update',
            ethers.ZeroAddress,
            ethers.ZeroHash,
          );
        const newProposalId = 1;
        const [newStrategy, , , ,] = await azorius.getProposal(newProposalId);
        expect(newStrategy).to.equal(newMockStrategyAddress);
      });

      it("should use the proposal's original strategy for proposalState determination", async () => {
        const proposalTx = {
          to: owner.address, // Simple target
          value: 0,
          data: '0x',
          operation: 0,
        };
        const existingProposalId = 0;

        // 1. Submit proposal with initial strategy (mockStrategy)
        // The azorius instance is already configured with mockStrategyAddress in the parent beforeEach
        await azorius
          .connect(proposer)
          .submitProposal(
            [proposalTx],
            'Existing proposal with mockStrategy',
            ethers.ZeroAddress,
            ethers.ZeroHash,
          );

        // 2. Configure initial strategy (mockStrategy) for this proposal
        const currentTimestamp = await time.latest();
        const initialVotingEnd = currentTimestamp + 10;
        await mockStrategy.setVotingTimestamps(
          existingProposalId,
          currentTimestamp,
          initialVotingEnd,
        );
        await mockStrategy.setIsPassed(existingProposalId, true); // Will pass according to initial strategy

        // 3. Configure newMockStrategy (if it were used, proposal would fail or be active longer)
        // newMockStrategy is deployed in this describe block's beforeEach
        const newStrategyVotingEnd = currentTimestamp + 1000;
        await newMockStrategy.setVotingTimestamps(
          existingProposalId,
          currentTimestamp,
          newStrategyVotingEnd,
        );
        await newMockStrategy.setIsPassed(existingProposalId, false); // Would fail under new strategy

        // 4. Update global strategy to newMockStrategy
        await azorius.connect(owner).updateStrategy(newMockStrategyAddress);

        // 5. Advance time past initialVotingEnd (but before newStrategyVotingEnd)
        await time.increaseTo(initialVotingEnd + 1);

        // 6. Check proposalState. It should be TIMELOCKED because it uses mockStrategy's settings.
        // ProposalState.TIMELOCKED is 1
        expect(await azorius.proposalState(existingProposalId)).to.equal(1);

        // 7. Further check: advance past timelock period. Should become EXECUTABLE.
        // INITIAL_TIMELOCK_PERIOD is available from the 'Owner Functions' describe block's scope.
        await time.increase(INITIAL_TIMELOCK_PERIOD);
        // ProposalState.EXECUTABLE is 2
        expect(await azorius.proposalState(existingProposalId)).to.equal(2);
      });
    });
  });

  describe('Version', () => {
    let azorius: ModuleAzoriusV1;

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
      expect(await azorius.version()).to.equal(1);
    });
  });

  describe('ERC165 supportsInterface', function () {
    let azoriusInstance: ModuleAzoriusV1;

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
    });

    runSupportsInterfaceTests({
      getContract: () => azoriusInstance,
      supportedInterfaceFactories: [
        IERC165__factory,
        IModuleAzoriusV1__factory,
        IVersion__factory,
        IDeploymentBlockV1__factory,
      ],
    });
  });

  describe('UUPS Upgradeability', function () {
    let azorius: ModuleAzoriusV1;

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
        const newImplementation = await new ModuleAzoriusV1__factory(owner).deploy();
        return newImplementation as unknown as UUPSUpgradeable;
      },
      owner: () => owner,
      nonOwner: () => nonOwner,
    });
  });

  describe('Deployment Block', () => {
    let azorius: ModuleAzoriusV1;

    beforeEach(async function () {
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

    runDeploymentBlockTests({
      getContract: () => azorius as unknown as IDeploymentBlockV1,
    });
  });
});
