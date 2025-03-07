import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  GnosisSafe,
  GnosisSafeProxyFactory,
  LinearERC721VotingWithHatsProposalCreationV1,
  LinearERC721VotingWithHatsProposalCreationV1__factory,
  AzoriusV1,
  AzoriusV1__factory,
  MockERC721,
  MockERC721__factory,
  ModuleProxyFactory,
  GnosisSafeL2__factory,
} from '../../typechain-types';
import {
  getGnosisSafeL2Singleton,
  getGnosisSafeProxyFactory,
  getModuleProxyFactory,
} from '../global/GlobalSafeDeployments.test';
import {
  calculateProxyAddress,
  predictGnosisSafeAddress,
  buildSafeTransaction,
  safeSignTypedData,
  buildSignatureBytes,
} from '../helpers';

describe('LinearERC721VotingWithHatsProposalCreation', () => {
  // Deployed contracts
  let gnosisSafe: GnosisSafe;
  let azorius: AzoriusV1;
  let azoriusMastercopy: AzoriusV1;
  let linearERC721VotingWithHats: LinearERC721VotingWithHatsProposalCreationV1;
  let linearERC721VotingWithHatsMastercopy: LinearERC721VotingWithHatsProposalCreationV1;
  let mockERC721: MockERC721;
  let gnosisSafeProxyFactory: GnosisSafeProxyFactory;
  let moduleProxyFactory: ModuleProxyFactory;

  // Wallets
  let deployer: SignerWithAddress;
  let gnosisSafeOwner: SignerWithAddress;

  // Gnosis
  let createGnosisSetupCalldata: string;

  const saltNum = BigInt('0x856d90216588f9ffc124d1480a440e1c012c7a816952bc968d737bae5d4e139c');

  beforeEach(async () => {
    gnosisSafeProxyFactory = getGnosisSafeProxyFactory();
    moduleProxyFactory = getModuleProxyFactory();
    const gnosisSafeL2Singleton = getGnosisSafeL2Singleton();

    const abiCoder = new ethers.AbiCoder();

    [deployer, gnosisSafeOwner] = await ethers.getSigners();

    createGnosisSetupCalldata =
      // eslint-disable-next-line camelcase
      GnosisSafeL2__factory.createInterface().encodeFunctionData('setup', [
        [gnosisSafeOwner.address],
        1,
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

    gnosisSafe = GnosisSafeL2__factory.connect(predictedGnosisSafeAddress, deployer);

    // Deploy MockERC721 contract
    mockERC721 = await new MockERC721__factory(deployer).deploy();

    // Deploy Azorius module
    azoriusMastercopy = await new AzoriusV1__factory(deployer).deploy();

    const azoriusSetupCalldata =
      // eslint-disable-next-line camelcase
      AzoriusV1__factory.createInterface().encodeFunctionData('setUp', [
        abiCoder.encode(
          ['address', 'address', 'address', 'address[]', 'uint32', 'uint32'],
          [
            gnosisSafeOwner.address,
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

    azorius = AzoriusV1__factory.connect(predictedAzoriusAddress, deployer);

    // Deploy LinearERC721VotingWithHatsProposalCreation
    linearERC721VotingWithHatsMastercopy =
      await new LinearERC721VotingWithHatsProposalCreationV1__factory(deployer).deploy();

    const mockHatsContractAddress = '0x1234567890123456789012345678901234567890';

    const linearERC721VotingWithHatsSetupCalldata =
      LinearERC721VotingWithHatsProposalCreationV1__factory.createInterface().encodeFunctionData(
        'setUp',
        [
          abiCoder.encode(
            [
              'address',
              'address[]',
              'uint256[]',
              'address',
              'uint32',
              'uint256',
              'uint256',
              'address',
              'uint256[]',
            ],
            [
              gnosisSafeOwner.address,
              [await mockERC721.getAddress()],
              [1], // weight for the ERC721 token
              await azorius.getAddress(),
              60, // voting period
              500000, // quorum threshold
              500000, // basis numerator
              mockHatsContractAddress,
              [1n], // Use a mock hat ID
            ],
          ),
        ],
      );

    await moduleProxyFactory.deployModule(
      await linearERC721VotingWithHatsMastercopy.getAddress(),
      linearERC721VotingWithHatsSetupCalldata,
      '10031021',
    );

    const predictedLinearERC721VotingWithHatsAddress = await calculateProxyAddress(
      moduleProxyFactory,
      await linearERC721VotingWithHatsMastercopy.getAddress(),
      linearERC721VotingWithHatsSetupCalldata,
      '10031021',
    );

    linearERC721VotingWithHats = LinearERC721VotingWithHatsProposalCreationV1__factory.connect(
      predictedLinearERC721VotingWithHatsAddress,
      deployer,
    );

    // Enable the strategy on Azorius
    await azorius
      .connect(gnosisSafeOwner)
      .enableStrategy(await linearERC721VotingWithHats.getAddress());

    // Create transaction on Gnosis Safe to setup Azorius module
    const enableAzoriusModuleData = gnosisSafe.interface.encodeFunctionData('enableModule', [
      await azorius.getAddress(),
    ]);

    const enableAzoriusModuleTx = buildSafeTransaction({
      to: await gnosisSafe.getAddress(),
      data: enableAzoriusModuleData,
      safeTxGas: 1000000,
      nonce: await gnosisSafe.nonce(),
    });

    const sigs = [await safeSignTypedData(gnosisSafeOwner, gnosisSafe, enableAzoriusModuleTx)];

    const signatureBytes = buildSignatureBytes(sigs);

    // Execute transaction that adds the Azorius module to the Safe
    await expect(
      gnosisSafe.execTransaction(
        enableAzoriusModuleTx.to,
        enableAzoriusModuleTx.value,
        enableAzoriusModuleTx.data,
        enableAzoriusModuleTx.operation,
        enableAzoriusModuleTx.safeTxGas,
        enableAzoriusModuleTx.baseGas,
        enableAzoriusModuleTx.gasPrice,
        enableAzoriusModuleTx.gasToken,
        enableAzoriusModuleTx.refundReceiver,
        signatureBytes,
      ),
    ).to.emit(gnosisSafe, 'ExecutionSuccess');
  });

  it('Gets correctly initialized', async () => {
    expect(await linearERC721VotingWithHats.owner()).to.eq(gnosisSafeOwner.address);
    expect(await linearERC721VotingWithHats.tokenAddresses(0)).to.eq(await mockERC721.getAddress());
    expect(await linearERC721VotingWithHats.tokenWeights(await mockERC721.getAddress())).to.eq(1);
    expect(await linearERC721VotingWithHats.azoriusModule()).to.eq(await azorius.getAddress());
    expect(await linearERC721VotingWithHats.hatsContract()).to.eq(
      '0x1234567890123456789012345678901234567890',
    );
  });

  it('Cannot call setUp function again', async () => {
    const setupParams = ethers.AbiCoder.defaultAbiCoder().encode(
      [
        'address',
        'address[]',
        'uint256[]',
        'address',
        'uint32',
        'uint256',
        'uint256',
        'address',
        'uint256[]',
      ],
      [
        gnosisSafeOwner.address,
        [await mockERC721.getAddress()],
        [1],
        await azorius.getAddress(),
        60,
        500000,
        500000,
        '0x1234567890123456789012345678901234567890',
        [1n],
      ],
    );

    await expect(linearERC721VotingWithHats.setUp(setupParams)).to.be.revertedWithCustomError(
      linearERC721VotingWithHats,
      'InvalidInitialization',
    );
  });

  describe('Version', function () {
    it('Azorius module should have a version', async function () {
      const version = await azorius.getVersion();
      void expect(version).to.equal(1);
    });

    it('Linear ERC721 voting with hats should have a version', async function () {
      const version = await linearERC721VotingWithHats.getVersion();
      void expect(version).to.equal(1);
    });
  });
});
