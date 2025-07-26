import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { Signature } from 'ethers';
import { ethers } from 'hardhat';
import {
  ISystemDeployerV1,
  Safe,
  Safe__factory,
  MockERC20__factory as MockERC20Factory,
} from '../../../typechain-types';
import {
  TestInfrastructure,
  BaseSigners,
  deployTestInfrastructure,
  getTestSigners,
  createEmptyModuleFractalParams,
  createEmptyFreezeParams,
  findEvent,
  createTestTransaction,
  fundSafe,
  createSafeSignatures,
} from '../shared/helpers';

// Basic multisig governance (no voting modules, just Safe owners)
interface DeployedMultisigDAO {
  safeAddress: string;
  safe: Safe;
}

describe('Basic Multisig Governance Integration Tests', () => {
  let signers: BaseSigners;


  async function deployMultisigDAO(params: {
    infrastructure: TestInfrastructure;
    signers: BaseSigners;
    owners: string[];
    threshold: number;
  }): Promise<DeployedMultisigDAO> {
    const { infrastructure } = params;

    // Create deployment parameters
    const salt = ethers.keccak256(ethers.randomBytes(32));

    // Empty params for all governance features - just a basic Safe
    const votesERC20Params: ISystemDeployerV1.VotesERC20V1ParamsStruct[] = [];
    const azoriusGovernanceParams: ISystemDeployerV1.AzoriusGovernanceParamsStruct = {
      proposerAdapterParams: {
        proposerAdapterERC20V1Params: [],
        proposerAdapterERC721V1Params: [],
        proposerAdapterHatsV1Params: [],
      },
      strategyV1Params: {
        implementation: ethers.ZeroAddress,
        votingPeriod: 0,
        quorumThreshold: 0n,
        basisNumerator: 0n,
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
    const moduleFractalV1Params = createEmptyModuleFractalParams();
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
      params.owners,
      params.threshold,
      await infrastructure.systemDeployer.getAddress(),
      setupSafeData,
      ethers.ZeroAddress, // fallbackHandler
      ethers.ZeroAddress, // paymentToken
      0, // payment
      ethers.ZeroAddress, // paymentReceiver
    ]);

    // Deploy the Safe
    const tx = await infrastructure.safeProxyFactory.createProxyWithNonce(
      await infrastructure.safeSingleton.getAddress(),
      safeSetupData,
      ethers.toBigInt(salt),
    );

    const receipt = await tx.wait();
    if (!receipt) throw new Error('Transaction receipt is null');

    // Extract Safe address from ProxyCreation event
    const proxyCreationEvent = findEvent(
      receipt.logs,
      infrastructure.safeProxyFactory.interface,
      'ProxyCreation',
    );
    if (!proxyCreationEvent) throw new Error('ProxyCreation event not found');
    const safeAddress = proxyCreationEvent.args[0];

    // Connect to deployed Safe
    const safe = Safe__factory.connect(safeAddress, params.signers.deployer);

    return {
      safeAddress,
      safe,
    };
  }

  async function setupTestFixture() {
    signers = await getTestSigners();
    const infrastructure = await deployTestInfrastructure(signers.deployer);

    const dao = await deployMultisigDAO({
      infrastructure,
      signers,
      owners: [signers.alice.address, signers.bob.address, signers.charlie.address],
      threshold: 2, // 2 of 3 multisig
    });

    return { infrastructure, dao };
  }

  describe('DAO Deployment', () => {
    it('Should deploy a basic multisig DAO', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      expect(dao.safeAddress).to.not.equal(ethers.ZeroAddress);
      expect(await ethers.provider.getCode(dao.safeAddress)).to.not.equal('0x');
    });

    it('Should correctly configure Safe owners and threshold', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const owners = await dao.safe.getOwners();
      expect(owners).to.include.members([
        signers.alice.address,
        signers.bob.address,
        signers.charlie.address,
      ]);
      expect(owners.length).to.equal(3);

      expect(await dao.safe.getThreshold()).to.equal(2);
    });

    it('Should not have any modules enabled', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Get modules (should be empty for basic multisig)
      const modules = await dao.safe.getModulesPaginated(
        '0x0000000000000000000000000000000000000001',
        10,
      );
      expect(modules[0]).to.deep.equal([]); // Empty modules array
    });
  });

  describe('Transaction Execution', () => {
    it('Should execute transactions directly with owner signatures', async () => {
      const { dao } = await loadFixture(setupTestFixture);
      await fundSafe(signers.deployer, dao.safeAddress);

      const recipientBalanceBefore = await ethers.provider.getBalance(signers.alice.address);

      // Create transaction data
      const tx = {
        to: signers.alice.address,
        value: ethers.parseEther('1'),
        data: '0x',
        operation: 0, // CALL
        safeTxGas: 0,
        baseGas: 0,
        gasPrice: 0,
        gasToken: ethers.ZeroAddress,
        refundReceiver: ethers.ZeroAddress,
        nonce: await dao.safe.nonce(),
      };

      // Get transaction hash
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

      // Alice signs
      const aliceSig = await signers.alice.signMessage(ethers.getBytes(txHash));
      const aliceSignature = Signature.from(aliceSig);

      // Bob signs
      const bobSig = await signers.bob.signMessage(ethers.getBytes(txHash));
      const bobSignature = Signature.from(bobSig);

      // Create sorted signatures
      const signatures = createSafeSignatures(
        [signers.alice.address, signers.bob.address],
        [aliceSignature, bobSignature],
      );

      // Execute transaction
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

      const recipientBalanceAfter = await ethers.provider.getBalance(signers.alice.address);
      expect(recipientBalanceAfter).to.equal(recipientBalanceBefore + ethers.parseEther('1'));
    });

    it('Should reject transactions with insufficient signatures', async () => {
      const { dao } = await loadFixture(setupTestFixture);
      await fundSafe(signers.deployer, dao.safeAddress);

      // Create transaction
      const tx = {
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

      // Only Alice signs (need 2 signatures)
      const aliceSig = await signers.alice.signMessage(ethers.getBytes(txHash));
      const aliceSignature = Signature.from(aliceSig);

      const signatures = createSafeSignatures([signers.alice.address], [aliceSignature]);

      // Should fail with only 1 signature
      await expect(
        dao.safe.execTransaction(
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
      ).to.be.reverted;
    });

    it('Should handle multi-transaction batches', async () => {
      const { dao } = await loadFixture(setupTestFixture);
      await fundSafe(signers.deployer, dao.safeAddress, ethers.parseEther('10'));

      // Use MultiSend to batch transactions
      const transactions = [
        createTestTransaction(signers.alice.address, ethers.parseEther('1')),
        createTestTransaction(signers.bob.address, ethers.parseEther('2')),
        createTestTransaction(signers.charlie.address, ethers.parseEther('3')),
      ];

      // Note: In a real implementation, you'd deploy and use the MultiSend contract
      // For this test, we'll just execute individual transactions

      const aliceBalanceBefore = await ethers.provider.getBalance(signers.alice.address);
      const bobBalanceBefore = await ethers.provider.getBalance(signers.bob.address);
      const charlieBalanceBefore = await ethers.provider.getBalance(signers.charlie.address);

      // Execute each transaction separately
      for (let i = 0; i < transactions.length; i++) {
        const tx = {
          to: transactions[i].to,
          value: transactions[i].value,
          data: transactions[i].data,
          operation: transactions[i].operation,
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

        // Get signatures from Alice and Bob
        const aliceSig = await signers.alice.signMessage(ethers.getBytes(txHash));
        const aliceSignature = Signature.from(aliceSig);
        const bobSig = await signers.bob.signMessage(ethers.getBytes(txHash));
        const bobSignature = Signature.from(bobSig);

        const signatures = createSafeSignatures(
          [signers.alice.address, signers.bob.address],
          [aliceSignature, bobSignature],
        );

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
      }

      // Check balances
      expect(await ethers.provider.getBalance(signers.alice.address)).to.equal(
        aliceBalanceBefore + ethers.parseEther('1'),
      );
      expect(await ethers.provider.getBalance(signers.bob.address)).to.equal(
        bobBalanceBefore + ethers.parseEther('2'),
      );
      expect(await ethers.provider.getBalance(signers.charlie.address)).to.equal(
        charlieBalanceBefore + ethers.parseEther('3'),
      );
    });
  });

  describe('Owner Management', () => {
    it('Should add new owners with threshold signatures', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Create add owner transaction
      const addOwnerData = dao.safe.interface.encodeFunctionData('addOwnerWithThreshold', [
        signers.deployer.address,
        2, // Keep threshold at 2
      ]);

      const tx = {
        to: dao.safeAddress,
        value: 0n,
        data: addOwnerData,
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

      // Execute add owner
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

      // Check owners (Safe returns in reverse order)
      const owners = await dao.safe.getOwners();
      expect(owners).to.include(signers.deployer.address);
      expect(owners.length).to.equal(4);
    });

    it('Should remove owners with threshold signatures', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Get current owner order
      const ownersBefore = await dao.safe.getOwners();
      const charlieIndex = ownersBefore.indexOf(signers.charlie.address);
      // In Safe's linked list, if charlie is at index 0, prev is SENTINEL (0x1)
      // Otherwise, it's the owner at index - 1
      const SENTINEL_OWNERS = '0x0000000000000000000000000000000000000001';
      const prevOwner = charlieIndex === 0 ? SENTINEL_OWNERS : ownersBefore[charlieIndex - 1];

      // Create remove owner transaction
      const removeOwnerData = dao.safe.interface.encodeFunctionData('removeOwner', [
        prevOwner,
        signers.charlie.address,
        2, // Keep threshold at 2
      ]);

      const tx = {
        to: dao.safeAddress,
        value: 0n,
        data: removeOwnerData,
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

      // Alice and Bob sign to remove Charlie
      const aliceSig = await signers.alice.signMessage(ethers.getBytes(txHash));
      const aliceSignature = Signature.from(aliceSig);
      const bobSig = await signers.bob.signMessage(ethers.getBytes(txHash));
      const bobSignature = Signature.from(bobSig);

      const signatures = createSafeSignatures(
        [signers.alice.address, signers.bob.address],
        [aliceSignature, bobSignature],
      );

      // Execute remove owner
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

      // Check owners
      const ownersAfter = await dao.safe.getOwners();
      expect(ownersAfter).to.not.include(signers.charlie.address);
      expect(ownersAfter.length).to.equal(2);
    });

    it('Should change threshold with owner signatures', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Change threshold to 3 (requires all owners)
      const changeThresholdData = dao.safe.interface.encodeFunctionData('changeThreshold', [3]);

      const tx = {
        to: dao.safeAddress,
        value: 0n,
        data: changeThresholdData,
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

      // Need 2 signatures with current threshold
      const aliceSig = await signers.alice.signMessage(ethers.getBytes(txHash));
      const aliceSignature = Signature.from(aliceSig);
      const bobSig = await signers.bob.signMessage(ethers.getBytes(txHash));
      const bobSignature = Signature.from(bobSig);

      const signatures = createSafeSignatures(
        [signers.alice.address, signers.bob.address],
        [aliceSignature, bobSignature],
      );

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

      expect(await dao.safe.getThreshold()).to.equal(3);
    });
  });

  describe('Edge Cases', () => {
    it('Should handle delegatecall operations', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Deploy a simple test contract that can be delegatecalled
      const testContract = await new MockERC20Factory(signers.deployer).deploy('Test', 'TEST', 18);

      // Create delegatecall transaction - delegatecall will fail but we set safeTxGas to allow it
      const tx = {
        to: await testContract.getAddress(),
        value: 0n,
        data: testContract.interface.encodeFunctionData('totalSupply'), // Read-only function
        operation: 1, // DELEGATECALL
        safeTxGas: 50000, // Set gas to allow failed delegatecall
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

      // Execute delegatecall - transaction succeeds even if internal call fails
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

      // Verify transaction was processed (nonce incremented)
      expect(await dao.safe.nonce()).to.equal(1);
    });

    it('Should reject signatures from non-owners', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      const tx = {
        to: signers.alice.address,
        value: 0n,
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

      // Alice signs
      const aliceSig = await signers.alice.signMessage(ethers.getBytes(txHash));
      const aliceSignature = Signature.from(aliceSig);

      // Deployer (non-owner) signs
      const deployerSig = await signers.deployer.signMessage(ethers.getBytes(txHash));
      const deployerSignature = Signature.from(deployerSig);

      // Create sorted signatures
      const signatures = createSafeSignatures(
        [signers.alice.address, signers.deployer.address],
        [aliceSignature, deployerSignature],
      );

      // Should fail because deployer is not an owner
      await expect(
        dao.safe.execTransaction(
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
      ).to.be.reverted;
    });

    it('Should handle 1 of 1 multisig', async () => {
      const { infrastructure } = await loadFixture(setupTestFixture);

      // Deploy 1 of 1 multisig
      const soloDao = await deployMultisigDAO({
        infrastructure,
        signers,
        owners: [signers.alice.address],
        threshold: 1,
      });

      await fundSafe(signers.deployer, soloDao.safeAddress);

      // Single signature execution
      const tx = {
        to: signers.bob.address,
        value: ethers.parseEther('1'),
        data: '0x',
        operation: 0,
        safeTxGas: 0,
        baseGas: 0,
        gasPrice: 0,
        gasToken: ethers.ZeroAddress,
        refundReceiver: ethers.ZeroAddress,
        nonce: await soloDao.safe.nonce(),
      };

      const txHash = await soloDao.safe.getTransactionHash(
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

      const aliceSig = await signers.alice.signMessage(ethers.getBytes(txHash));
      const aliceSignature = Signature.from(aliceSig);

      const signatures = createSafeSignatures([signers.alice.address], [aliceSignature]);

      const bobBalanceBefore = await ethers.provider.getBalance(signers.bob.address);

      await soloDao.safe
        .connect(signers.alice)
        .execTransaction(
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

      const bobBalanceAfter = await ethers.provider.getBalance(signers.bob.address);
      expect(bobBalanceAfter).to.equal(bobBalanceBefore + ethers.parseEther('1'));
    });

    it('Should enforce nonce ordering', async () => {
      const { dao } = await loadFixture(setupTestFixture);

      // Create two transactions with consecutive nonces
      const nonce1 = await dao.safe.nonce();
      const nonce2 = nonce1 + 1n;

      // tx1 would be used here to test nonce ordering if executed
      // Create tx1 only for demonstrating nonce ordering - not executed in this test

      const tx2 = {
        to: signers.bob.address,
        value: 0n,
        data: '0x',
        operation: 0,
        safeTxGas: 0,
        baseGas: 0,
        gasPrice: 0,
        gasToken: ethers.ZeroAddress,
        refundReceiver: ethers.ZeroAddress,
        nonce: nonce2,
      };

      // Get signatures for tx2
      const tx2Hash = await dao.safe.getTransactionHash(
        tx2.to,
        tx2.value,
        tx2.data,
        tx2.operation,
        tx2.safeTxGas,
        tx2.baseGas,
        tx2.gasPrice,
        tx2.gasToken,
        tx2.refundReceiver,
        tx2.nonce,
      );

      const aliceSig2 = await signers.alice.signMessage(ethers.getBytes(tx2Hash));
      const aliceSignature2 = Signature.from(aliceSig2);
      const bobSig2 = await signers.bob.signMessage(ethers.getBytes(tx2Hash));
      const bobSignature2 = Signature.from(bobSig2);

      const signatures2 = createSafeSignatures(
        [signers.alice.address, signers.bob.address],
        [aliceSignature2, bobSignature2],
      );

      // Try to execute tx2 before tx1 - should fail
      await expect(
        dao.safe.execTransaction(
          tx2.to,
          tx2.value,
          tx2.data,
          tx2.operation,
          tx2.safeTxGas,
          tx2.baseGas,
          tx2.gasPrice,
          tx2.gasToken,
          tx2.refundReceiver,
          signatures2,
        ),
      ).to.be.reverted;

      // Current nonce should still be nonce1
      expect(await dao.safe.nonce()).to.equal(nonce1);
    });
  });
});
