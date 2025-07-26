import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { Signature } from 'ethers';
import hre from 'hardhat';
const { ethers } = hre;
import {
  Safe,
  Safe__factory,
  FreezeVotingMultisigV1,
  FreezeVotingMultisigV1__factory,
  FreezeGuardAzoriusV1,
  FreezeGuardAzoriusV1__factory,
  ModuleAzoriusV1,
  ModuleAzoriusV1__factory,
  StrategyV1,
  StrategyV1__factory,
  VotesERC20V1,
  VotesERC20V1__factory,
  ISystemDeployerV1,
} from '../../../typechain-types';
import {
  TestInfrastructure,
  deployTestInfrastructure,
  createEmptyModuleFractalParams,
  createEmptyFreezeParams,
  findEvent,
  fastForwardTime,
} from '../shared/helpers';

describe('Freeze Multisig-Azorius - Using SystemDeployer', () => {
  let deployer: SignerWithAddress;
  let parentOwner1: SignerWithAddress;
  let parentOwner2: SignerWithAddress;
  let parentOwner3: SignerWithAddress;
  let childTokenHolder1: SignerWithAddress;
  let childTokenHolder2: SignerWithAddress;
  let childTokenHolder3: SignerWithAddress;
  let alice: SignerWithAddress;

  let infrastructure: TestInfrastructure;
  let parentSafe: Safe;
  let childSafe: Safe;
  let childAzorius: ModuleAzoriusV1;
  let childStrategy: StrategyV1;
  let childToken: VotesERC20V1;
  let freezeVoting: FreezeVotingMultisigV1;
  let freezeGuard: FreezeGuardAzoriusV1;

  const FREEZE_VOTES_THRESHOLD = 2; // 2 out of 3 parent owners must vote to freeze
  const FREEZE_PROPOSAL_PERIOD = 3600; // 1 hour
  const CHILD_VOTING_PERIOD = 7200; // 2 hours
  const CHILD_TIMELOCK_PERIOD = 1800; // 30 minutes
  const CHILD_EXECUTION_PERIOD = 86400; // 24 hours

  interface DeployedSafe {
    safe: Safe;
    safeAddress: string;
  }

  interface DeployedChildSafe extends DeployedSafe {
    azorius: ModuleAzoriusV1;
    strategy: StrategyV1;
    token: VotesERC20V1;
    freezeVoting: FreezeVotingMultisigV1;
    freezeGuard: FreezeGuardAzoriusV1;
    proposerAdapter: string;
  }

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

  async function deployParentMultisig(
    infra: TestInfrastructure,
    owners: string[],
    threshold: number,
  ): Promise<DeployedSafe> {
    // Parent is a simple multisig with no special modules
    const saltNonce = BigInt(ethers.keccak256(ethers.randomBytes(32)));
    const salt = ethers.solidityPackedKeccak256(['uint256'], [saltNonce]);

    // No tokens for multisig
    const votesERC20Params: ISystemDeployerV1.VotesERC20V1ParamsStruct[] = [];

    // No Azorius governance
    const azoriusGovernanceParams: ISystemDeployerV1.AzoriusGovernanceParamsStruct = {
      proposerAdapterParams: {
        proposerAdapterERC20V1Params: [],
        proposerAdapterERC721V1Params: [],
        proposerAdapterHatsV1Params: [],
      },
      strategyV1Params: {
        implementation: ethers.ZeroAddress,
        votingPeriod: 0,
        quorumThreshold: 0,
        basisNumerator: 0,
        lightAccountFactory: ethers.ZeroAddress,
      },
      votingConfigParams: {
        votingConfigERC20V1Params: [],
        votingConfigERC721V1Params: [],
      },
      moduleAzoriusV1Params: {
        implementation: ethers.ZeroAddress,
        timelockPeriod: 0,
        executionPeriod: 0,
      },
    };

    // No fractal module
    const moduleFractalV1Params = createEmptyModuleFractalParams();

    // No freeze params for parent (it doesn't get frozen)
    const freezeParams = createEmptyFreezeParams();

    // Encode setupSafe function call
    const setupSafeData = infra.systemDeployer.interface.encodeFunctionData('setupSafe', [
      salt,
      await infra.safeProxyFactory.getAddress(),
      await infra.systemDeployerEventEmitter.getAddress(),
      votesERC20Params,
      azoriusGovernanceParams,
      moduleFractalV1Params,
      freezeParams,
    ]);

    // Create Safe setup parameters
    const safeSetupData = infra.safeSingleton.interface.encodeFunctionData('setup', [
      owners,
      threshold,
      await infra.systemDeployer.getAddress(),
      setupSafeData,
      ethers.ZeroAddress, // fallbackHandler
      ethers.ZeroAddress, // paymentToken
      0, // payment
      ethers.ZeroAddress, // paymentReceiver
    ]);

    // Deploy the parent Safe
    const tx = await infra.safeProxyFactory.createProxyWithNonce(
      await infra.safeSingleton.getAddress(),
      safeSetupData,
      saltNonce,
    );

    const receipt = await tx.wait();

    // Extract Safe address
    const safeEvent = findEvent(receipt!.logs, infra.safeProxyFactory.interface, 'ProxyCreation');
    if (!safeEvent) throw new Error('ProxyCreation event not found');
    const safeAddress = safeEvent.args[0];
    const safe = Safe__factory.connect(safeAddress, deployer);

    return { safe, safeAddress };
  }

  async function deployChildAzoriusWithFreeze(
    infra: TestInfrastructure,
    owners: string[],
    threshold: number,
    tokenHolders: { address: string; amount: bigint }[],
    parentSafeAddress: string,
  ): Promise<DeployedChildSafe> {
    // Child has Azorius governance with freeze voting and freeze guard
    const saltNonce = BigInt(ethers.keccak256(ethers.randomBytes(32)));
    const salt = ethers.solidityPackedKeccak256(['uint256'], [saltNonce]);

    // Deploy governance token for child
    const votesERC20Params: ISystemDeployerV1.VotesERC20V1ParamsStruct[] = [
      {
        implementation: infra.implementations.votesERC20V1,
        metadata: {
          name: 'Child Token',
          symbol: 'CHILD',
        },
        allocations: tokenHolders.map(h => ({
          to: h.address,
          amount: h.amount,
        })),
        locked: false,
        maxTotalSupply: 0, // No max supply
        safeSupply: 0, // No tokens allocated to Safe
      },
    ];

    // Azorius governance parameters for child
    const azoriusGovernanceParams: ISystemDeployerV1.AzoriusGovernanceParamsStruct = {
      proposerAdapterParams: {
        proposerAdapterERC20V1Params: [
          {
            implementation: infra.implementations.proposerAdapterERC20V1,
            token: ethers.ZeroAddress, // Will use newly deployed token
            newTokenIndex: 0,
            proposerThreshold: ethers.parseEther('10'), // 10 tokens to propose
          },
        ],
        proposerAdapterERC721V1Params: [],
        proposerAdapterHatsV1Params: [],
      },
      strategyV1Params: {
        implementation: infra.implementations.strategyV1,
        votingPeriod: CHILD_VOTING_PERIOD,
        quorumThreshold: ethers.parseEther('150'), // 50% of 300 tokens
        basisNumerator: 500000n, // 50%
        lightAccountFactory: ethers.ZeroAddress,
      },
      votingConfigParams: {
        votingConfigERC20V1Params: [
          {
            votingWeightImplementation: infra.implementations.votingWeightERC20V1,
            voteTrackerImplementation: infra.implementations.voteTrackerERC20V1,
            token: ethers.ZeroAddress, // Will use newly deployed token
            newTokenIndex: 0,
            weightPerToken: 1n, // 1:1 weight
          },
        ],
        votingConfigERC721V1Params: [],
      },
      moduleAzoriusV1Params: {
        implementation: infra.implementations.moduleAzoriusV1,
        timelockPeriod: CHILD_TIMELOCK_PERIOD,
        executionPeriod: CHILD_EXECUTION_PERIOD,
      },
    };

    // No fractal module
    const moduleFractalV1Params = createEmptyModuleFractalParams();

    // Freeze params for child - has both freeze voting (multisig type) and freeze guard (azorius type)
    const freezeParams: ISystemDeployerV1.FreezeParamsStruct = {
      freezeGuardParams: {
        freezeGuardMultisigV1Params: {
          implementation: ethers.ZeroAddress,
          owner: ethers.ZeroAddress,
          timelockPeriod: 0,
          executionPeriod: 0,
        },
        freezeGuardAzoriusV1Params: {
          implementation: infra.implementations.freezeGuardAzoriusV1,
          owner: owners[0], // Use first owner as the guard owner
        },
      },
      freezeVotingParams: {
        freezeVotingMultisigV1Params: {
          implementation: infra.implementations.freezeVotingMultisigV1,
          owner: owners[0], // Use first owner as the voting owner
          freezeVotesThreshold: FREEZE_VOTES_THRESHOLD,
          freezeProposalPeriod: FREEZE_PROPOSAL_PERIOD,
          parentSafe: parentSafeAddress, // Reference to parent Safe
          lightAccountFactory: ethers.ZeroAddress,
        },
        freezeVotingAzoriusV1Params: {
          implementation: ethers.ZeroAddress,
          owner: ethers.ZeroAddress,
          freezeVotesThreshold: 0,
          freezeProposalPeriod: 0,
          parentAzorius: ethers.ZeroAddress,
          lightAccountFactory: ethers.ZeroAddress,
        },
        freezeVotingStandaloneParams: {
          freezeVotingStandaloneV1Params: {
            implementation: ethers.ZeroAddress,
            freezeVotesThreshold: 0,
            unfreezeVotesThreshold: 0,
            freezeProposalPeriod: 0,
            unfreezeProposalPeriod: 0,
            lightAccountFactory: ethers.ZeroAddress,
          },
          votingConfigParams: {
            votingConfigERC20V1Params: [],
            votingConfigERC721V1Params: [],
          },
        },
      },
    };

    // Encode setupSafe function call
    const setupSafeData = infra.systemDeployer.interface.encodeFunctionData('setupSafe', [
      salt,
      await infra.safeProxyFactory.getAddress(),
      await infra.systemDeployerEventEmitter.getAddress(),
      votesERC20Params,
      azoriusGovernanceParams,
      moduleFractalV1Params,
      freezeParams,
    ]);

    // Create Safe setup parameters
    const safeSetupData = infra.safeSingleton.interface.encodeFunctionData('setup', [
      owners,
      threshold,
      await infra.systemDeployer.getAddress(),
      setupSafeData,
      ethers.ZeroAddress, // fallbackHandler
      ethers.ZeroAddress, // paymentToken
      0, // payment
      ethers.ZeroAddress, // paymentReceiver
    ]);

    // Deploy the child Safe with Azorius and freeze mechanisms
    const tx = await infra.safeProxyFactory.createProxyWithNonce(
      await infra.safeSingleton.getAddress(),
      safeSetupData,
      saltNonce,
    );

    const receipt = await tx.wait();

    // Extract Safe address
    const safeEvent = findEvent(receipt!.logs, infra.safeProxyFactory.interface, 'ProxyCreation');
    if (!safeEvent) throw new Error('ProxyCreation event not found');
    const safeAddress = safeEvent.args[0];
    const safe = Safe__factory.connect(safeAddress, deployer);

    // Parse all ProxyDeployed events
    const proxyDeployedEvents = receipt!.logs.filter((log: any) => {
      try {
        const parsed = infra.systemDeployer.interface.parseLog({
          topics: log.topics,
          data: log.data,
        });
        return parsed?.name === 'ProxyDeployed';
      } catch {
        return false;
      }
    });

    // Extract token address
    const tokenEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infra.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infra.implementations.votesERC20V1;
    });
    if (!tokenEvent) throw new Error('Token deployment event not found');
    const tokenParsed = infra.systemDeployer.interface.parseLog({
      topics: tokenEvent.topics as string[],
      data: tokenEvent.data,
    });
    const tokenAddress = tokenParsed?.args?.[0];
    const token = VotesERC20V1__factory.connect(tokenAddress, deployer);

    // Extract Azorius address
    const azoriusEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infra.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infra.implementations.moduleAzoriusV1;
    });
    if (!azoriusEvent) throw new Error('Azorius deployment event not found');
    const azoriusParsed = infra.systemDeployer.interface.parseLog({
      topics: azoriusEvent.topics as string[],
      data: azoriusEvent.data,
    });
    const azoriusAddress = azoriusParsed?.args?.[0];
    const azorius = ModuleAzoriusV1__factory.connect(azoriusAddress, deployer);

    // Extract Strategy address
    const strategyEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infra.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infra.implementations.strategyV1;
    });
    if (!strategyEvent) throw new Error('Strategy deployment event not found');
    const strategyParsed = infra.systemDeployer.interface.parseLog({
      topics: strategyEvent.topics as string[],
      data: strategyEvent.data,
    });
    const strategyAddress = strategyParsed?.args?.[0];
    const strategy = StrategyV1__factory.connect(strategyAddress, deployer);

    // Extract FreezeVoting address
    const freezeVotingEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infra.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infra.implementations.freezeVotingMultisigV1;
    });

    if (!freezeVotingEvent) throw new Error('FreezeVotingMultisig deployment event not found');
    const freezeVotingParsed = infra.systemDeployer.interface.parseLog({
      topics: freezeVotingEvent.topics as string[],
      data: freezeVotingEvent.data,
    });
    const freezeVotingAddress = freezeVotingParsed?.args?.[0];
    freezeVoting = FreezeVotingMultisigV1__factory.connect(freezeVotingAddress, deployer);

    // Extract FreezeGuard address
    const freezeGuardEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infra.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infra.implementations.freezeGuardAzoriusV1;
    });

    if (!freezeGuardEvent) throw new Error('FreezeGuardAzorius deployment event not found');
    const freezeGuardParsed = infra.systemDeployer.interface.parseLog({
      topics: freezeGuardEvent.topics as string[],
      data: freezeGuardEvent.data,
    });
    const freezeGuardAddress = freezeGuardParsed?.args?.[0];
    freezeGuard = FreezeGuardAzoriusV1__factory.connect(freezeGuardAddress, deployer);

    // Extract proposer adapter address
    const proposerAdapterEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infra.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infra.implementations.proposerAdapterERC20V1;
    });
    if (!proposerAdapterEvent) throw new Error('Proposer adapter deployment event not found');
    const proposerAdapterParsed = infra.systemDeployer.interface.parseLog({
      topics: proposerAdapterEvent.topics as string[],
      data: proposerAdapterEvent.data,
    });
    const proposerAdapterAddress = proposerAdapterParsed?.args?.[0];

    return {
      safe,
      safeAddress,
      azorius,
      strategy,
      token,
      freezeVoting,
      freezeGuard,
      proposerAdapter: proposerAdapterAddress,
    };
  }

  async function setupTestFixture() {
    [
      deployer,
      parentOwner1,
      parentOwner2,
      parentOwner3,
      childTokenHolder1,
      childTokenHolder2,
      childTokenHolder3,
      alice,
    ] = await ethers.getSigners();

    infrastructure = await deployTestInfrastructure(deployer);

    // Deploy parent Safe (simple multisig)
    const parentDeployment = await deployParentMultisig(
      infrastructure,
      [parentOwner1.address, parentOwner2.address, parentOwner3.address],
      2, // 2-of-3 multisig
    );
    parentSafe = parentDeployment.safe;

    // Deploy child Safe with Azorius and freeze mechanisms
    const childDeployment = await deployChildAzoriusWithFreeze(
      infrastructure,
      [deployer.address], // Initial owner
      1, // Threshold
      [
        { address: childTokenHolder1.address, amount: ethers.parseEther('100') },
        { address: childTokenHolder2.address, amount: ethers.parseEther('100') },
        { address: childTokenHolder3.address, amount: ethers.parseEther('100') },
      ],
      parentDeployment.safeAddress,
    );
    childSafe = childDeployment.safe;
    childAzorius = childDeployment.azorius;
    childStrategy = childDeployment.strategy;
    childToken = childDeployment.token;
    freezeVoting = childDeployment.freezeVoting;
    freezeGuard = childDeployment.freezeGuard;
    const childProposerAdapter = childDeployment.proposerAdapter;

    // Delegate voting power
    await childToken.connect(childTokenHolder1).delegate(childTokenHolder1.address);
    await childToken.connect(childTokenHolder2).delegate(childTokenHolder2.address);
    await childToken.connect(childTokenHolder3).delegate(childTokenHolder3.address);

    return {
      parentSafe,
      childSafe,
      childAzorius,
      childStrategy,
      childToken,
      freezeVoting,
      freezeGuard,
      childProposerAdapter,
      infrastructure,
    };
  }

  describe('Deployment and Setup', () => {
    it('Should properly deploy parent multisig and child Azorius with freeze mechanisms', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Verify parent Safe configuration
      expect(await fixture.parentSafe.getThreshold()).to.equal(2);
      expect(await fixture.parentSafe.isOwner(parentOwner1.address)).to.be.true;
      expect(await fixture.parentSafe.isOwner(parentOwner2.address)).to.be.true;
      expect(await fixture.parentSafe.isOwner(parentOwner3.address)).to.be.true;

      // Verify child Safe has Azorius module
      expect(await fixture.childSafe.isModuleEnabled(await fixture.childAzorius.getAddress())).to.be
        .true;

      // Verify freeze voting configuration
      expect(await fixture.freezeVoting.parentSafe()).to.equal(
        await fixture.parentSafe.getAddress(),
      );
      expect(await fixture.freezeVoting.freezeVotesThreshold()).to.equal(FREEZE_VOTES_THRESHOLD);
      expect(await fixture.freezeVoting.freezeProposalPeriod()).to.equal(FREEZE_PROPOSAL_PERIOD);

      // Verify freeze guard is set on child Azorius
      expect(await fixture.childAzorius.getGuard()).to.equal(
        await fixture.freezeGuard.getAddress(),
      );

      // Verify freeze guard references freeze voting
      expect(await fixture.freezeGuard.freezable()).to.equal(
        await fixture.freezeVoting.getAddress(),
      );

      // Verify token allocations
      expect(await fixture.childToken.balanceOf(childTokenHolder1.address)).to.equal(
        ethers.parseEther('100'),
      );
      expect(await fixture.childToken.balanceOf(childTokenHolder2.address)).to.equal(
        ethers.parseEther('100'),
      );
      expect(await fixture.childToken.balanceOf(childTokenHolder3.address)).to.equal(
        ethers.parseEther('100'),
      );
    });
  });

  describe('Freeze Voting', () => {
    it('Should allow parent owners to vote to freeze child', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Initially not frozen
      expect(await fixture.freezeVoting.isFrozen()).to.be.false;

      // Parent owner 1 votes to freeze
      await fixture.freezeVoting.connect(parentOwner1).castFreezeVote(0);
      expect(await fixture.freezeVoting.isFrozen()).to.be.false; // Need 2 votes

      // Parent owner 2 votes to freeze - should trigger freeze
      await fixture.freezeVoting.connect(parentOwner2).castFreezeVote(0);
      expect(await fixture.freezeVoting.isFrozen()).to.be.true;

      // Check last freeze timestamp
      const freezeTimestamp = await fixture.freezeVoting.lastFreezeTime();
      expect(freezeTimestamp).to.be.gt(0);
    });
  });

  describe('Freeze Guard Effects', () => {
    it('Should block child Azorius proposal execution when frozen', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Create a proposal in child DAO
      const proposalTx = {
        to: alice.address,
        value: ethers.parseEther('0.1'),
        data: '0x',
        operation: 0,
      };

      await fixture.childAzorius.connect(childTokenHolder1).submitProposal(
        [
          {
            to: proposalTx.to,
            value: proposalTx.value,
            data: proposalTx.data,
            operation: proposalTx.operation,
          },
        ],
        'Test proposal', // metadata
        fixture.childProposerAdapter, // proposer adapter
        '0x', // proposer adapter data
      );

      const proposalId = 0;

      // Vote on proposal
      await fixture.childStrategy.connect(childTokenHolder1).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );
      await fixture.childStrategy.connect(childTokenHolder2).castVote(
        proposalId,
        1, // YES
        [{ configIndex: 0, voteData: '0x' }],
        0,
      );

      // Wait for voting period
      await fastForwardTime(CHILD_VOTING_PERIOD + 1);

      // Wait for timelock (no finalization needed - state transitions automatically)
      await fastForwardTime(CHILD_TIMELOCK_PERIOD + 1);

      // Now freeze the child
      await fixture.freezeVoting.connect(parentOwner1).castFreezeVote(0);
      await fixture.freezeVoting.connect(parentOwner2).castFreezeVote(0);

      // Try to execute - should fail because frozen
      await expect(
        fixture.childAzorius.executeProposal(proposalId, [
          {
            to: proposalTx.to,
            value: proposalTx.value,
            data: proposalTx.data,
            operation: proposalTx.operation,
          },
        ]),
      ).to.be.revertedWithCustomError(fixture.freezeGuard, 'DAOFrozen');
    });

    it('Should allow parent Safe to still operate when child is frozen', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Fund the parent Safe
      await deployer.sendTransaction({
        to: await fixture.parentSafe.getAddress(),
        value: ethers.parseEther('1'),
      });

      // Freeze the child
      await fixture.freezeVoting.connect(parentOwner1).castFreezeVote(0);
      await fixture.freezeVoting.connect(parentOwner2).castFreezeVote(0);

      // Parent Safe should still be able to execute transactions
      const tx = {
        to: alice.address,
        value: ethers.parseEther('0.1'),
        data: '0x',
        operation: 0,
        safeTxGas: 0,
        baseGas: 0,
        gasPrice: 0,
        gasToken: ethers.ZeroAddress,
        refundReceiver: ethers.ZeroAddress,
        nonce: await fixture.parentSafe.nonce(),
      };

      const hash = await fixture.parentSafe.getTransactionHash(
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

      const sig1 = await parentOwner1.signMessage(ethers.getBytes(hash));
      const sig2 = await parentOwner2.signMessage(ethers.getBytes(hash));
      const signatures = createSafeSignatures(
        [parentOwner1.address, parentOwner2.address],
        [Signature.from(sig1), Signature.from(sig2)],
      );

      // Should succeed
      await expect(
        fixture.parentSafe.execTransaction(
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
        ),
      ).to.emit(fixture.parentSafe, 'ExecutionSuccess');
    });
  });
});
