import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  GnosisSafe,
  GnosisSafeProxyFactory,
  LinearERC20VotingWithHatsProposalCreationV1,
  LinearERC20VotingWithHatsProposalCreationV1__factory,
  AzoriusV1,
  AzoriusV1__factory,
  VotesERC20V1,
  VotesERC20V1__factory,
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

describe('LinearERC20VotingWithHatsProposalCreation', () => {
  // Deployed contracts
  let gnosisSafe: GnosisSafe;
  let azorius: AzoriusV1;
  let azoriusMastercopy: AzoriusV1;
  let linearERC20VotingWithHats: LinearERC20VotingWithHatsProposalCreationV1;
  let linearERC20VotingWithHatsMastercopy: LinearERC20VotingWithHatsProposalCreationV1;
  let votesERC20Mastercopy: VotesERC20V1;
  let votesERC20: VotesERC20V1;
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

    // Deploy Votes ERC-20 mastercopy contract
    votesERC20Mastercopy = await new VotesERC20V1__factory(deployer).deploy();

    const votesERC20SetupCalldata =
      // eslint-disable-next-line camelcase
      VotesERC20V1__factory.createInterface().encodeFunctionData('setUp', [
        abiCoder.encode(['string', 'string', 'address[]', 'uint256[]'], ['DCNT', 'DCNT', [], []]),
      ]);

    await moduleProxyFactory.deployModule(
      await votesERC20Mastercopy.getAddress(),
      votesERC20SetupCalldata,
      '10031021',
    );

    const predictedVotesERC20Address = await calculateProxyAddress(
      moduleProxyFactory,
      await votesERC20Mastercopy.getAddress(),
      votesERC20SetupCalldata,
      '10031021',
    );

    votesERC20 = VotesERC20V1__factory.connect(predictedVotesERC20Address, deployer);

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

    // Deploy LinearERC20VotingWithHatsProposalCreation
    linearERC20VotingWithHatsMastercopy =
      await new LinearERC20VotingWithHatsProposalCreationV1__factory(deployer).deploy();

    const mockHatsContractAddress = '0x1234567890123456789012345678901234567890';

    const linearERC20VotingWithHatsSetupCalldata =
      LinearERC20VotingWithHatsProposalCreationV1__factory.createInterface().encodeFunctionData(
        'setUp',
        [
          abiCoder.encode(
            [
              'address',
              'address',
              'address',
              'uint32',
              'uint256',
              'uint256',
              'address',
              'uint256[]',
            ],
            [
              gnosisSafeOwner.address,
              await votesERC20.getAddress(),
              await azorius.getAddress(),
              60,
              500000,
              500000,
              mockHatsContractAddress,
              [1n], // Use a mock hat ID
            ],
          ),
        ],
      );

    await moduleProxyFactory.deployModule(
      await linearERC20VotingWithHatsMastercopy.getAddress(),
      linearERC20VotingWithHatsSetupCalldata,
      '10031021',
    );

    const predictedLinearERC20VotingWithHatsAddress = await calculateProxyAddress(
      moduleProxyFactory,
      await linearERC20VotingWithHatsMastercopy.getAddress(),
      linearERC20VotingWithHatsSetupCalldata,
      '10031021',
    );

    linearERC20VotingWithHats = LinearERC20VotingWithHatsProposalCreationV1__factory.connect(
      predictedLinearERC20VotingWithHatsAddress,
      deployer,
    );

    // Enable the strategy on Azorius
    await azorius
      .connect(gnosisSafeOwner)
      .enableStrategy(await linearERC20VotingWithHats.getAddress());

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
    expect(await linearERC20VotingWithHats.owner()).to.eq(gnosisSafeOwner.address);
    expect(await linearERC20VotingWithHats.governanceToken()).to.eq(await votesERC20.getAddress());
    expect(await linearERC20VotingWithHats.azoriusModule()).to.eq(await azorius.getAddress());
    expect(await linearERC20VotingWithHats.hatsContract()).to.eq(
      '0x1234567890123456789012345678901234567890',
    );
  });

  it('Cannot call setUp function again', async () => {
    const setupParams = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'address', 'uint32', 'uint256', 'uint256', 'address', 'uint256[]'],
      [
        gnosisSafeOwner.address,
        await votesERC20.getAddress(),
        await azorius.getAddress(),
        60, // voting period
        500000, // quorum numerator
        500000, // basis numerator
        '0x1234567890123456789012345678901234567890',
        [1n],
      ],
    );

    await expect(linearERC20VotingWithHats.setUp(setupParams)).to.be.revertedWithCustomError(
      linearERC20VotingWithHats,
      'InvalidInitialization',
    );
  });

  describe('Version', function () {
    it('Azorius module should have a version', async function () {
      const version = await azorius.getVersion();
      void expect(version).to.equal(1);
    });

    it('Linear ERC20 voting with hats should have a version', async function () {
      const version = await linearERC20VotingWithHats.getVersion();
      void expect(version).to.equal(1);
    });

    it('Votes ERC20 should have a version', async function () {
      const version = await votesERC20.getVersion();
      void expect(version).to.equal(1);
    });
  });
});
