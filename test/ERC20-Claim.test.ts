import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import chai from 'chai';
import hre, { ethers } from 'hardhat';
import {
  VotesERC20,
  VotesERC20__factory,
  ERC20Claim,
  ERC20Claim__factory,
  ModuleProxyFactory,
} from '../typechain-types';
import { getModuleProxyFactory } from './GlobalSafeDeployments.test';
import { calculateProxyAddress } from './helpers';
import time from './time';

const expect = chai.expect;

describe('ERC-20 Token Claiming', function () {
  let moduleProxyFactory: ModuleProxyFactory;
  let votesERC20Mastercopy: VotesERC20;
  let parentERC20: VotesERC20;
  let childERC20: VotesERC20;
  let erc20ClaimMastercopy: ERC20Claim;
  let erc20Claim: ERC20Claim;

  let deployer: SignerWithAddress;
  let userA: SignerWithAddress;
  let userB: SignerWithAddress;

  const abiCoder = new ethers.AbiCoder();

  beforeEach(async function () {
    [deployer, userA, userB] = await hre.ethers.getSigners();

    moduleProxyFactory = getModuleProxyFactory();

    erc20ClaimMastercopy = await new ERC20Claim__factory(deployer).deploy();
    votesERC20Mastercopy = await new VotesERC20__factory(deployer).deploy();

    const parentERC20SetupData =
      // eslint-disable-next-line camelcase
      VotesERC20__factory.createInterface().encodeFunctionData('setUp', [
        abiCoder.encode(
          ['string', 'string', 'address[]', 'uint256[]'],
          [
            'ParentDecent',
            'pDCNT',
            [deployer.address, userA.address],
            [ethers.parseUnits('100', 18), ethers.parseUnits('150', 18)],
          ],
        ),
      ]);

    await moduleProxyFactory.deployModule(
      await votesERC20Mastercopy.getAddress(),
      parentERC20SetupData,
      '10031021',
    );

    const predictedParentVotesERC20Address = await calculateProxyAddress(
      moduleProxyFactory,
      await votesERC20Mastercopy.getAddress(),
      parentERC20SetupData,
      '10031021',
    );

    parentERC20 = await hre.ethers.getContractAt('VotesERC20', predictedParentVotesERC20Address);

    const childERC20SetupData =
      // eslint-disable-next-line camelcase
      VotesERC20__factory.createInterface().encodeFunctionData('setUp', [
        abiCoder.encode(
          ['string', 'string', 'address[]', 'uint256[]'],
          [
            'ChildDecent',
            'cDCNT',
            [userB.address, deployer.address],
            [ethers.parseUnits('100', 18), ethers.parseUnits('100', 18)],
          ],
        ),
      ]);

    await moduleProxyFactory.deployModule(
      await votesERC20Mastercopy.getAddress(),
      childERC20SetupData,
      '10031021',
    );

    const predictedChildVotesERC20Address = await calculateProxyAddress(
      moduleProxyFactory,
      await votesERC20Mastercopy.getAddress(),
      childERC20SetupData,
      '10031021',
    );

    childERC20 = await hre.ethers.getContractAt('VotesERC20', predictedChildVotesERC20Address);

    const latestBlock = await hre.ethers.provider.getBlock('latest');

    const erc20ClaimSetupData =
      // eslint-disable-next-line camelcase
      VotesERC20__factory.createInterface().encodeFunctionData('setUp', [
        abiCoder.encode(
          ['uint32', 'address', 'address', 'address', 'uint256'],
          [
            latestBlock!.number + 5,
            deployer.address,
            await parentERC20.getAddress(),
            await childERC20.getAddress(),
            ethers.parseUnits('100', 18),
          ],
        ),
      ]);

    const predictedERC20ClaimAddress = await calculateProxyAddress(
      moduleProxyFactory,
      await erc20ClaimMastercopy.getAddress(),
      erc20ClaimSetupData,
      '10031021',
    );

    await childERC20
      .connect(deployer)
      .approve(predictedERC20ClaimAddress, ethers.parseUnits('100', 18));

    await moduleProxyFactory.deployModule(
      await erc20ClaimMastercopy.getAddress(),
      erc20ClaimSetupData,
      '10031021',
    );

    erc20Claim = await hre.ethers.getContractAt('ERC20Claim', predictedERC20ClaimAddress);
  });

  it('Init is correct', async () => {
    expect(await parentERC20.name()).to.eq('ParentDecent');
    expect(await parentERC20.symbol()).to.eq('pDCNT');
    expect(await parentERC20.totalSupply()).to.eq(ethers.parseUnits('250', 18));
    expect(await parentERC20.balanceOf(deployer.address)).to.eq(ethers.parseUnits('100', 18));
    expect(await parentERC20.balanceOf(userA.address)).to.eq(ethers.parseUnits('150', 18));

    expect(await childERC20.name()).to.eq('ChildDecent');
    expect(await childERC20.symbol()).to.eq('cDCNT');
    expect(await childERC20.totalSupply()).to.eq(ethers.parseUnits('200', 18));
    expect(await childERC20.balanceOf(userB.address)).to.eq(ethers.parseUnits('100', 18));
    expect(await childERC20.balanceOf(deployer.address)).to.eq(ethers.parseUnits('0', 18));
    expect(await childERC20.balanceOf(await erc20Claim.getAddress())).to.eq(
      ethers.parseUnits('100', 18),
    );
  });

  it('Inits ClaimSubsidiary contract', async () => {
    expect(await erc20Claim.childERC20()).to.eq(await childERC20.getAddress());
    expect(await erc20Claim.parentERC20()).to.eq(await parentERC20.getAddress());
    expect(await erc20Claim.snapShotId()).to.eq(1);
    expect(await erc20Claim.parentAllocation()).to.eq(ethers.parseUnits('100', 18));
  });

  it('Claim Snap', async () => {
    const amount = await erc20Claim.getClaimAmount(deployer.address);
    // Claim on behalf
    await expect(erc20Claim.connect(userB).claimTokens(deployer.address)).to.emit(
      erc20Claim,
      'ERC20Claimed',
    );
    expect(
      amount +
        (await erc20Claim.getClaimAmount(userA.address)) +
        (await erc20Claim.getClaimAmount(await erc20Claim.getAddress())),
    ).to.eq(ethers.parseUnits('100', 18));
    expect(await childERC20.balanceOf(deployer.address)).to.eq(amount);
    expect(await childERC20.balanceOf(await erc20Claim.getAddress())).to.eq(
      ethers.parseUnits('100', 18) - amount,
    );
  });

  it('Should revert double claim', async () => {
    await expect(erc20Claim.claimTokens(deployer.address)).to.emit(erc20Claim, 'ERC20Claimed');
    expect(await erc20Claim.getClaimAmount(deployer.address)).to.eq(0);
    await expect(
      erc20Claim.connect(userA).claimTokens(deployer.address),
    ).to.revertedWithCustomError(erc20Claim, 'NoAllocation');
    await expect(erc20Claim.claimTokens(deployer.address)).to.revertedWithCustomError(
      erc20Claim,
      'NoAllocation',
    );
  });

  it('Should revert without an allocation', async () => {
    await expect(erc20Claim.claimTokens(userB.address)).to.revertedWithCustomError(
      erc20Claim,
      'NoAllocation',
    );
  });

  it('Should revert a non funder reclaim', async () => {
    await expect(erc20Claim.connect(userA).reclaim()).to.revertedWithCustomError(
      erc20Claim,
      'NotTheFunder',
    );
  });

  it('Should revert an unexpired reclaim', async () => {
    await expect(erc20Claim.connect(deployer).reclaim()).to.revertedWithCustomError(
      erc20Claim,
      'DeadlinePending',
    );
  });

  it('Should allow an expired reclaim', async () => {
    await time.advanceBlocks(5);
    await erc20Claim.connect(deployer).reclaim();
    expect(await childERC20.balanceOf(deployer.address)).to.eq(ethers.parseUnits('100', 18));
  });

  it('If the deadlineBlock is setup as zero, then calling reclaim will revert', async () => {
    const abiCoder2 = new ethers.AbiCoder();

    const childERC20SetupData2 =
      // eslint-disable-next-line camelcase
      VotesERC20__factory.createInterface().encodeFunctionData('setUp', [
        abiCoder2.encode(
          ['string', 'string', 'address[]', 'uint256[]'],
          [
            'ChildDecent',
            'cDCNT',
            [userB.address, deployer.address],
            [ethers.parseUnits('200', 18), ethers.parseUnits('200', 18)],
          ],
        ),
      ]);

    await moduleProxyFactory.deployModule(
      await votesERC20Mastercopy.getAddress(),
      childERC20SetupData2,
      '10031021',
    );

    const predictedChildVotesERC20Address = await calculateProxyAddress(
      moduleProxyFactory,
      await votesERC20Mastercopy.getAddress(),
      childERC20SetupData2,
      '10031021',
    );

    childERC20 = await hre.ethers.getContractAt('VotesERC20', predictedChildVotesERC20Address);

    const erc20ClaimSetupData2 =
      // eslint-disable-next-line camelcase
      VotesERC20__factory.createInterface().encodeFunctionData('setUp', [
        abiCoder2.encode(
          ['uint32', 'address', 'address', 'address', 'uint256'],
          [
            0,
            deployer.address,
            await parentERC20.getAddress(),
            await childERC20.getAddress(),
            ethers.parseUnits('100', 18),
          ],
        ),
      ]);

    const predictedERC20ClaimAddress = await calculateProxyAddress(
      moduleProxyFactory,
      await erc20ClaimMastercopy.getAddress(),
      erc20ClaimSetupData2,
      '10031021',
    );

    await childERC20
      .connect(deployer)
      .approve(predictedERC20ClaimAddress, ethers.parseUnits('100', 18));

    await moduleProxyFactory.deployModule(
      await erc20ClaimMastercopy.getAddress(),
      erc20ClaimSetupData2,
      '10031021',
    );

    erc20Claim = await hre.ethers.getContractAt('ERC20Claim', predictedERC20ClaimAddress);

    await expect(erc20Claim.connect(deployer).reclaim()).to.be.revertedWithCustomError(
      erc20Claim,
      'NoDeadline',
    );
  });
});
