import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import hre, { ethers } from 'hardhat';
import {
  ERC721FreezeVoting,
  ERC721FreezeVoting__factory,
  MultisigFreezeGuard,
  MultisigFreezeGuard__factory,
  ERC20FreezeVoting__factory,
  MockERC721,
  MockERC721__factory,
  Azorius__factory,
  LinearERC721Voting,
  LinearERC721Voting__factory,
  Azorius,
  GnosisSafeL2__factory,
  GnosisSafeL2,
} from '../typechain-types';
import {
  getGnosisSafeL2Singleton,
  getGnosisSafeProxyFactory,
  getModuleProxyFactory,
} from './GlobalSafeDeployments.test';
import {
  buildSignatureBytes,
  buildSafeTransaction,
  safeSignTypedData,
  predictGnosisSafeAddress,
  calculateProxyAddress,
} from './helpers';
import time from './time';

describe('Child Multisig DAO with Azorius Parent', () => {
  // Deployed contracts
  let gnosisSafe: GnosisSafeL2;
  let freezeGuardMastercopy: MultisigFreezeGuard;
  let freezeGuard: MultisigFreezeGuard;
  let freezeVotingMastercopy: ERC721FreezeVoting;
  let freezeVoting: ERC721FreezeVoting;
  let mockNFT: MockERC721;
  let linearERC721Voting: LinearERC721Voting;
  let linearERC721VotingMastercopy: LinearERC721Voting;
  let azoriusMastercopy: Azorius;
  let azorius: Azorius;

  // Wallets
  let deployer: SignerWithAddress;
  let owner1: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;
  let tokenVetoer1: SignerWithAddress;
  let tokenVetoer2: SignerWithAddress;
  let vetoer1Ids: number[];
  let vetoer2Ids: number[];
  let freezeGuardOwner: SignerWithAddress;
  let mintNFTData: string;

  // Gnosis
  let createGnosisSetupCalldata: string;

  const threshold = 2;
  const saltNum = BigInt('0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c');

  async function mintNFT(contract: MockERC721, receiver: SignerWithAddress): Promise<void> {
    await contract.connect(receiver).mint(receiver.address);
  }

  beforeEach(async () => {
    [deployer, owner1, owner2, owner3, tokenVetoer1, tokenVetoer2, freezeGuardOwner] =
      await hre.ethers.getSigners();

    const gnosisSafeProxyFactory = getGnosisSafeProxyFactory();
    const moduleProxyFactory = getModuleProxyFactory();
    const gnosisSafeL2Singleton = getGnosisSafeL2Singleton();

    createGnosisSetupCalldata =
      // eslint-disable-next-line camelcase
      GnosisSafeL2__factory.createInterface().encodeFunctionData('setup', [
        [owner1.address, owner2.address, owner3.address],
        threshold,
        ethers.ZeroAddress,
        ethers.ZeroHash,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        0,
        ethers.ZeroAddress,
      ]);

    const predictedGnosisSafeAddress = await predictGnosisSafeAddress(
      createGnosisSetupCalldata,
      saltNum,
      await gnosisSafeL2Singleton.getAddress(),
      gnosisSafeProxyFactory,
    );

    // Deploy Gnosis Safe
    await gnosisSafeProxyFactory.createProxyWithNonce(
      await gnosisSafeL2Singleton.getAddress(),
      createGnosisSetupCalldata,
      saltNum,
    );

    // Get Gnosis Safe contract
    // eslint-disable-next-line camelcase
    gnosisSafe = GnosisSafeL2__factory.connect(predictedGnosisSafeAddress, deployer);

    const abiCoder = new ethers.AbiCoder(); // encode data

    // Deploy Mock NFT
    mockNFT = await new MockERC721__factory(deployer).deploy();

    // dish out NFTs
    await mintNFT(mockNFT, tokenVetoer1);
    await mintNFT(mockNFT, tokenVetoer2);
    await mintNFT(mockNFT, tokenVetoer2);
    vetoer1Ids = [0];
    vetoer2Ids = [1, 2];

    mintNFTData = mockNFT.interface.encodeFunctionData('mint', [deployer.address]);

    // Deploy Azorius module
    azoriusMastercopy = await new Azorius__factory(deployer).deploy();

    const azoriusSetupCalldata =
      // eslint-disable-next-line camelcase
      Azorius__factory.createInterface().encodeFunctionData('setUp', [
        abiCoder.encode(
          ['address', 'address', 'address', 'address[]', 'uint32', 'uint32'],
          [
            owner1.address,
            await gnosisSafe.getAddress(),
            await gnosisSafe.getAddress(),
            [],
            60, // timelock period in blocks
            60, // execution period in blocks
          ],
        ),
      ]);

    await moduleProxyFactory.deployModule(
      await azoriusMastercopy.getAddress(),
      azoriusSetupCalldata,
      '10031021',
    );

    const predictedAzoriusAddress = await calculateProxyAddress(
      moduleProxyFactory,
      await azoriusMastercopy.getAddress(),
      azoriusSetupCalldata,
      '10031021',
    );

    azorius = await hre.ethers.getContractAt('Azorius', predictedAzoriusAddress);

    // Deploy Linear ERC721 Voting Mastercopy
    linearERC721VotingMastercopy = await new LinearERC721Voting__factory(deployer).deploy();

    const linearERC721VotingSetupCalldata =
      // eslint-disable-next-line camelcase
      LinearERC721Voting__factory.createInterface().encodeFunctionData('setUp', [
        abiCoder.encode(
          [
            'address',
            'address[]',
            'uint256[]',
            'address',
            'uint32',
            'uint256',
            'uint256',
            'uint256',
          ],
          [
            owner1.address, // owner
            [await mockNFT.getAddress()], // NFT addresses
            [500], // NFT weights
            await azorius.getAddress(), // Azorius module
            60, // voting period in blocks
            2, // quorom threshold
            2, // proposer threshold
            500000, // basis numerator, denominator is 1,000,000, so basis percentage is 50% (simple majority)
          ],
        ),
      ]);

    await moduleProxyFactory.deployModule(
      await linearERC721VotingMastercopy.getAddress(),
      linearERC721VotingSetupCalldata,
      '10031021',
    );

    const predictedlinearERC721VotingAddress = await calculateProxyAddress(
      moduleProxyFactory,
      await linearERC721VotingMastercopy.getAddress(),
      linearERC721VotingSetupCalldata,
      '10031021',
    );

    linearERC721Voting = await hre.ethers.getContractAt(
      'LinearERC721Voting',
      predictedlinearERC721VotingAddress,
    );

    // Deploy ERC721FreezeVoting mastercopy contract
    freezeVotingMastercopy = await new ERC721FreezeVoting__factory(deployer).deploy();

    // Initialize FreezeVoting contract
    const freezeVotingSetupData =
      // eslint-disable-next-line camelcase
      ERC20FreezeVoting__factory.createInterface().encodeFunctionData('setUp', [
        abiCoder.encode(
          ['address', 'uint256', 'uint32', 'uint32', 'address'],
          [
            freezeGuardOwner.address,
            501, // freeze votes threshold
            10, // freeze proposal period
            200, // freeze period
            await linearERC721Voting.getAddress(), // strategy address
          ],
        ),
      ]);

    await moduleProxyFactory.deployModule(
      await freezeVotingMastercopy.getAddress(),
      freezeVotingSetupData,
      '10031021',
    );

    const predictedFreezeVotingAddress = await calculateProxyAddress(
      moduleProxyFactory,
      await freezeVotingMastercopy.getAddress(),
      freezeVotingSetupData,
      '10031021',
    );

    freezeVoting = await hre.ethers.getContractAt(
      'ERC721FreezeVoting',
      predictedFreezeVotingAddress,
    );

    // Deploy FreezeGuard mastercopy contract
    freezeGuardMastercopy = await new MultisigFreezeGuard__factory(deployer).deploy();

    // Deploy MultisigFreezeGuard contract with a 60 block timelock period, and a 60 block execution period
    const freezeGuardSetupData =
      // eslint-disable-next-line camelcase
      MultisigFreezeGuard__factory.createInterface().encodeFunctionData('setUp', [
        abiCoder.encode(
          ['uint32', 'uint32', 'address', 'address', 'address'],
          [
            60, // Timelock period
            60, // Execution period
            freezeGuardOwner.address,
            await freezeVoting.getAddress(),
            await gnosisSafe.getAddress(),
          ],
        ),
      ]);

    await moduleProxyFactory.deployModule(
      await freezeGuardMastercopy.getAddress(),
      freezeGuardSetupData,
      '10031021',
    );

    const predictedFreezeGuardAddress = await calculateProxyAddress(
      moduleProxyFactory,
      await freezeGuardMastercopy.getAddress(),
      freezeGuardSetupData,
      '10031021',
    );

    freezeGuard = await hre.ethers.getContractAt(
      'MultisigFreezeGuard',
      predictedFreezeGuardAddress,
    );

    // Create transaction to set the guard address
    const setGuardData = gnosisSafe.interface.encodeFunctionData('setGuard', [
      await freezeGuard.getAddress(),
    ]);

    const tx = buildSafeTransaction({
      to: await gnosisSafe.getAddress(),
      data: setGuardData,
      safeTxGas: 1000000,
      nonce: await gnosisSafe.nonce(),
    });
    const sigs = [
      await safeSignTypedData(owner1, gnosisSafe, tx),
      await safeSignTypedData(owner2, gnosisSafe, tx),
    ];
    const signatureBytes = buildSignatureBytes(sigs);

    // Execute transaction that adds the veto guard to the Safe
    await expect(
      gnosisSafe.execTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatureBytes,
      ),
    ).to.emit(gnosisSafe, 'ExecutionSuccess');
  });

  describe('FreezeGuard Functionality', () => {
    it('Freeze parameters correctly setup', async () => {
      // Frozen Params init correctly
      expect(await freezeVoting.freezeVotesThreshold()).to.eq(501);
      expect(await freezeVoting.freezeProposalPeriod()).to.eq(10);
      expect(await freezeVoting.freezePeriod()).to.eq(200);
      expect(await freezeVoting.owner()).to.eq(freezeGuardOwner.address);
    });

    it('Updates state properly due to freeze actions', async () => {
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(0);
      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(0);

      // Vetoer 1 casts 500 freeze votes
      await freezeVoting
        .connect(tokenVetoer1)
        ['castFreezeVote(address[],uint256[])']([await mockNFT.getAddress()], vetoer1Ids);
      expect(await freezeVoting.isFrozen()).to.eq(false);
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(500);
      const latestBlock = await hre.ethers.provider.getBlock('latest');
      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(latestBlock!.number);

      await freezeVoting
        .connect(tokenVetoer2)
        [
          'castFreezeVote(address[],uint256[])'
        ]([await mockNFT.getAddress(), await mockNFT.getAddress()], vetoer2Ids);
      expect(await freezeVoting.isFrozen()).to.eq(true);
    });

    it('A transaction can be timelocked and executed', async () => {
      const tx = buildSafeTransaction({
        to: await mockNFT.getAddress(),
        data: mintNFTData,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs = [
        await safeSignTypedData(owner1, gnosisSafe, tx),
        await safeSignTypedData(owner2, gnosisSafe, tx),
      ];
      const signatureBytes = buildSignatureBytes(sigs);

      await freezeGuard.timelockTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatureBytes,
        tx.nonce,
      );

      const latestBlock = await hre.ethers.provider.getBlock('latest');

      const signaturesHash = ethers.solidityPackedKeccak256(['bytes'], [signatureBytes]);

      expect(await freezeGuard.getTransactionTimelockedBlock(signaturesHash)).to.eq(
        latestBlock!.number,
      );

      // Move time forward to elapse timelock period
      await time.advanceBlocks(60);

      await gnosisSafe.execTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatureBytes,
      );

      expect(await mockNFT.balanceOf(deployer.address)).to.eq(1);
    });

    it("A transaction cannot be executed if it hasn't yet been timelocked", async () => {
      const tx = buildSafeTransaction({
        to: await mockNFT.getAddress(),
        data: mintNFTData,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs = [
        await safeSignTypedData(owner1, gnosisSafe, tx),
        await safeSignTypedData(owner2, gnosisSafe, tx),
      ];
      const signatureBytes = buildSignatureBytes(sigs);

      await expect(
        gnosisSafe.execTransaction(
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
          tx.safeTxGas,
          tx.baseGas,
          tx.gasPrice,
          tx.gasToken,
          tx.refundReceiver,
          signatureBytes,
        ),
      ).to.be.revertedWithCustomError(freezeGuard, 'NotTimelocked');
    });

    it("A transaction cannot be timelocked if the signatures aren't valid", async () => {
      const tx = buildSafeTransaction({
        to: await mockNFT.getAddress(),
        data: mintNFTData,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      // Only 1 signer signs, while the threshold is 2
      const sigs = [await safeSignTypedData(owner1, gnosisSafe, tx)];
      const signatureBytes = buildSignatureBytes(sigs);

      await expect(
        freezeGuard.timelockTransaction(
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
          tx.safeTxGas,
          tx.baseGas,
          tx.gasPrice,
          tx.gasToken,
          tx.refundReceiver,
          signatureBytes,
          tx.nonce,
        ),
      ).to.be.revertedWith('GS020');
    });

    it('A transaction cannot be executed if the timelock period has not ended yet', async () => {
      const tx = buildSafeTransaction({
        to: await mockNFT.getAddress(),
        data: mintNFTData,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs = [
        await safeSignTypedData(owner1, gnosisSafe, tx),
        await safeSignTypedData(owner2, gnosisSafe, tx),
      ];
      const signatureBytes = buildSignatureBytes(sigs);

      await freezeGuard.timelockTransaction(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        signatureBytes,
        tx.nonce,
      );

      await expect(
        gnosisSafe.execTransaction(
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
          tx.safeTxGas,
          tx.baseGas,
          tx.gasPrice,
          tx.gasToken,
          tx.refundReceiver,
          signatureBytes,
        ),
      ).to.be.revertedWithCustomError(freezeGuard, 'Timelocked');
    });

    it('A DAO may execute txs during a the freeze proposal period if the freeze threshold is not met', async () => {
      // Vetoer 1 casts 500 freeze votes
      await freezeVoting
        .connect(tokenVetoer1)
        ['castFreezeVote(address[],uint256[])']([await mockNFT.getAddress()], vetoer1Ids);

      // Check that the DAO has been frozen
      expect(await freezeVoting.isFrozen()).to.eq(false);

      const tx1 = buildSafeTransaction({
        to: await mockNFT.getAddress(),
        data: mintNFTData,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs1 = [
        await safeSignTypedData(owner1, gnosisSafe, tx1),
        await safeSignTypedData(owner2, gnosisSafe, tx1),
      ];
      const signatureBytes1 = buildSignatureBytes(sigs1);

      await freezeGuard.timelockTransaction(
        tx1.to,
        tx1.value,
        tx1.data,
        tx1.operation,
        tx1.safeTxGas,
        tx1.baseGas,
        tx1.gasPrice,
        tx1.gasToken,
        tx1.refundReceiver,
        signatureBytes1,
        tx1.nonce,
      );

      // Move time forward to elapse timelock period
      await time.advanceBlocks(60);

      await expect(
        gnosisSafe.execTransaction(
          tx1.to,
          tx1.value,
          tx1.data,
          tx1.operation,
          tx1.safeTxGas,
          tx1.baseGas,
          tx1.gasPrice,
          tx1.gasToken,
          tx1.refundReceiver,
          signatureBytes1,
        ),
      ).to.emit(gnosisSafe, 'ExecutionSuccess');
    });

    it('Casting a vote after the freeze voting period resets state', async () => {
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(0);
      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(0);

      // Vetoer 1 casts 500 freeze votes
      await freezeVoting
        .connect(tokenVetoer1)
        ['castFreezeVote(address[],uint256[])']([await mockNFT.getAddress()], vetoer1Ids);
      expect(await freezeVoting.isFrozen()).to.eq(false);
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(500);
      let latestBlock = await hre.ethers.provider.getBlock('latest');
      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(latestBlock!.number);

      // Move time forward to elapse freeze proposal period
      await time.advanceBlocks(10);

      await freezeVoting
        .connect(tokenVetoer1)
        ['castFreezeVote(address[],uint256[])']([await mockNFT.getAddress()], vetoer1Ids);
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(500);
      latestBlock = await hre.ethers.provider.getBlock('latest');
      expect(await freezeVoting.freezeProposalCreatedBlock()).to.eq(latestBlock!.number);
      expect(await freezeVoting.isFrozen()).to.eq(false);
    });

    it('A user cannot vote twice to freeze a dao during the same voting period', async () => {
      await freezeVoting
        .connect(tokenVetoer1)
        ['castFreezeVote(address[],uint256[])']([await mockNFT.getAddress()], vetoer1Ids);
      await expect(
        freezeVoting
          .connect(tokenVetoer1)
          ['castFreezeVote(address[],uint256[])']([await mockNFT.getAddress()], vetoer1Ids),
      ).to.be.revertedWithCustomError(freezeVoting, 'NoVotes()');
      expect(await freezeVoting.freezeProposalVoteCount()).to.eq(500);
    });

    it('An unfrozen DAO may not execute a previously passed transaction', async () => {
      // Vetoer 1 casts 500 freeze votes
      await freezeVoting
        .connect(tokenVetoer1)
        ['castFreezeVote(address[],uint256[])']([await mockNFT.getAddress()], vetoer1Ids);
      // Vetoer 2 casts 1000 freeze votes
      await freezeVoting
        .connect(tokenVetoer2)
        [
          'castFreezeVote(address[],uint256[])'
        ]([await mockNFT.getAddress(), await mockNFT.getAddress()], vetoer2Ids);

      // Check that the DAO has been frozen
      expect(await freezeVoting.isFrozen()).to.eq(true);

      const tx1 = buildSafeTransaction({
        to: await mockNFT.getAddress(),
        data: mintNFTData,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs1 = [
        await safeSignTypedData(owner1, gnosisSafe, tx1),
        await safeSignTypedData(owner2, gnosisSafe, tx1),
      ];
      const signatureBytes1 = buildSignatureBytes(sigs1);

      await freezeGuard.timelockTransaction(
        tx1.to,
        tx1.value,
        tx1.data,
        tx1.operation,
        tx1.safeTxGas,
        tx1.baseGas,
        tx1.gasPrice,
        tx1.gasToken,
        tx1.refundReceiver,
        signatureBytes1,
        tx1.nonce,
      );

      // Move time forward to elapse timelock period
      await time.advanceBlocks(60);

      await expect(
        gnosisSafe.execTransaction(
          tx1.to,
          tx1.value,
          tx1.data,
          tx1.operation,
          tx1.safeTxGas,
          tx1.baseGas,
          tx1.gasPrice,
          tx1.gasToken,
          tx1.refundReceiver,
          signatureBytes1,
        ),
      ).to.be.revertedWithCustomError(freezeGuard, 'DAOFrozen()');

      // Move time forward to elapse freeze period
      await time.advanceBlocks(140);

      // Check that the DAO has been unFrozen
      expect(await freezeVoting.isFrozen()).to.eq(false);
      await expect(
        gnosisSafe.execTransaction(
          tx1.to,
          tx1.value,
          tx1.data,
          tx1.operation,
          tx1.safeTxGas,
          tx1.baseGas,
          tx1.gasPrice,
          tx1.gasToken,
          tx1.refundReceiver,
          signatureBytes1,
        ),
      ).to.be.revertedWithCustomError(freezeGuard, 'Expired');
    });

    it('Unfrozen DAOs may execute txs', async () => {
      // Vetoer 1 casts 500 freeze votes
      await freezeVoting
        .connect(tokenVetoer1)
        ['castFreezeVote(address[],uint256[])']([await mockNFT.getAddress()], vetoer1Ids);
      // Vetoer 2 casts 1000 freeze votes
      await freezeVoting
        .connect(tokenVetoer2)
        [
          'castFreezeVote(address[],uint256[])'
        ]([await mockNFT.getAddress(), await mockNFT.getAddress()], vetoer2Ids);

      // Check that the DAO has been frozen
      expect(await freezeVoting.isFrozen()).to.eq(true);
      await freezeVoting.connect(freezeGuardOwner).unfreeze();
      expect(await freezeVoting.isFrozen()).to.eq(false);

      const tx1 = buildSafeTransaction({
        to: await mockNFT.getAddress(),
        data: mintNFTData,
        safeTxGas: 1000000,
        nonce: await gnosisSafe.nonce(),
      });

      const sigs1 = [
        await safeSignTypedData(owner1, gnosisSafe, tx1),
        await safeSignTypedData(owner2, gnosisSafe, tx1),
      ];
      const signatureBytes1 = buildSignatureBytes(sigs1);

      await freezeGuard.timelockTransaction(
        tx1.to,
        tx1.value,
        tx1.data,
        tx1.operation,
        tx1.safeTxGas,
        tx1.baseGas,
        tx1.gasPrice,
        tx1.gasToken,
        tx1.refundReceiver,
        signatureBytes1,
        tx1.nonce,
      );

      // Move time forward to elapse timelock period
      await time.advanceBlocks(60);

      // Check that the DAO has been unFrozen
      await expect(
        gnosisSafe.execTransaction(
          tx1.to,
          tx1.value,
          tx1.data,
          tx1.operation,
          tx1.safeTxGas,
          tx1.baseGas,
          tx1.gasPrice,
          tx1.gasToken,
          tx1.refundReceiver,
          signatureBytes1,
        ),
      ).to.emit(gnosisSafe, 'ExecutionSuccess');
    });

    it('You must have voting weight to cast a freeze vote', async () => {
      await expect(
        freezeVoting
          .connect(freezeGuardOwner)
          ['castFreezeVote(address[],uint256[])']([await mockNFT.getAddress()], vetoer1Ids),
      ).to.be.revertedWithCustomError(freezeVoting, 'NoVotes()');
      freezeVoting
        .connect(tokenVetoer1)
        ['castFreezeVote(address[],uint256[])']([await mockNFT.getAddress()], vetoer1Ids);
      await expect(
        freezeVoting
          .connect(freezeGuardOwner)
          [
            'castFreezeVote(address[],uint256[])'
          ]([await mockNFT.getAddress(), await mockNFT.getAddress()], vetoer2Ids),
      ).to.be.revertedWithCustomError(freezeVoting, 'NoVotes()');
    });

    it('Only owner methods must be called by vetoGuard owner', async () => {
      await expect(freezeVoting.connect(tokenVetoer1).unfreeze()).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
      await expect(
        freezeVoting.connect(tokenVetoer1).updateFreezeVotesThreshold(0),
      ).to.be.revertedWith('Ownable: caller is not the owner');
      await expect(
        freezeVoting.connect(tokenVetoer1).updateFreezeProposalPeriod(0),
      ).to.be.revertedWith('Ownable: caller is not the owner');
      await expect(freezeVoting.connect(tokenVetoer1).updateFreezePeriod(0)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
    });

    it('Only the freeze voting owner can update the freeze votes threshold', async () => {
      expect(await freezeVoting.freezeVotesThreshold()).to.eq(501);

      await freezeVoting.connect(freezeGuardOwner).updateFreezeVotesThreshold(2000);

      expect(await freezeVoting.freezeVotesThreshold()).to.eq(2000);

      await expect(
        freezeVoting.connect(tokenVetoer1).updateFreezeVotesThreshold(3000),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Only the freeze voting owner can update the freeze proposal period', async () => {
      expect(await freezeVoting.freezeProposalPeriod()).to.eq(10);

      await freezeVoting.connect(freezeGuardOwner).updateFreezeProposalPeriod(12);

      expect(await freezeVoting.freezeProposalPeriod()).to.eq(12);

      await expect(
        freezeVoting.connect(tokenVetoer1).updateFreezeProposalPeriod(14),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Only the freeze voting owner can update the freeze period', async () => {
      expect(await freezeVoting.freezePeriod()).to.eq(200);

      await freezeVoting.connect(freezeGuardOwner).updateFreezePeriod(300);

      expect(await freezeVoting.freezePeriod()).to.eq(300);

      await expect(freezeVoting.connect(tokenVetoer1).updateFreezePeriod(400)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
    });

    it('Only the freeze guard owner can update the timelock period', async () => {
      expect(await freezeGuard.timelockPeriod()).to.eq(60);

      await freezeGuard.connect(freezeGuardOwner).updateTimelockPeriod(70);

      expect(await freezeGuard.timelockPeriod()).to.eq(70);

      await expect(freezeGuard.connect(tokenVetoer1).updateTimelockPeriod(80)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
    });

    it('Only the freeze guard owner can update the execution period', async () => {
      expect(await freezeGuard.executionPeriod()).to.eq(60);

      await freezeGuard.connect(freezeGuardOwner).updateExecutionPeriod(80);

      expect(await freezeGuard.executionPeriod()).to.eq(80);

      await expect(freezeGuard.connect(tokenVetoer1).updateExecutionPeriod(90)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
    });
  });
});
