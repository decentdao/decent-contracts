import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { Signature } from 'ethers';
import hre from 'hardhat';
const { ethers } = hre;
import {
  Safe,
  Safe__factory,
  FreezeVotingAzoriusV1,
  FreezeVotingAzoriusV1__factory,
  FreezeGuardMultisigV1,
  FreezeGuardMultisigV1__factory,
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

describe('Freeze Azorius-Multisig - Using SystemDeployer', () => {
  let deployer: SignerWithAddress;
  let parentTokenHolder1: SignerWithAddress;
  let parentTokenHolder2: SignerWithAddress;
  let parentTokenHolder3: SignerWithAddress;
  let childOwner1: SignerWithAddress;
  let childOwner2: SignerWithAddress;
  let childOwner3: SignerWithAddress;

  let infrastructure: TestInfrastructure;
  let parentSafe: Safe;
  let parentAzorius: ModuleAzoriusV1;
  let parentStrategy: StrategyV1;
  let parentToken: VotesERC20V1;
  let childSafe: Safe;
  let freezeVoting: FreezeVotingAzoriusV1;
  let freezeGuard: FreezeGuardMultisigV1;

  const FREEZE_VOTES_THRESHOLD = ethers.parseEther('150'); // 50% of 300 tokens
  const FREEZE_PROPOSAL_PERIOD = 3600; // 1 hour (also acts as auto-unfreeze period for Azorius)
  const PARENT_VOTING_PERIOD = 7200; // 2 hours
  const PARENT_TIMELOCK_PERIOD = 1800; // 30 minutes
  const PARENT_EXECUTION_PERIOD = 86400; // 24 hours
  const CHILD_TIMELOCK_PERIOD = 1800; // 30 minutes
  const CHILD_EXECUTION_PERIOD = 86400; // 24 hours

  interface DeployedSafe {
    safe: Safe;
    safeAddress: string;
  }

  interface DeployedParentSafe extends DeployedSafe {
    azorius: ModuleAzoriusV1;
    strategy: StrategyV1;
    token: VotesERC20V1;
  }

  interface DeployedChildSafe extends DeployedSafe {
    freezeVoting: FreezeVotingAzoriusV1;
    freezeGuard: FreezeGuardMultisigV1;
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

  async function deployParentAzoriusSafe(
    infrastructure: TestInfrastructure,
    owners: string[],
    threshold: number,
    tokenHolders: { address: string; amount: bigint }[],
  ): Promise<DeployedParentSafe> {
    // Parent has Azorius governance
    const saltNonce = BigInt(ethers.keccak256(ethers.randomBytes(32)));
    const salt = ethers.solidityPackedKeccak256(['uint256'], [saltNonce]);

    // Deploy governance token
    const votesERC20Params: ISystemDeployerV1.VotesERC20V1ParamsStruct[] = [{
      implementation: infrastructure.implementations.votesERC20V1,
      metadata: {
        name: 'Parent Token',
        symbol: 'PARENT',
      },
      allocations: tokenHolders.map(h => ({
        to: h.address,
        amount: h.amount,
      })),
      locked: false,
      maxTotalSupply: 0, // No max supply
      safeSupply: 0, // No tokens allocated to Safe
    }];

    // Azorius governance parameters
    const azoriusGovernanceParams: ISystemDeployerV1.AzoriusGovernanceParamsStruct = {
      proposerAdapterParams: {
        proposerAdapterERC20V1Params: [{
          implementation: infrastructure.implementations.proposerAdapterERC20V1,
          token: ethers.ZeroAddress, // Will use newly deployed token
          newTokenIndex: 0,
          proposerThreshold: ethers.parseEther('10'), // 10 tokens to propose
        }],
        proposerAdapterERC721V1Params: [],
        proposerAdapterHatsV1Params: [],
      },
      strategyV1Params: {
        implementation: infrastructure.implementations.strategyV1,
        votingPeriod: PARENT_VOTING_PERIOD,
        quorumThreshold: ethers.parseEther('150'), // 50% of 300 tokens
        basisNumerator: 500000n, // 50%
        lightAccountFactory: ethers.ZeroAddress,
      },
      votingConfigParams: {
        votingConfigERC20V1Params: [{
          votingWeightImplementation: infrastructure.implementations.votingWeightERC20V1,
          voteTrackerImplementation: infrastructure.implementations.voteTrackerERC20V1,
          token: ethers.ZeroAddress, // Will use newly deployed token
          newTokenIndex: 0,
          weightPerToken: 1n, // 1:1 weight
        }],
        votingConfigERC721V1Params: [],
      },
      moduleAzoriusV1Params: {
        implementation: infrastructure.implementations.moduleAzoriusV1,
        timelockPeriod: PARENT_TIMELOCK_PERIOD,
        executionPeriod: PARENT_EXECUTION_PERIOD,
      },
    };

    // No fractal module
    const moduleFractalV1Params = createEmptyModuleFractalParams();

    // No freeze params for parent (it doesn't get frozen)
    const freezeParams = createEmptyFreezeParams();

    // Encode setupSafe function call
    const setupSafeData = infrastructure.systemDeployer.interface.encodeFunctionData('setupSafe', [
      salt,
      await infrastructure.safeProxyFactory.getAddress(),
      await infrastructure.systemDeployerEventEmitter.getAddress(),
      votesERC20Params,
      azoriusGovernanceParams,
      moduleFractalV1Params,
      freezeParams,
    ]);

    // Create Safe setup parameters
    const safeSetupData = infrastructure.safeSingleton.interface.encodeFunctionData('setup', [
      owners,
      threshold,
      await infrastructure.systemDeployer.getAddress(),
      setupSafeData,
      ethers.ZeroAddress, // fallbackHandler
      ethers.ZeroAddress, // paymentToken
      0, // payment
      ethers.ZeroAddress, // paymentReceiver
    ]);

    // Deploy the parent Safe with Azorius
    const tx = await infrastructure.safeProxyFactory.createProxyWithNonce(
      await infrastructure.safeSingleton.getAddress(),
      safeSetupData,
      saltNonce,
    );

    const receipt = await tx.wait();
    
    // Extract Safe address
    const safeEvent = findEvent(receipt!.logs, infrastructure.safeProxyFactory.interface, 'ProxyCreation');
    if (!safeEvent) throw new Error('ProxyCreation event not found');
    const safeAddress = safeEvent.args[0];
    const safe = Safe__factory.connect(safeAddress, deployer);

    // Parse all ProxyDeployed events
    const proxyDeployedEvents = receipt!.logs.filter((log: any) => {
      try {
        const parsed = infrastructure.systemDeployer.interface.parseLog({
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
      const parsed = infrastructure.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infrastructure.implementations.votesERC20V1;
    });
    if (!tokenEvent) throw new Error('Token deployment event not found');
    const tokenParsed = infrastructure.systemDeployer.interface.parseLog({
      topics: tokenEvent.topics as string[],
      data: tokenEvent.data,
    });
    const tokenAddress = tokenParsed?.args?.[0];
    const token = VotesERC20V1__factory.connect(tokenAddress, deployer);

    // Extract Azorius address
    const azoriusEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infrastructure.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infrastructure.implementations.moduleAzoriusV1;
    });
    if (!azoriusEvent) throw new Error('Azorius deployment event not found');
    const azoriusParsed = infrastructure.systemDeployer.interface.parseLog({
      topics: azoriusEvent.topics as string[],
      data: azoriusEvent.data,
    });
    const azoriusAddress = azoriusParsed?.args?.[0];
    const azorius = ModuleAzoriusV1__factory.connect(azoriusAddress, deployer);

    // Extract Strategy address
    const strategyEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infrastructure.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infrastructure.implementations.strategyV1;
    });
    if (!strategyEvent) throw new Error('Strategy deployment event not found');
    const strategyParsed = infrastructure.systemDeployer.interface.parseLog({
      topics: strategyEvent.topics as string[],
      data: strategyEvent.data,
    });
    const strategyAddress = strategyParsed?.args?.[0];
    const strategy = StrategyV1__factory.connect(strategyAddress, deployer);

    return { safe, safeAddress, azorius, strategy, token };
  }

  async function deployChildMultisigWithFreeze(
    infrastructure: TestInfrastructure,
    owners: string[],
    threshold: number,
    parentAzoriusAddress: string,
  ): Promise<DeployedChildSafe> {
    // Child is a multisig with freeze voting and freeze guard
    const saltNonce = BigInt(ethers.keccak256(ethers.randomBytes(32)));
    const salt = ethers.solidityPackedKeccak256(['uint256'], [saltNonce]);

    // No tokens for multisig
    const votesERC20Params: ISystemDeployerV1.VotesERC20V1ParamsStruct[] = [];

    // No Azorius governance for child
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

    // Freeze params for child - has both freeze voting and freeze guard
    const freezeParams: ISystemDeployerV1.FreezeParamsStruct = {
      freezeGuardParams: {
        freezeGuardMultisigV1Params: {
          implementation: infrastructure.implementations.freezeGuardMultisigV1,
          owner: owners[0], // Use first owner as the guard owner
          timelockPeriod: CHILD_TIMELOCK_PERIOD,
          executionPeriod: CHILD_EXECUTION_PERIOD,
        },
        freezeGuardAzoriusV1Params: {
          implementation: ethers.ZeroAddress,
          owner: ethers.ZeroAddress,
        },
      },
      freezeVotingParams: {
        freezeVotingMultisigV1Params: {
          implementation: ethers.ZeroAddress,
          owner: ethers.ZeroAddress,
          freezeVotesThreshold: 0,
          freezeProposalPeriod: 0,
          parentSafe: ethers.ZeroAddress,
          lightAccountFactory: ethers.ZeroAddress,
        },
        freezeVotingAzoriusV1Params: {
          implementation: infrastructure.implementations.freezeVotingAzoriusV1,
          owner: owners[0], // Use first owner as the voting owner
          freezeVotesThreshold: FREEZE_VOTES_THRESHOLD,
          freezeProposalPeriod: FREEZE_PROPOSAL_PERIOD,
          parentAzorius: parentAzoriusAddress, // Reference to parent Azorius
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
    const setupSafeData = infrastructure.systemDeployer.interface.encodeFunctionData('setupSafe', [
      salt,
      await infrastructure.safeProxyFactory.getAddress(),
      await infrastructure.systemDeployerEventEmitter.getAddress(),
      votesERC20Params,
      azoriusGovernanceParams,
      moduleFractalV1Params,
      freezeParams,
    ]);

    // Create Safe setup parameters
    const safeSetupData = infrastructure.safeSingleton.interface.encodeFunctionData('setup', [
      owners,
      threshold,
      await infrastructure.systemDeployer.getAddress(),
      setupSafeData,
      ethers.ZeroAddress, // fallbackHandler
      ethers.ZeroAddress, // paymentToken
      0, // payment
      ethers.ZeroAddress, // paymentReceiver
    ]);

    // Deploy the child Safe with freeze mechanisms
    const tx = await infrastructure.safeProxyFactory.createProxyWithNonce(
      await infrastructure.safeSingleton.getAddress(),
      safeSetupData,
      saltNonce,
    );

    const receipt = await tx.wait();
    
    // Extract Safe address
    const safeEvent = findEvent(receipt!.logs, infrastructure.safeProxyFactory.interface, 'ProxyCreation');
    if (!safeEvent) throw new Error('ProxyCreation event not found');
    const safeAddress = safeEvent.args[0];
    const safe = Safe__factory.connect(safeAddress, deployer);

    // Parse all ProxyDeployed events
    const proxyDeployedEvents = receipt!.logs.filter((log: any) => {
      try {
        const parsed = infrastructure.systemDeployer.interface.parseLog({
          topics: log.topics,
          data: log.data,
        });
        return parsed?.name === 'ProxyDeployed';
      } catch {
        return false;
      }
    });
    
    // Extract FreezeVoting address
    const freezeVotingEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infrastructure.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infrastructure.implementations.freezeVotingAzoriusV1;
    });

    if (!freezeVotingEvent) throw new Error('FreezeVotingAzorius deployment event not found');
    const freezeVotingParsed = infrastructure.systemDeployer.interface.parseLog({
      topics: freezeVotingEvent.topics as string[],
      data: freezeVotingEvent.data,
    });
    const freezeVotingAddress = freezeVotingParsed?.args?.[0];
    const freezeVoting = FreezeVotingAzoriusV1__factory.connect(freezeVotingAddress, deployer);

    // Extract FreezeGuard address
    const freezeGuardEvent = proxyDeployedEvents.find((log: any) => {
      const parsed = infrastructure.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.args[1] === infrastructure.implementations.freezeGuardMultisigV1;
    });

    if (!freezeGuardEvent) throw new Error('FreezeGuard deployment event not found');
    const freezeGuardParsed = infrastructure.systemDeployer.interface.parseLog({
      topics: freezeGuardEvent.topics as string[],
      data: freezeGuardEvent.data,
    });
    const freezeGuardAddress = freezeGuardParsed?.args?.[0];
    const freezeGuard = FreezeGuardMultisigV1__factory.connect(freezeGuardAddress, deployer);

    return { safe, safeAddress, freezeVoting, freezeGuard };
  }

  async function setupTestFixture() {
    [deployer, parentTokenHolder1, parentTokenHolder2, parentTokenHolder3, childOwner1, childOwner2, childOwner3] =
      await ethers.getSigners();

    infrastructure = await deployTestInfrastructure(deployer);
    
    // Log infrastructure to debug
    console.log('Infrastructure implementations:', {
      freezeVotingAzoriusV1: infrastructure.implementations.freezeVotingAzoriusV1,
      voteTrackerERC20V1: infrastructure.implementations.voteTrackerERC20V1,
      votingWeightERC20V1: infrastructure.implementations.votingWeightERC20V1,
    });

    try {
      // Deploy parent Safe with Azorius governance
      console.log('Deploying parent Safe...');
      const parentDeployment = await deployParentAzoriusSafe(
        infrastructure,
        [deployer.address], // Initial owner
        1, // Threshold
        [
          { address: parentTokenHolder1.address, amount: ethers.parseEther('100') },
          { address: parentTokenHolder2.address, amount: ethers.parseEther('100') },
          { address: parentTokenHolder3.address, amount: ethers.parseEther('100') },
        ],
      );
      parentSafe = parentDeployment.safe;
      parentAzorius = parentDeployment.azorius;
      parentStrategy = parentDeployment.strategy;
      parentToken = parentDeployment.token;

      console.log('Parent Safe deployed successfully');
      
      // Deploy child Safe with freeze mechanisms
      console.log('Deploying child Safe...');
      const childDeployment = await deployChildMultisigWithFreeze(
        infrastructure,
        [childOwner1.address, childOwner2.address, childOwner3.address],
        2, // 2-of-3 multisig
        await parentAzorius.getAddress(),
      );
      childSafe = childDeployment.safe;
      freezeVoting = childDeployment.freezeVoting;
      freezeGuard = childDeployment.freezeGuard;
      
      console.log('Child Safe deployed successfully');
    } catch (error) {
      console.error('Deployment error:', error);
      throw error;
    }

    // Delegate voting power
    await parentToken.connect(parentTokenHolder1).delegate(parentTokenHolder1.address);
    await parentToken.connect(parentTokenHolder2).delegate(parentTokenHolder2.address);
    await parentToken.connect(parentTokenHolder3).delegate(parentTokenHolder3.address);

    return {
      parentSafe,
      parentAzorius,
      parentStrategy,
      parentToken,
      childSafe,
      freezeVoting,
      freezeGuard,
      infrastructure,
    };
  }

  describe('Deployment and Setup', () => {
    it('Should properly deploy parent Azorius and child multisig with freeze mechanisms', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Verify parent Safe has Azorius module
      expect(await fixture.parentSafe.isModuleEnabled(await fixture.parentAzorius.getAddress())).to.be.true;

      // Verify child Safe configuration
      expect(await fixture.childSafe.getThreshold()).to.equal(2);
      expect(await fixture.childSafe.isOwner(childOwner1.address)).to.be.true;
      expect(await fixture.childSafe.isOwner(childOwner2.address)).to.be.true;
      expect(await fixture.childSafe.isOwner(childOwner3.address)).to.be.true;

      // Verify freeze voting configuration
      expect(await fixture.freezeVoting.parentAzorius()).to.equal(await fixture.parentAzorius.getAddress());
      expect(await fixture.freezeVoting.freezeVotesThreshold()).to.equal(FREEZE_VOTES_THRESHOLD);
      expect(await fixture.freezeVoting.freezeProposalPeriod()).to.equal(FREEZE_PROPOSAL_PERIOD);
      // Note: FreezeVotingAzoriusV1 doesn't have a freezePeriod function - it auto-unfreezes after freezeProposalPeriod

      // Verify freeze guard is set on child Safe
      const guardAddress = ethers.AbiCoder.defaultAbiCoder().decode(
        ['address'],
        await ethers.provider.getStorage(
          await fixture.childSafe.getAddress(),
          ethers.keccak256(ethers.toUtf8Bytes('guard_manager.guard.address')),
        ),
      )[0];
      expect(guardAddress).to.equal(await fixture.freezeGuard.getAddress());

      // Verify freeze guard references freeze voting
      expect(await fixture.freezeGuard.freezable()).to.equal(await fixture.freezeVoting.getAddress());

      // Verify token allocations
      expect(await fixture.parentToken.balanceOf(parentTokenHolder1.address)).to.equal(ethers.parseEther('100'));
      expect(await fixture.parentToken.balanceOf(parentTokenHolder2.address)).to.equal(ethers.parseEther('100'));
      expect(await fixture.parentToken.balanceOf(parentTokenHolder3.address)).to.equal(ethers.parseEther('100'));
    });
  });

  describe('Freeze Voting', () => {
    it('Should allow parent token holders to vote to freeze child', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Initially not frozen
      expect(await fixture.freezeVoting.isFrozen()).to.be.false;

      // Parent token holder 1 votes to freeze (100 tokens)
      const votingConfigData = [{
        configIndex: 0, // First voting config (ERC20)
        voteData: '0x', // Empty for ERC20 voting
      }];
      await fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(votingConfigData, 0);
      expect(await fixture.freezeVoting.isFrozen()).to.be.false; // Need 150 tokens

      // Parent token holder 2 votes to freeze (100 more tokens = 200 total) - should trigger freeze
      await fixture.freezeVoting.connect(parentTokenHolder2).castFreezeVote(votingConfigData, 0);
      expect(await fixture.freezeVoting.isFrozen()).to.be.true;
    });

    it('Should auto-unfreeze after freeze period', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Freeze the child
      const votingConfigData = [{
        configIndex: 0, // First voting config (ERC20)
        voteData: '0x', // Empty for ERC20 voting
      }];
      await fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(votingConfigData, 0);
      await fixture.freezeVoting.connect(parentTokenHolder2).castFreezeVote(votingConfigData, 0);
      expect(await fixture.freezeVoting.isFrozen()).to.be.true;

      // Wait for auto-unfreeze (FreezeVotingAzoriusV1 unfreezes after freezeProposalPeriod)
      await fastForwardTime(FREEZE_PROPOSAL_PERIOD + 1);

      // Should be automatically unfrozen
      expect(await fixture.freezeVoting.isFrozen()).to.be.false;
    });
  });

  describe('Freeze Guard Effects', () => {
    it('Should block child Safe transactions when frozen', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Freeze the child
      const votingConfigData = [{
        configIndex: 0, // First voting config (ERC20)
        voteData: '0x', // Empty for ERC20 voting
      }];
      await fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(votingConfigData, 0);
      await fixture.freezeVoting.connect(parentTokenHolder2).castFreezeVote(votingConfigData, 0);

      // Try to execute a transaction on child Safe
      const tx = {
        to: deployer.address,
        value: ethers.parseEther('0.1'),
        data: '0x',
        operation: 0,
        safeTxGas: 0,
        baseGas: 0,
        gasPrice: 0,
        gasToken: ethers.ZeroAddress,
        refundReceiver: ethers.ZeroAddress,
        nonce: await fixture.childSafe.nonce(),
      };

      const hash = await fixture.childSafe.getTransactionHash(
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

      // Get signatures for the transaction
      const sig1 = await childOwner1.signMessage(ethers.getBytes(hash));
      const sig2 = await childOwner2.signMessage(ethers.getBytes(hash));
      const signatures = createSafeSignatures(
        [childOwner1.address, childOwner2.address],
        [Signature.from(sig1), Signature.from(sig2)],
      );

      // Try to timelock the transaction while frozen - should fail
      await expect(
        fixture.freezeGuard.timelockTransaction(
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
          tx.nonce,
        ),
      ).to.be.revertedWithCustomError(fixture.freezeGuard, 'DAOFrozen');
    });

    it('Should allow parent DAO to manually unfreeze', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Freeze the child
      const votingConfigData = [{
        configIndex: 0, // First voting config (ERC20)
        voteData: '0x', // Empty for ERC20 voting
      }];
      await fixture.freezeVoting.connect(parentTokenHolder1).castFreezeVote(votingConfigData, 0);
      await fixture.freezeVoting.connect(parentTokenHolder2).castFreezeVote(votingConfigData, 0);
      expect(await fixture.freezeVoting.isFrozen()).to.be.true;

      // Create unfreeze proposal in parent DAO
      const unfreezeData = fixture.freezeVoting.interface.encodeFunctionData('unfreeze');
      await fixture.parentAzorius
        .connect(parentTokenHolder1)
        .submitProposal(
          await fixture.freezeVoting.getAddress(),
          0,
          unfreezeData,
          '0x',
          0,
          await fixture.parentStrategy.getAddress(),
        );

      const proposalId = 0;

      // Vote on proposal
      await fixture.parentStrategy.connect(parentTokenHolder1).vote(proposalId, 1); // YES
      await fixture.parentStrategy.connect(parentTokenHolder2).vote(proposalId, 1); // YES

      // Wait for voting period
      await fastForwardTime(PARENT_VOTING_PERIOD + 1);

      // Finalize proposal
      await fixture.parentStrategy.finalizeProposal(proposalId);

      // Wait for timelock
      await fastForwardTime(PARENT_TIMELOCK_PERIOD + 1);

      // Execute unfreeze
      await fixture.parentAzorius.executeProposal(
        proposalId,
        [await fixture.freezeVoting.getAddress()],
        [0],
        [unfreezeData],
        [0],
      );

      expect(await fixture.freezeVoting.isFrozen()).to.be.false;
    });
  });
});