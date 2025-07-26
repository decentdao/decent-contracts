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
  FreezeGuardMultisigV1,
  FreezeGuardMultisigV1__factory,
  ISystemDeployerV1,
} from '../../../typechain-types';
import {
  TestInfrastructure,
  deployTestInfrastructure,
  createEmptyModuleFractalParams,
  findEvent,
} from '../shared/helpers';

describe('Freeze Multisig-Multisig - Using SystemDeployer', () => {
  let deployer: SignerWithAddress;
  let parentOwner1: SignerWithAddress;
  let parentOwner2: SignerWithAddress;
  let parentOwner3: SignerWithAddress;
  let childOwner1: SignerWithAddress;
  let childOwner2: SignerWithAddress;
  let childOwner3: SignerWithAddress;

  let infrastructure: TestInfrastructure;
  let parentSafe: Safe;
  let childSafe: Safe;
  let freezeVoting: FreezeVotingMultisigV1;
  let freezeGuard: FreezeGuardMultisigV1;

  const FREEZE_VOTES_THRESHOLD = 2; // 2 out of 3 parent owners must vote to freeze
  const FREEZE_PROPOSAL_PERIOD = 3600; // 1 hour
  const TIMELOCK_PERIOD = 1800; // 30 minutes
  const EXECUTION_PERIOD = 86400; // 24 hours

  interface DeployedSafe {
    safe: Safe;
    safeAddress: string;
  }

  interface DeployedChildSafe extends DeployedSafe {
    freezeVoting: FreezeVotingMultisigV1;
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
    const freezeParams: ISystemDeployerV1.FreezeParamsStruct = {
      freezeGuardParams: {
        freezeGuardMultisigV1Params: {
          implementation: ethers.ZeroAddress,
          owner: ethers.ZeroAddress,
          timelockPeriod: 0,
          executionPeriod: 0,
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

  async function deployChildMultisigWithFreeze(
    infra: TestInfrastructure,
    owners: string[],
    threshold: number,
    parentSafeAddress: string,
  ): Promise<DeployedChildSafe> {
    // Child is a multisig with freeze voting and freeze guard
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

    // Freeze params for child - has both freeze voting and freeze guard
    const freezeParams: ISystemDeployerV1.FreezeParamsStruct = {
      freezeGuardParams: {
        freezeGuardMultisigV1Params: {
          implementation: infra.implementations.freezeGuardMultisigV1,
          owner: owners[0], // Use first owner as the guard owner
          timelockPeriod: TIMELOCK_PERIOD,
          executionPeriod: EXECUTION_PERIOD,
        },
        freezeGuardAzoriusV1Params: {
          implementation: ethers.ZeroAddress,
          owner: ethers.ZeroAddress,
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

    // Deploy the child Safe with freeze mechanisms
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
      return parsed?.args[1] === infra.implementations.freezeGuardMultisigV1;
    });

    if (!freezeGuardEvent) throw new Error('FreezeGuard deployment event not found');
    const freezeGuardParsed = infra.systemDeployer.interface.parseLog({
      topics: freezeGuardEvent.topics as string[],
      data: freezeGuardEvent.data,
    });
    const freezeGuardAddress = freezeGuardParsed?.args?.[0];
    freezeGuard = FreezeGuardMultisigV1__factory.connect(freezeGuardAddress, deployer);

    return { safe, safeAddress, freezeVoting, freezeGuard };
  }

  async function setupTestFixture() {
    [deployer, parentOwner1, parentOwner2, parentOwner3, childOwner1, childOwner2, childOwner3] =
      await ethers.getSigners();

    infrastructure = await deployTestInfrastructure(deployer);

    // Deploy parent Safe (simple multisig)
    const parentDeployment = await deployParentMultisig(
      infrastructure,
      [parentOwner1.address, parentOwner2.address, parentOwner3.address],
      2, // 2-of-3 multisig
    );
    parentSafe = parentDeployment.safe;

    // Deploy child Safe with freeze mechanisms
    const childDeployment = await deployChildMultisigWithFreeze(
      infrastructure,
      [childOwner1.address, childOwner2.address, childOwner3.address],
      2, // 2-of-3 multisig
      parentDeployment.safeAddress,
    );
    childSafe = childDeployment.safe;
    freezeVoting = childDeployment.freezeVoting;
    freezeGuard = childDeployment.freezeGuard;

    return {
      parentSafe,
      childSafe,
      freezeVoting,
      freezeGuard,
      infrastructure,
    };
  }

  describe('Deployment and Setup', () => {
    it('Should properly deploy parent and child Safes with freeze mechanisms', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Verify parent Safe configuration
      expect(await fixture.parentSafe.getThreshold()).to.equal(2);
      expect(await fixture.parentSafe.isOwner(parentOwner1.address)).to.be.true;
      expect(await fixture.parentSafe.isOwner(parentOwner2.address)).to.be.true;
      expect(await fixture.parentSafe.isOwner(parentOwner3.address)).to.be.true;

      // Verify child Safe configuration
      expect(await fixture.childSafe.getThreshold()).to.equal(2);
      expect(await fixture.childSafe.isOwner(childOwner1.address)).to.be.true;
      expect(await fixture.childSafe.isOwner(childOwner2.address)).to.be.true;
      expect(await fixture.childSafe.isOwner(childOwner3.address)).to.be.true;

      // Verify freeze voting configuration
      expect(await fixture.freezeVoting.parentSafe()).to.equal(
        await fixture.parentSafe.getAddress(),
      );
      expect(await fixture.freezeVoting.freezeVotesThreshold()).to.equal(FREEZE_VOTES_THRESHOLD);
      expect(await fixture.freezeVoting.freezeProposalPeriod()).to.equal(FREEZE_PROPOSAL_PERIOD);

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
      expect(await fixture.freezeGuard.freezable()).to.equal(
        await fixture.freezeVoting.getAddress(),
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

    it('Should prevent double voting on same freeze proposal', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Parent owner 1 votes
      await fixture.freezeVoting.connect(parentOwner1).castFreezeVote(0);

      // Try to vote again
      await expect(
        fixture.freezeVoting.connect(parentOwner1).castFreezeVote(0),
      ).to.be.revertedWithCustomError(fixture.freezeVoting, 'AlreadyVoted');
    });
  });

  describe('Freeze Guard Effects', () => {
    it('Should block child Safe transactions when frozen', async () => {
      const fixture = await loadFixture(setupTestFixture);

      // Freeze the child first
      await fixture.freezeVoting.connect(parentOwner1).castFreezeVote(0);
      await fixture.freezeVoting.connect(parentOwner2).castFreezeVote(0);

      // Now try to execute a transaction while frozen
      // Prepare a transaction
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
        to: deployer.address,
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
