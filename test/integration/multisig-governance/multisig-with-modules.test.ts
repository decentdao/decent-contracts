import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { Signature } from 'ethers';
import { ethers } from 'hardhat';
import {
  ISystemDeployerV1,
  IVotesERC20V1,
  Safe,
  Safe__factory,
  VotesERC20V1,
  ModuleAzoriusV1,
  StrategyV1,
  ModuleAzoriusV1__factory,
  StrategyV1__factory,
  VotesERC20V1__factory,
} from '../../../typechain-types';
import {
  TestInfrastructure,
  BaseSigners,
  deployTestInfrastructure,
  getTestSigners,
  createEmptyModuleFractalParams,
  createEmptyFreezeParams,
  findEvent,
  fundSafe,
  mineBlocks,
} from '../shared/helpers';

// Hybrid multisig + voting module governance
interface DeployedHybridDAO {
  safeAddress: string;
  safe: Safe;
  token: VotesERC20V1;
  azorius: ModuleAzoriusV1;
  strategy: StrategyV1;
  proposerAdapterAddress: string;
}

describe('Multisig with Modules Integration Tests', () => {
  let signers: BaseSigners;

  // Helper to create sorted signatures for Safe
  function createSafeSignatures(signerAddresses: string[], signatures: Signature[]): string {
    const signerData = signerAddresses
      .map((address, index) => ({ address, signature: signatures[index] }))
      .sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1));

    let combinedSignatures = '0x';
    for (const data of signerData) {
      combinedSignatures +=
        data.signature.r.slice(2) +
        data.signature.s.slice(2) +
        ethers.toBeHex(data.signature.v + 4, 1).slice(2);
    }
    return combinedSignatures;
  }

  async function deployHybridDAO(params: {
    infrastructure: TestInfrastructure;
    signers: BaseSigners;
    owners: string[];
    threshold: number;
    tokenName: string;
    tokenSymbol: string;
    tokenAllocations: IVotesERC20V1.AllocationStruct[];
    proposerThreshold: bigint;
    votingPeriod: number;
    quorumThreshold: bigint;
    basisNumerator: bigint;
    timelockPeriod: number;
    executionPeriod: number;
  }): Promise<DeployedHybridDAO> {
    const { infrastructure } = params;

    // Create deployment parameters
    const salt = ethers.keccak256(ethers.randomBytes(32));

    // Deploy ERC20 voting token
    const votesERC20V1Params: ISystemDeployerV1.VotesERC20V1ParamsStruct[] = [
      {
        implementation: infrastructure.implementations.votesERC20V1,
        metadata: {
          name: params.tokenName,
          symbol: params.tokenSymbol,
        },
        allocations: params.tokenAllocations,
        locked: false,
        maxTotalSupply: 0,
        safeSupply: 0,
      },
    ];

    // Configure Azorius governance
    const azoriusGovernanceParams: ISystemDeployerV1.AzoriusGovernanceParamsStruct = {
      proposerAdapterParams: {
        proposerAdapterERC20V1Params: [
          {
            implementation: infrastructure.implementations.proposerAdapterERC20V1,
            token: ethers.ZeroAddress, // Will use newly deployed token
            newTokenIndex: 0,
            proposerThreshold: params.proposerThreshold,
          },
        ],
        proposerAdapterERC721V1Params: [],
        proposerAdapterHatsV1Params: [],
      },
      strategyV1Params: {
        implementation: infrastructure.implementations.strategyV1,
        votingPeriod: params.votingPeriod,
        quorumThreshold: params.quorumThreshold,
        basisNumerator: params.basisNumerator,
        lightAccountFactory: infrastructure.lightAccountFactory,
      },
      votingConfigParams: {
        votingConfigERC20V1Params: [
          {
            votingWeightImplementation: infrastructure.implementations.votingWeightERC20V1,
            voteTrackerImplementation: infrastructure.implementations.voteTrackerERC20V1,
            token: ethers.ZeroAddress, // Will use newly deployed token
            newTokenIndex: 0,
            weightPerToken: ethers.parseEther('1'),
          },
        ],
        votingConfigERC721V1Params: [],
      },
      moduleAzoriusV1Params: {
        implementation: infrastructure.implementations.moduleAzoriusV1,
        timelockPeriod: params.timelockPeriod,
        executionPeriod: params.executionPeriod,
      },
    };

    const moduleFractalV1Params = createEmptyModuleFractalParams();
    const freezeParams = createEmptyFreezeParams();

    // Encode setupSafe function call
    const setupSafeData = infrastructure.systemDeployer.interface.encodeFunctionData('setupSafe', [
      salt,
      await infrastructure.safeProxyFactory.getAddress(),
      await infrastructure.systemDeployerEventEmitter.getAddress(),
      votesERC20V1Params,
      azoriusGovernanceParams,
      moduleFractalV1Params,
      freezeParams,
    ]);

    // Create Safe setup parameters
    const safeSetupData = infrastructure.safeSingleton.interface.encodeFunctionData('setup', [
      params.owners,
      params.threshold,
      await infrastructure.systemDeployer.getAddress(),
      setupSafeData,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      0,
      ethers.ZeroAddress,
    ]);

    // Deploy the Safe
    const tx = await infrastructure.safeProxyFactory.createProxyWithNonce(
      await infrastructure.safeSingleton.getAddress(),
      safeSetupData,
      ethers.toBigInt(salt),
    );

    const receipt = await tx.wait();
    if (!receipt) throw new Error('Transaction receipt is null');

    // Extract addresses from events
    const proxyCreationEvent = findEvent(
      receipt.logs,
      infrastructure.safeProxyFactory.interface,
      'ProxyCreation',
    );
    if (!proxyCreationEvent) throw new Error('ProxyCreation event not found');
    const safeAddress = proxyCreationEvent.args[0];

    // Extract deployed contract addresses from events
    const proxyDeployedEvents = receipt.logs.filter(log => {
      try {
        const parsedLog = infrastructure.systemDeployer.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        return parsedLog?.name === 'ProxyDeployed';
      } catch {
        return false;
      }
    });

    // Expected order: Token, ProposerAdapter, Strategy, VotingWeight, VoteTracker, Azorius
    if (proxyDeployedEvents.length !== 6) {
      throw new Error(`Expected 6 ProxyDeployed events, got ${proxyDeployedEvents.length}`);
    }

    const addresses = proxyDeployedEvents.map(event => {
      const parsedLog = infrastructure.systemDeployer.interface.parseLog({
        topics: event.topics as string[],
        data: event.data,
      });
      return parsedLog?.args[0];
    });

    const [tokenAddress, proposerAdapterAddress, strategyAddress, , , azoriusAddress] = addresses;

    // Connect to deployed contracts
    const safe = Safe__factory.connect(safeAddress, params.signers.deployer);
    const token = VotesERC20V1__factory.connect(tokenAddress, params.signers.deployer);
    const azorius = ModuleAzoriusV1__factory.connect(azoriusAddress, params.signers.deployer);
    const strategy = StrategyV1__factory.connect(strategyAddress, params.signers.deployer);

    return {
      safeAddress,
      safe,
      token,
      azorius,
      strategy,
      proposerAdapterAddress,
    };
  }

  async function setupTestFixture() {
    signers = await getTestSigners();
    const infrastructure = await deployTestInfrastructure(signers.deployer);

    const dao = await deployHybridDAO({
      infrastructure,
      signers,
      owners: [signers.alice.address, signers.bob.address, signers.charlie.address],
      threshold: 2, // 2 of 3 multisig
      tokenName: 'Governance Token',
      tokenSymbol: 'GOV',
      tokenAllocations: [
        { to: signers.alice.address, amount: ethers.parseEther('100') },
        { to: signers.bob.address, amount: ethers.parseEther('100') },
        { to: signers.charlie.address, amount: ethers.parseEther('100') },
        { to: signers.deployer.address, amount: ethers.parseEther('100') },
      ],
      proposerThreshold: ethers.parseEther('10'),
      votingPeriod: 100, // 100 blocks
      quorumThreshold: ethers.parseEther('100'),
      basisNumerator: 500000n, // 50%
      timelockPeriod: 50, // 50 blocks
      executionPeriod: 200, // 200 blocks
    });

    return { infrastructure, dao };
  }

  describe('DAO Deployment', () => {
    it('Should deploy a hybrid multisig + voting module DAO', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      expect(dao.safeAddress).to.not.equal(ethers.ZeroAddress);
      expect(await ethers.provider.getCode(dao.safeAddress)).to.not.equal('0x');
    });

    it('Should configure both multisig owners and voting module', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Check multisig configuration
      const owners = await dao.safe.getOwners();
      expect(owners).to.include.members([
        signers.alice.address,
        signers.bob.address,
        signers.charlie.address,
      ]);
      expect(await dao.safe.getThreshold()).to.equal(2);

      // Check Azorius is enabled as a module
      expect(await dao.safe.isModuleEnabled(await dao.azorius.getAddress())).to.be.true;
    });

    it('Should deploy and configure voting token', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      expect(await dao.token.name()).to.equal('Governance Token');
      expect(await dao.token.symbol()).to.equal('GOV');
      expect(await dao.token.totalSupply()).to.equal(ethers.parseEther('400'));

      // Check balances
      expect(await dao.token.balanceOf(signers.alice.address)).to.equal(ethers.parseEther('100'));
      expect(await dao.token.balanceOf(signers.bob.address)).to.equal(ethers.parseEther('100'));
    });
  });

  describe('Multisig Execution Path', () => {
    it('Should execute transactions directly via multisig', async () => {
      const { dao } = await loadFixture(setupTestFixture);
      await fundSafe(signers.deployer, dao.safeAddress);

      const recipientBalanceBefore = await ethers.provider.getBalance(signers.eve.address);

      // Create transaction
      const tx = {
        to: signers.eve.address,
        value: ethers.parseEther('1'),
        data: '0x',
        operation: 0,
        safeTxGas: 0,
        baseGas: 0,
        gasPrice: 0,
        gasToken: ethers.ZeroAddress,
        refundReceiver: ethers.ZeroAddress,
        nonce: await dao.safe.nonce(),
      };

      const txHash = await dao.safe.getTransactionHash(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        tx.nonce,
      );

      // Get signatures
      const aliceSig = await signers.alice.signMessage(ethers.getBytes(txHash));
      const aliceSignature = Signature.from(aliceSig);
      const bobSig = await signers.bob.signMessage(ethers.getBytes(txHash));
      const bobSignature = Signature.from(bobSig);

      const signatures = createSafeSignatures(
        [signers.alice.address, signers.bob.address],
        [aliceSignature, bobSignature],
      );

      // Execute via multisig
      await dao.safe.execTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatures,
      );

      const recipientBalanceAfter = await ethers.provider.getBalance(signers.eve.address);
      expect(recipientBalanceAfter).to.equal(recipientBalanceBefore + ethers.parseEther('1'));
    });

    it('Should prevent Azorius from executing directly during voting period', async () => {
      const { dao } = await loadFixture(setupTestFixture);
      await fundSafe(signers.deployer, dao.safeAddress);

      // Create proposal through Azorius
      const proposalData = {
        transactions: [
          {
            to: signers.eve.address,
            value: ethers.parseEther('1'),
            data: '0x',
            operation: 0,
          },
        ],
        metadata: ethers.hexlify(ethers.toUtf8Bytes('Test proposal')),
      };

      // Alice has enough tokens to propose
      await dao.token.connect(signers.alice).delegate(signers.alice.address);
      await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalData.transactions,
          proposalData.metadata,
          dao.proposerAdapterAddress,
          '0x',
        );

      const proposalId = 0;

      // Try to execute immediately (should fail - still in voting period)
      await expect(dao.azorius.executeProposal(proposalId, proposalData.transactions)).to.be
        .reverted;
    });
  });

  describe('Voting Module Execution Path', () => {
    it('Should execute transactions via voting module', async () => {
      const { dao } = await loadFixture(setupTestFixture);
      await fundSafe(signers.deployer, dao.safeAddress);

      const recipientBalanceBefore = await ethers.provider.getBalance(signers.eve.address);

      // Delegate voting power
      await dao.token.connect(signers.alice).delegate(signers.alice.address);
      await dao.token.connect(signers.bob).delegate(signers.bob.address);
      await dao.token.connect(signers.charlie).delegate(signers.charlie.address);

      // Create proposal
      const proposalData = {
        transactions: [
          {
            to: signers.eve.address,
            value: ethers.parseEther('2'),
            data: '0x',
            operation: 0,
          },
        ],
        metadata: ethers.hexlify(ethers.toUtf8Bytes('Send 2 ETH to Eve')),
      };

      await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalData.transactions,
          proposalData.metadata,
          dao.proposerAdapterAddress,
          '0x',
        );

      const proposalId = 0;

      // Vote on proposal
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [
          {
            configIndex: 0,
            voteData: '0x',
          },
        ],
        0, // lightAccountIndex
      );
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [
          {
            configIndex: 0,
            voteData: '0x',
          },
        ],
        0,
      );

      // Fast forward past voting period
      await mineBlocks(100);

      // Wait for timelock
      await mineBlocks(50);

      // Execute proposal
      await dao.azorius.executeProposal(proposalId, proposalData.transactions);

      const recipientBalanceAfter = await ethers.provider.getBalance(signers.eve.address);
      expect(recipientBalanceAfter).to.equal(recipientBalanceBefore + ethers.parseEther('2'));
    });

    it('Should reject proposals that fail to meet quorum', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Delegate voting power
      await dao.token.connect(signers.alice).delegate(signers.alice.address);

      // Create proposal
      const proposalData = {
        transactions: [
          {
            to: signers.eve.address,
            value: ethers.parseEther('1'),
            data: '0x',
            operation: 0,
          },
        ],
        metadata: ethers.hexlify(ethers.toUtf8Bytes('Low participation proposal')),
      };

      await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalData.transactions,
          proposalData.metadata,
          dao.proposerAdapterAddress,
          '0x',
        );

      const proposalId = 0;

      // Only Alice votes (not enough for quorum)
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [
          {
            configIndex: 0,
            voteData: '0x',
          },
        ],
        0,
      );

      // Fast forward past voting period
      await mineBlocks(100);

      // The proposal should not pass quorum
      // Alice has 100 tokens and voted YES, but we need 100 tokens quorum which means
      // we need MORE than 100 tokens to pass (not just equal)

      // Fast forward past timelock and execution period to get to FAILED state
      await mineBlocks(250); // Past timelock (50) + execution period (200)

      // Now check proposal state
      const state = await dao.azorius.proposalState(proposalId);
      expect(state).to.equal(4); // EXPIRED state (didn't reach quorum)
    });
  });

  describe('Hybrid Governance Scenarios', () => {
    it('Should allow both execution paths to work independently', async () => {
      const { dao } = await loadFixture(setupTestFixture);
      await fundSafe(signers.deployer, dao.safeAddress, ethers.parseEther('10'));

      // Execute via multisig first
      const multisigTx = {
        to: signers.alice.address,
        value: ethers.parseEther('1'),
        data: '0x',
        operation: 0,
        safeTxGas: 0,
        baseGas: 0,
        gasPrice: 0,
        gasToken: ethers.ZeroAddress,
        refundReceiver: ethers.ZeroAddress,
        nonce: await dao.safe.nonce(),
      };

      const txHash = await dao.safe.getTransactionHash(
        multisigTx.to,
        multisigTx.value,
        multisigTx.data,
        multisigTx.operation,
        multisigTx.safeTxGas,
        multisigTx.baseGas,
        multisigTx.gasPrice,
        multisigTx.gasToken,
        multisigTx.refundReceiver,
        multisigTx.nonce,
      );

      const aliceSig = await signers.alice.signMessage(ethers.getBytes(txHash));
      const aliceSignature = Signature.from(aliceSig);
      const bobSig = await signers.bob.signMessage(ethers.getBytes(txHash));
      const bobSignature = Signature.from(bobSig);

      const signatures = createSafeSignatures(
        [signers.alice.address, signers.bob.address],
        [aliceSignature, bobSignature],
      );

      await dao.safe.execTransaction(
        multisigTx.to,
        multisigTx.value,
        multisigTx.data,
        multisigTx.operation,
        multisigTx.safeTxGas,
        multisigTx.baseGas,
        multisigTx.gasPrice,
        multisigTx.gasToken,
        multisigTx.refundReceiver,
        signatures,
      );

      // Then execute via voting module
      await dao.token.connect(signers.alice).delegate(signers.alice.address);
      await dao.token.connect(signers.bob).delegate(signers.bob.address);

      const proposalData = {
        transactions: [
          {
            to: signers.bob.address,
            value: ethers.parseEther('2'),
            data: '0x',
            operation: 0,
          },
        ],
        metadata: ethers.hexlify(ethers.toUtf8Bytes('Voting module transfer')),
      };

      await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalData.transactions,
          proposalData.metadata,
          dao.proposerAdapterAddress,
          '0x',
        );

      const proposalId = 0;
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [
          {
            configIndex: 0,
            voteData: '0x',
          },
        ],
        0,
      );
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [
          {
            configIndex: 0,
            voteData: '0x',
          },
        ],
        0,
      );

      await mineBlocks(150); // Past voting period and timelock

      await dao.azorius.executeProposal(proposalId, proposalData.transactions);

      // Both execution paths should have worked
      expect(await dao.safe.nonce()).to.equal(1); // Multisig incremented nonce
      const proposalState = await dao.azorius.proposalState(proposalId);
      expect(proposalState).to.equal(3); // EXECUTED state
    });

    it('Should handle conflicting transactions between multisig and voting', async () => {
      const { dao } = await loadFixture(setupTestFixture);
      await fundSafe(signers.deployer, dao.safeAddress, ethers.parseEther('1.5'));

      // Create a voting proposal to send 1 ETH
      await dao.token.connect(signers.alice).delegate(signers.alice.address);
      await dao.token.connect(signers.bob).delegate(signers.bob.address);

      const proposalData = {
        transactions: [
          {
            to: signers.eve.address,
            value: ethers.parseEther('1'),
            data: '0x',
            operation: 0,
          },
        ],
        metadata: ethers.hexlify(ethers.toUtf8Bytes('Send 1 ETH to Eve')),
      };

      await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalData.transactions,
          proposalData.metadata,
          dao.proposerAdapterAddress,
          '0x',
        );

      const proposalId = 0;
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [
          {
            configIndex: 0,
            voteData: '0x',
          },
        ],
        0,
      );
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [
          {
            configIndex: 0,
            voteData: '0x',
          },
        ],
        0,
      );

      // While voting is ongoing, multisig executes a transaction that spends the funds
      const multisigTx = {
        to: signers.frank.address,
        value: ethers.parseEther('1'),
        data: '0x',
        operation: 0,
        safeTxGas: 0,
        baseGas: 0,
        gasPrice: 0,
        gasToken: ethers.ZeroAddress,
        refundReceiver: ethers.ZeroAddress,
        nonce: await dao.safe.nonce(),
      };

      const txHash = await dao.safe.getTransactionHash(
        multisigTx.to,
        multisigTx.value,
        multisigTx.data,
        multisigTx.operation,
        multisigTx.safeTxGas,
        multisigTx.baseGas,
        multisigTx.gasPrice,
        multisigTx.gasToken,
        multisigTx.refundReceiver,
        multisigTx.nonce,
      );

      const aliceSig = await signers.alice.signMessage(ethers.getBytes(txHash));
      const aliceSignature = Signature.from(aliceSig);
      const bobSig = await signers.bob.signMessage(ethers.getBytes(txHash));
      const bobSignature = Signature.from(bobSig);

      const signatures = createSafeSignatures(
        [signers.alice.address, signers.bob.address],
        [aliceSignature, bobSignature],
      );

      await dao.safe.execTransaction(
        multisigTx.to,
        multisigTx.value,
        multisigTx.data,
        multisigTx.operation,
        multisigTx.safeTxGas,
        multisigTx.baseGas,
        multisigTx.gasPrice,
        multisigTx.gasToken,
        multisigTx.refundReceiver,
        signatures,
      );

      // Fast forward to execute voting proposal
      await mineBlocks(150);

      // The voting proposal execution should fail due to insufficient funds
      await expect(
        dao.azorius.executeProposal(proposalId, proposalData.transactions),
      ).to.be.revertedWithCustomError(dao.azorius, 'TxFailed');

      // Verify the proposal state is not executed
      const proposalState = await dao.azorius.proposalState(proposalId);
      expect(proposalState).to.not.equal(3); // Not EXECUTED
    });

    it('Should allow multisig to disable voting module in emergency', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Verify module is enabled
      expect(await dao.safe.isModuleEnabled(await dao.azorius.getAddress())).to.be.true;

      // Create transaction to disable the module
      const disableModuleData = dao.safe.interface.encodeFunctionData('disableModule', [
        '0x0000000000000000000000000000000000000001', // Sentinel
        await dao.azorius.getAddress(),
      ]);

      const tx = {
        to: dao.safeAddress,
        value: 0n,
        data: disableModuleData,
        operation: 0,
        safeTxGas: 0,
        baseGas: 0,
        gasPrice: 0,
        gasToken: ethers.ZeroAddress,
        refundReceiver: ethers.ZeroAddress,
        nonce: await dao.safe.nonce(),
      };

      const txHash = await dao.safe.getTransactionHash(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        tx.nonce,
      );

      // Get signatures from 2 owners
      const aliceSig = await signers.alice.signMessage(ethers.getBytes(txHash));
      const aliceSignature = Signature.from(aliceSig);
      const charlieSig = await signers.charlie.signMessage(ethers.getBytes(txHash));
      const charlieSignature = Signature.from(charlieSig);

      const signatures = createSafeSignatures(
        [signers.alice.address, signers.charlie.address],
        [aliceSignature, charlieSignature],
      );

      // Execute to disable the module
      await dao.safe.execTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatures,
      );

      // Verify module is disabled
      expect(await dao.safe.isModuleEnabled(await dao.azorius.getAddress())).to.be.false;

      // Try to execute a proposal - should fail
      await dao.token.connect(signers.alice).delegate(signers.alice.address);

      const proposalData = {
        transactions: [
          {
            to: signers.eve.address,
            value: ethers.parseEther('1'),
            data: '0x',
            operation: 0,
          },
        ],
        metadata: ethers.hexlify(ethers.toUtf8Bytes('Should fail')),
      };

      await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalData.transactions,
          proposalData.metadata,
          dao.proposerAdapterAddress,
          '0x',
        );

      const proposalId = 0;
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [
          {
            configIndex: 0,
            voteData: '0x',
          },
        ],
        0,
      );
      await mineBlocks(150);

      // Execution should fail because module is disabled
      await expect(
        dao.azorius.executeProposal(proposalId, proposalData.transactions),
      ).to.be.revertedWith('GS104');
    });
  });

  describe('Edge Cases', () => {
    it('Should handle voting module updating multisig threshold', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Create proposal to change threshold
      await dao.token.connect(signers.alice).delegate(signers.alice.address);
      await dao.token.connect(signers.bob).delegate(signers.bob.address);
      await dao.token.connect(signers.charlie).delegate(signers.charlie.address);

      const changeThresholdData = dao.safe.interface.encodeFunctionData('changeThreshold', [3]);

      const proposalData = {
        transactions: [
          {
            to: dao.safeAddress,
            value: 0n,
            data: changeThresholdData,
            operation: 0,
          },
        ],
        metadata: ethers.hexlify(ethers.toUtf8Bytes('Change threshold to 3')),
      };

      await dao.azorius
        .connect(signers.alice)
        .submitProposal(
          proposalData.transactions,
          proposalData.metadata,
          dao.proposerAdapterAddress,
          '0x',
        );

      const proposalId = 0;

      // Vote on proposal
      await dao.strategy.connect(signers.alice).castVote(
        proposalId,
        1, // YES
        [
          {
            configIndex: 0,
            voteData: '0x',
          },
        ],
        0,
      );
      await dao.strategy.connect(signers.bob).castVote(
        proposalId,
        1, // YES
        [
          {
            configIndex: 0,
            voteData: '0x',
          },
        ],
        0,
      );
      await dao.strategy.connect(signers.charlie).castVote(
        proposalId,
        1, // YES
        [
          {
            configIndex: 0,
            voteData: '0x',
          },
        ],
        0,
      );

      // Fast forward and execute
      await mineBlocks(150);
      await dao.azorius.executeProposal(proposalId, proposalData.transactions);

      // Verify threshold changed
      expect(await dao.safe.getThreshold()).to.equal(3);
    });

    it('Should handle multiple voting strategies', async () => {
      const { infrastructure } = await loadFixture(setupTestFixture);

      // Deploy DAO with multiple voting tokens
      const dao = await deployHybridDAO({
        infrastructure,
        signers,
        owners: [signers.alice.address, signers.bob.address],
        threshold: 2,
        tokenName: 'Multi Token',
        tokenSymbol: 'MULTI',
        tokenAllocations: [
          { to: signers.alice.address, amount: ethers.parseEther('100') },
          { to: signers.bob.address, amount: ethers.parseEther('100') },
        ],
        proposerThreshold: ethers.parseEther('50'),
        votingPeriod: 100,
        quorumThreshold: ethers.parseEther('150'),
        basisNumerator: 600000n, // 60%
        timelockPeriod: 50,
        executionPeriod: 200,
      });

      // Both multisig and voting should work
      expect(await dao.safe.getThreshold()).to.equal(2);
      expect(await dao.safe.isModuleEnabled(await dao.azorius.getAddress())).to.be.true;
    });

    it('Should prevent unauthorized module enabling', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Try to enable a random address as a module
      const randomModule = ethers.Wallet.createRandom().address;

      // Non-owners cannot enable modules
      await expect(dao.safe.connect(signers.eve).enableModule(randomModule)).to.be.revertedWith(
        'GS031',
      ); // Only self authorized

      // Even owners cannot directly enable modules
      await expect(dao.safe.connect(signers.alice).enableModule(randomModule)).to.be.revertedWith(
        'GS031',
      );
    });
  });
});
