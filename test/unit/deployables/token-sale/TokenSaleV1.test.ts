import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  TokenSaleV1,
  TokenSaleV1__factory,
  ERC1967Proxy__factory,
  MockERC20,
  MockERC20__factory,
  MockKYCVerifier,
  MockKYCVerifier__factory,
  ITokenSaleV1,
  ITokenSaleV1__factory,
  IVersion__factory,
  IDeploymentBlock__factory,
  IERC165__factory,
  VotingTokenLockupPlans,
  VotingTokenLockupPlans__factory,
} from '../../../../typechain-types';
import { runDeploymentBlockTests } from '../../shared/deploymentBlockTests';
import { runInitializerEventEmitterTests } from '../../shared/initializerEventEmitterTests';
import { runSupportsInterfaceTests } from '../../shared/supportsInterfaceTests';

// Test Constants
const TEST_CONSTANTS = {
  NATIVE_ASSET: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  PRECISION: ethers.parseEther('1'),
  DEFAULT_START_OFFSET: 3600,
  DEFAULT_END_OFFSET: 86400,
  SAFE_SIGNER_START_INDEX: 9,
};

// Sale State Enum
enum SaleState {
  NOT_STARTED = 0,
  ACTIVE = 1,
  SUCCEEDED = 2,
  FAILED = 3,
}

// Helper Functions
async function deployTokenSaleProxy(
  deployer: SignerWithAddress,
  params: ITokenSaleV1.InitializerParamsStruct,
): Promise<TokenSaleV1> {
  // Get saleToken and saleTokenHolder from params
  const saleToken = MockERC20__factory.connect(params.saleToken as string, deployer);
  const saleTokenHolder = await ethers.getSigner(params.saleTokenHolder as string);

  // Calculate required sale token amount
  const saleTokenAmount =
    (BigInt(params.maximumTotalCommitment) *
      (TEST_CONSTANTS.PRECISION + BigInt(params.saleTokenProtocolFee))) /
    BigInt(params.saleTokenPrice);

  // Deploy implementation
  const tokenSaleImplementation = await new TokenSaleV1__factory(deployer).deploy();
  const proxyFactory = new ERC1967Proxy__factory(deployer);

  // Calculate proxy address before deployment
  const nonce = await ethers.provider.getTransactionCount(deployer.address);
  const proxyAddress = ethers.getCreateAddress({ from: deployer.address, nonce });

  // Approve the proxy address
  await saleToken.connect(saleTokenHolder).approve(proxyAddress, saleTokenAmount);

  const initializeCalldata = tokenSaleImplementation.interface.encodeFunctionData('initialize', [
    params,
  ]);

  const proxy = await proxyFactory.deploy(
    await tokenSaleImplementation.getAddress(),
    initializeCalldata,
  );

  return TokenSaleV1__factory.connect(await proxy.getAddress(), deployer);
}

interface DeployTestSaleOptions {
  startOffset?: number;
  endOffset?: number;
  maximumTotalCommitment?: bigint;
  minimumTotalCommitment?: bigint;
  commitmentToken?: string;
  commitmentTokenProtocolFee?: bigint;
  saleTokenProtocolFee?: bigint;
  minimumCommitment?: bigint;
  maximumCommitment?: bigint;
  saleTokenPrice?: bigint;
  hedgeyLockupParams?: ITokenSaleV1.HedgeyLockupParamsStruct;
}

async function deployTestSale(
  deployer: SignerWithAddress,
  saleToken: MockERC20,
  saleTokenHolder: SignerWithAddress,
  baseParams: ITokenSaleV1.InitializerParamsStruct,
  options: DeployTestSaleOptions = {},
): Promise<TokenSaleV1> {
  const currentTime = await time.latest();
  const params = {
    ...baseParams,
    saleStartTimestamp: BigInt(
      currentTime + (options.startOffset ?? TEST_CONSTANTS.DEFAULT_START_OFFSET),
    ),
    saleEndTimestamp: BigInt(
      currentTime + (options.endOffset ?? TEST_CONSTANTS.DEFAULT_END_OFFSET),
    ),
    ...(options.maximumTotalCommitment && {
      maximumTotalCommitment: options.maximumTotalCommitment,
    }),
    ...(options.minimumTotalCommitment && {
      minimumTotalCommitment: options.minimumTotalCommitment,
    }),
    ...(options.commitmentToken && { commitmentToken: options.commitmentToken }),
    ...(options.commitmentTokenProtocolFee && {
      commitmentTokenProtocolFee: options.commitmentTokenProtocolFee,
    }),
    ...(options.saleTokenProtocolFee && { saleTokenProtocolFee: options.saleTokenProtocolFee }),
    ...(options.minimumCommitment && { minimumCommitment: options.minimumCommitment }),
    ...(options.maximumCommitment && { maximumCommitment: options.maximumCommitment }),
    ...(options.saleTokenPrice && { saleTokenPrice: options.saleTokenPrice }),
    ...(options.hedgeyLockupParams && { hedgeyLockupParams: options.hedgeyLockupParams }),
  };

  // Calculate and mint required sale tokens
  const requiredSaleTokens =
    (BigInt(params.maximumTotalCommitment) *
      (TEST_CONSTANTS.PRECISION + BigInt(params.saleTokenProtocolFee))) /
    BigInt(params.saleTokenPrice);
  await saleToken.mint(saleTokenHolder.address, requiredSaleTokens);

  return deployTokenSaleProxy(deployer, params);
}

async function mintAndApproveCommitmentTokens(
  commitmentToken: MockERC20,
  sale: TokenSaleV1,
  users: SignerWithAddress[],
  amounts: bigint[],
): Promise<void> {
  const saleAddress = await sale.getAddress();
  for (let i = 0; i < users.length; i++) {
    await commitmentToken.mint(users[i].address, amounts[i]);
    await commitmentToken.connect(users[i]).approve(saleAddress, amounts[i]);
  }
}

async function reachMinimumTotalCommitment(
  sale: TokenSaleV1,
  commitmentToken: MockERC20,
  minimumTotalCommitment: bigint,
  maximumCommitment: bigint,
  initialCommitters: { user: SignerWithAddress; amount: bigint }[] = [],
): Promise<void> {
  let totalCommitted = 0n;

  // Process initial committers
  for (const { amount } of initialCommitters) {
    totalCommitted += amount;
  }

  // Fill remaining with additional signers
  const signers = await ethers.getSigners();
  let signerIndex = TEST_CONSTANTS.SAFE_SIGNER_START_INDEX;

  while (totalCommitted < minimumTotalCommitment) {
    const user = signers[signerIndex++];
    const remaining = minimumTotalCommitment - totalCommitted;
    const toCommit = remaining > maximumCommitment ? maximumCommitment : remaining;

    await commitmentToken.mint(user.address, toCommit);
    await commitmentToken.connect(user).approve(await sale.getAddress(), toCommit);
    await sale.connect(user).increaseCommitmentERC20(toCommit, ethers.getBytes('0x'), 0n);

    totalCommitted += toCommit;
  }
}

async function moveToSaleEnd(sale: TokenSaleV1): Promise<void> {
  const endTimestamp = await sale.saleEndTimestamp();
  await time.increaseTo(Number(endTimestamp) + 1);
}

async function moveToSaleStart(sale: TokenSaleV1): Promise<void> {
  const startTimestamp = await sale.saleStartTimestamp();
  await time.increaseTo(Number(startTimestamp));
}

async function expectSaleState(sale: TokenSaleV1, expectedState: SaleState): Promise<void> {
  expect(await sale.saleState()).to.equal(BigInt(expectedState));
}

function getLockupPlanCreatedEvent(
  receipt: any,
  votingTokenLockupPlans: VotingTokenLockupPlans,
): any | null {
  const planCreatedEvent = receipt?.logs?.find((log: any) => {
    try {
      const parsed = votingTokenLockupPlans.interface.parseLog(log);
      return parsed?.name === 'PlanCreated';
    } catch {
      return false;
    }
  });

  if (planCreatedEvent) {
    const parsedEvent = votingTokenLockupPlans.interface.parseLog(planCreatedEvent);
    return {
      planId: parsedEvent?.args?.[0],
      recipient: parsedEvent?.args?.[1],
      token: parsedEvent?.args?.[2],
      amount: parsedEvent?.args?.[3],
      start: parsedEvent?.args?.[4],
      cliff: parsedEvent?.args?.[5],
      end: parsedEvent?.args?.[6],
      rate: parsedEvent?.args?.[7],
      period: parsedEvent?.args?.[8],
    };
  }

  return null;
}

describe('TokenSaleV1', () => {
  let deployer: SignerWithAddress;
  let seller: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;
  let saleProceedsReceiver: SignerWithAddress;
  let protocolFeeReceiver: SignerWithAddress;
  let saleTokenHolder: SignerWithAddress;
  let nonCommitter: SignerWithAddress;

  let tokenSale: TokenSaleV1;
  let saleToken: MockERC20;
  let commitmentToken: MockERC20;
  let kycVerifier: MockKYCVerifier;
  let votingTokenLockupPlans: VotingTokenLockupPlans; // Hedgey contract

  let defaultParams: ITokenSaleV1.InitializerParamsStruct;

  beforeEach(async () => {
    [
      deployer,
      seller,
      alice,
      bob,
      charlie,
      saleProceedsReceiver,
      protocolFeeReceiver,
      saleTokenHolder,
      nonCommitter,
    ] = await ethers.getSigners();

    // Deploy mock contracts
    const MockERC20Factory = new MockERC20__factory(deployer);
    const MockKYCVerifierFactory = new MockKYCVerifier__factory(deployer);

    saleToken = await MockERC20Factory.deploy('Sale Token', 'SALE', 18);
    commitmentToken = await MockERC20Factory.deploy('Commitment Token', 'COMMIT', 18);
    kycVerifier = await MockKYCVerifierFactory.deploy();

    // Deploy Hedgey VotingTokenLockupPlans contract
    votingTokenLockupPlans = await new VotingTokenLockupPlans__factory(deployer).deploy(
      'VotingTokenLockupPlans',
      'VTLP',
    );

    // Mint tokens to sale token holder
    await saleToken.mint(saleTokenHolder.address, ethers.parseEther('1050000'));

    // Setup default parameters
    const currentTime = await time.latest();
    defaultParams = {
      saleStartTimestamp: BigInt(currentTime + 3600), // 1 hour from now
      saleEndTimestamp: BigInt(currentTime + 86400), // 24 hours from now
      saleTokenHolder: saleTokenHolder.address,
      commitmentToken: await commitmentToken.getAddress(),
      saleToken: await saleToken.getAddress(),
      kycVerifier: await kycVerifier.getAddress(),
      saleProceedsReceiver: saleProceedsReceiver.address,
      protocolFeeReceiver: protocolFeeReceiver.address,
      minimumCommitment: ethers.parseEther('10'),
      maximumCommitment: ethers.parseEther('1000'),
      minimumTotalCommitment: ethers.parseEther('10000'),
      maximumTotalCommitment: ethers.parseEther('100000'),
      saleTokenPrice: ethers.parseEther('0.1'), // 0.1 commitment token per sale token
      commitmentTokenProtocolFee: ethers.parseEther('0.02'), // 2%
      saleTokenProtocolFee: ethers.parseEther('0.05'), // 5%
      hedgeyLockupParams: {
        enabled: false,
        start: 0,
        cliff: 0,
        ratePercentage: 0,
        period: 0,
        votingTokenLockupPlans: ethers.ZeroAddress,
      },
    };

    // Enable KYC for test accounts
    await kycVerifier.setVerify(true);
  });

  describe('Proxy Deployment & Initialization', () => {
    it('should deploy and initialize properly with valid parameters', async () => {
      tokenSale = await deployTokenSaleProxy(deployer, defaultParams);

      // Verify all parameters are set correctly
      expect(await tokenSale.saleStartTimestamp()).to.equal(defaultParams.saleStartTimestamp);
      expect(await tokenSale.saleEndTimestamp()).to.equal(defaultParams.saleEndTimestamp);
      expect(await tokenSale.commitmentToken()).to.equal(defaultParams.commitmentToken);
      expect(await tokenSale.saleToken()).to.equal(defaultParams.saleToken);
      expect(await tokenSale.kycVerifier()).to.equal(defaultParams.kycVerifier);
      expect(await tokenSale.saleProceedsReceiver()).to.equal(defaultParams.saleProceedsReceiver);
      expect(await tokenSale.protocolFeeReceiver()).to.equal(defaultParams.protocolFeeReceiver);
      expect(await tokenSale.minimumCommitment()).to.equal(defaultParams.minimumCommitment);
      expect(await tokenSale.maximumCommitment()).to.equal(defaultParams.maximumCommitment);
      expect(await tokenSale.minimumTotalCommitment()).to.equal(
        defaultParams.minimumTotalCommitment,
      );
      expect(await tokenSale.maximumTotalCommitment()).to.equal(
        defaultParams.maximumTotalCommitment,
      );
      expect(await tokenSale.saleTokenPrice()).to.equal(defaultParams.saleTokenPrice);
      expect(await tokenSale.commitmentTokenProtocolFee()).to.equal(
        defaultParams.commitmentTokenProtocolFee,
      );
      expect(await tokenSale.saleTokenProtocolFee()).to.equal(defaultParams.saleTokenProtocolFee);
      expect(await tokenSale.hedgeyLockupEnabled()).to.equal(
        defaultParams.hedgeyLockupParams.enabled,
      );
      expect(await tokenSale.hedgeyLockupStart()).to.equal(defaultParams.hedgeyLockupParams.start);
      expect(await tokenSale.hedgeyLockupCliff()).to.equal(defaultParams.hedgeyLockupParams.cliff);
      expect(await tokenSale.hedgeyLockupRatePercentage()).to.equal(
        defaultParams.hedgeyLockupParams.ratePercentage,
      );
      expect(await tokenSale.hedgeyLockupPeriod()).to.equal(
        defaultParams.hedgeyLockupParams.period,
      );
      expect(await tokenSale.hedgeyVotingTokenLockupPlans()).to.equal(
        defaultParams.hedgeyLockupParams.votingTokenLockupPlans,
      );

      // Verify sale tokens were transferred to the contract
      const expectedSaleTokenAmount =
        (BigInt(defaultParams.maximumTotalCommitment) *
          (TEST_CONSTANTS.PRECISION + BigInt(defaultParams.saleTokenProtocolFee))) /
        BigInt(defaultParams.saleTokenPrice);

      expect(await saleToken.balanceOf(await tokenSale.getAddress())).to.equal(
        expectedSaleTokenAmount,
      );
    });

    it('should revert when saleStartTimestamp > saleEndTimestamp', async () => {
      const invalidParams = {
        ...defaultParams,
        saleStartTimestamp: BigInt(defaultParams.saleEndTimestamp) + 1n,
      };

      await expect(deployTokenSaleProxy(deployer, invalidParams)).to.be.revertedWithCustomError(
        TokenSaleV1__factory.connect(ethers.ZeroAddress, deployer),
        'InvalidSaleTimestamps',
      );
    });

    it('should revert when saleStartTimestamp < block.timestamp', async () => {
      const currentTime = await time.latest();
      const invalidParams = {
        ...defaultParams,
        saleStartTimestamp: currentTime - 1,
      };

      await expect(deployTokenSaleProxy(deployer, invalidParams)).to.be.revertedWithCustomError(
        TokenSaleV1__factory.connect(ethers.ZeroAddress, deployer),
        'InvalidSaleStartTimestamp',
      );
    });

    it('should revert when minimumCommitment > maximumCommitment', async () => {
      const invalidParams = {
        ...defaultParams,
        minimumCommitment: BigInt(defaultParams.maximumCommitment) + 1n,
      };

      await expect(deployTokenSaleProxy(deployer, invalidParams)).to.be.revertedWithCustomError(
        TokenSaleV1__factory.connect(ethers.ZeroAddress, deployer),
        'InvalidCommitmentAmounts',
      );
    });

    it('should revert when minimumTotalCommitment > maximumTotalCommitment', async () => {
      const invalidParams = {
        ...defaultParams,
        minimumTotalCommitment: BigInt(defaultParams.maximumTotalCommitment) + 1n,
      };

      await expect(deployTokenSaleProxy(deployer, invalidParams)).to.be.revertedWithCustomError(
        TokenSaleV1__factory.connect(ethers.ZeroAddress, deployer),
        'InvalidTotalCommitmentAmounts',
      );
    });

    it('should revert when commitmentTokenProtocolFee > TEST_CONSTANTS.PRECISION', async () => {
      const invalidParams = {
        ...defaultParams,
        commitmentTokenProtocolFee: TEST_CONSTANTS.PRECISION + 1n,
      };

      await expect(deployTokenSaleProxy(deployer, invalidParams)).to.be.revertedWithCustomError(
        TokenSaleV1__factory.connect(ethers.ZeroAddress, deployer),
        'InvalidProtocolFee',
      );
    });

    it('should revert when saleTokenProtocolFee > TEST_CONSTANTS.PRECISION', async () => {
      const invalidParams = {
        ...defaultParams,
        saleTokenProtocolFee: TEST_CONSTANTS.PRECISION + 1n,
      };

      await expect(deployTokenSaleProxy(deployer, invalidParams)).to.be.revertedWithCustomError(
        TokenSaleV1__factory.connect(ethers.ZeroAddress, deployer),
        'InvalidProtocolFee',
      );
    });

    it('should revert when Hedgey lockup is enabled with invalid parameters', async () => {
      const currentTime = await time.latest();
      const invalidHedgeyParams = {
        ...defaultParams,
        hedgeyLockupParams: {
          enabled: true,
          start: BigInt(currentTime),
          cliff: BigInt(currentTime + 1_000_000),
          ratePercentage: 0, // Invalid: rate cannot be zero
          period: 10_000,
          votingTokenLockupPlans: await votingTokenLockupPlans.getAddress(),
        },
      };

      await expect(
        deployTokenSaleProxy(deployer, invalidHedgeyParams),
      ).to.be.revertedWithCustomError(
        TokenSaleV1__factory.connect(ethers.ZeroAddress, deployer),
        'InvalidRate',
      );
    });

    it('should revert when Hedgey lockup rate exceeds amount', async () => {
      const currentTime = await time.latest();
      const invalidHedgeyParams = {
        ...defaultParams,
        hedgeyLockupParams: {
          enabled: true,
          start: BigInt(currentTime),
          cliff: BigInt(currentTime + 1_000_000),
          ratePercentage: ethers.parseEther('1.1'), // Rate exceeds the calculated amount
          period: 10_000,
          votingTokenLockupPlans: await votingTokenLockupPlans.getAddress(),
        },
      };

      await expect(
        deployTokenSaleProxy(deployer, invalidHedgeyParams),
      ).to.be.revertedWithCustomError(
        TokenSaleV1__factory.connect(ethers.ZeroAddress, deployer),
        'RateExceedsAmount',
      );
    });

    it('should revert when Hedgey lockup period is zero', async () => {
      const currentTime = await time.latest();
      const invalidHedgeyParams = {
        ...defaultParams,
        hedgeyLockupParams: {
          enabled: true,
          start: BigInt(currentTime),
          cliff: BigInt(currentTime + 1_000_000),
          ratePercentage: ethers.parseEther('0.0025'),
          period: 0, // Invalid: period cannot be zero
          votingTokenLockupPlans: await votingTokenLockupPlans.getAddress(),
        },
      };

      await expect(
        deployTokenSaleProxy(deployer, invalidHedgeyParams),
      ).to.be.revertedWithCustomError(
        TokenSaleV1__factory.connect(ethers.ZeroAddress, deployer),
        'InvalidPeriod',
      );
    });

    it('should revert when Hedgey lockup cliff exceeds end time', async () => {
      const currentTime = await time.latest();
      const invalidHedgeyParams = {
        ...defaultParams,
        hedgeyLockupParams: {
          enabled: true,
          start: BigInt(currentTime),
          cliff: BigInt(currentTime + 4_000_001), // calculated end period should be 4_000_000
          ratePercentage: ethers.parseEther('0.0025'),
          period: 10_000,
          votingTokenLockupPlans: await votingTokenLockupPlans.getAddress(),
        },
      };

      await expect(
        deployTokenSaleProxy(deployer, invalidHedgeyParams),
      ).to.be.revertedWithCustomError(
        TokenSaleV1__factory.connect(ethers.ZeroAddress, deployer),
        'CliffExceedsEnd',
      );
    });

    it('should prevent double initialization', async () => {
      tokenSale = await deployTokenSaleProxy(deployer, defaultParams);

      await expect(tokenSale.initialize(defaultParams)).to.be.revertedWithCustomError(
        tokenSale,
        'InvalidInitialization',
      );
    });
  });

  describe('Sale State Transitions', () => {
    beforeEach(async () => {
      tokenSale = await deployTokenSaleProxy(deployer, defaultParams);
    });

    it('should return NOT_STARTED when block.timestamp < saleStartTimestamp', async () => {
      await expectSaleState(tokenSale, SaleState.NOT_STARTED);
    });

    it('should return ACTIVE when sale is ongoing', async () => {
      await moveToSaleStart(tokenSale);
      await expectSaleState(tokenSale, SaleState.ACTIVE);
    });

    it('should return SUCCEEDED when totalCommitments >= maximumTotalCommitment', async () => {
      // Deploy a sale with smaller maximum total that we can reach with available signers
      const succeededSale = await deployTestSale(
        deployer,
        saleToken,
        saleTokenHolder,
        defaultParams,
        {
          maximumTotalCommitment: ethers.parseEther('10000'), // 10 users at 1000 each
        },
      );
      await moveToSaleStart(succeededSale);

      // Fill the sale to exactly maximum total
      const signers = await ethers.getSigners();
      for (let i = 0; i < 10; i++) {
        const user = signers[i + 2]; // Skip deployer and owner
        await commitmentToken.mint(user.address, defaultParams.maximumCommitment);
        await commitmentToken
          .connect(user)
          .approve(await succeededSale.getAddress(), defaultParams.maximumCommitment);
        await succeededSale
          .connect(user)
          .increaseCommitmentERC20(defaultParams.maximumCommitment, ethers.getBytes('0x'), 0n);
      }

      expect(await succeededSale.totalCommitments()).to.equal(ethers.parseEther('10000'));
      await expectSaleState(succeededSale, SaleState.SUCCEEDED);
    });

    it('should return SUCCEEDED when sale ended and totalCommitments >= minimumTotalCommitment', async () => {
      await moveToSaleStart(tokenSale);

      // Setup initial commitments
      await mintAndApproveCommitmentTokens(
        commitmentToken,
        tokenSale,
        [alice, bob],
        [BigInt(defaultParams.minimumTotalCommitment), BigInt(defaultParams.maximumCommitment)],
      );

      // Alice commits minimum per user
      await tokenSale
        .connect(alice)
        .increaseCommitmentERC20(defaultParams.minimumCommitment, ethers.getBytes('0x'), 0n);

      // Bob commits the rest
      await tokenSale
        .connect(bob)
        .increaseCommitmentERC20(defaultParams.maximumCommitment, ethers.getBytes('0x'), 0n);

      // Reach minimum total commitment
      await reachMinimumTotalCommitment(
        tokenSale,
        commitmentToken,
        BigInt(defaultParams.minimumTotalCommitment),
        BigInt(defaultParams.maximumCommitment),
        [
          { user: alice, amount: BigInt(defaultParams.minimumCommitment) },
          { user: bob, amount: BigInt(defaultParams.maximumCommitment) },
        ],
      );

      // Move past sale end
      await moveToSaleEnd(tokenSale);

      await expectSaleState(tokenSale, SaleState.SUCCEEDED);
    });

    it('should return FAILED when sale ended and totalCommitments < minimumTotalCommitment', async () => {
      await moveToSaleStart(tokenSale);

      // Commit less than minimum total
      await mintAndApproveCommitmentTokens(
        commitmentToken,
        tokenSale,
        [alice],
        [BigInt(defaultParams.minimumCommitment)],
      );
      await tokenSale
        .connect(alice)
        .increaseCommitmentERC20(defaultParams.minimumCommitment, ethers.getBytes('0x'), 0n);

      // Move past sale end
      await moveToSaleEnd(tokenSale);

      await expectSaleState(tokenSale, SaleState.FAILED);
    });

    it('should handle edge case at exact saleStartTimestamp', async () => {
      await time.increaseTo(Number(defaultParams.saleStartTimestamp) - 1);
      await expectSaleState(tokenSale, SaleState.NOT_STARTED);

      await time.increaseTo(Number(defaultParams.saleStartTimestamp));
      await expectSaleState(tokenSale, SaleState.ACTIVE);
    });

    it('should handle edge case at exact saleEndTimestamp', async () => {
      await time.increaseTo(defaultParams.saleEndTimestamp);
      // Still active at exact end timestamp if not enough commitments
      await expectSaleState(tokenSale, SaleState.ACTIVE);

      await time.increaseTo(Number(defaultParams.saleEndTimestamp) + 1);
      // Failed after end timestamp with no commitments
      await expectSaleState(tokenSale, SaleState.FAILED);
    });
  });

  describe('Commitment Increase - ERC20 Token', () => {
    beforeEach(async () => {
      tokenSale = await deployTokenSaleProxy(deployer, defaultParams);
      await moveToSaleStart(tokenSale);

      // Setup commitment tokens for test accounts
      await mintAndApproveCommitmentTokens(
        commitmentToken,
        tokenSale,
        [alice, bob],
        [ethers.parseEther('10000'), ethers.parseEther('10000')],
      );
    });

    it('should allow first commitment by user', async () => {
      const commitAmount = ethers.parseEther('100');
      await expect(
        tokenSale.connect(alice).increaseCommitmentERC20(commitAmount, ethers.getBytes('0x'), 0n),
      )
        .to.emit(tokenSale, 'CommitmentIncreased')
        .withArgs(alice.address, commitAmount);

      expect(await tokenSale.commitments(alice.address)).to.equal(commitAmount);
      expect(await tokenSale.totalCommitments()).to.equal(commitAmount);
    });

    it('should allow increasing existing commitment', async () => {
      const firstCommit = ethers.parseEther('100');
      const secondCommit = ethers.parseEther('200');

      await tokenSale
        .connect(alice)
        .increaseCommitmentERC20(firstCommit, ethers.getBytes('0x'), 0n);
      await tokenSale
        .connect(alice)
        .increaseCommitmentERC20(secondCommit, ethers.getBytes('0x'), 0n);

      expect(await tokenSale.commitments(alice.address)).to.equal(firstCommit + secondCommit);
      expect(await tokenSale.totalCommitments()).to.equal(firstCommit + secondCommit);
    });

    it('should allow commitment that reaches exactly minimumCommitment', async () => {
      await tokenSale
        .connect(alice)
        .increaseCommitmentERC20(defaultParams.minimumCommitment, ethers.getBytes('0x'), 0n);
      expect(await tokenSale.commitments(alice.address)).to.equal(defaultParams.minimumCommitment);
    });

    it('should allow commitment that reaches exactly maximumCommitment', async () => {
      await tokenSale
        .connect(alice)
        .increaseCommitmentERC20(defaultParams.maximumCommitment, ethers.getBytes('0x'), 0n);
      expect(await tokenSale.commitments(alice.address)).to.equal(defaultParams.maximumCommitment);
    });

    it('should allow commitment that makes totalCommitments reach exactly maximumTotalCommitment', async () => {
      // Test with smaller values to work with limited signers
      const testSale = await deployTestSale(deployer, saleToken, saleTokenHolder, defaultParams, {
        minimumTotalCommitment: ethers.parseEther('1000'),
        maximumTotalCommitment: ethers.parseEther('5000'), // 5 users at 1000 each
      });
      await moveToSaleStart(testSale);

      // Use 5 users to reach exactly 5000 commitment tokens total
      const signers = await ethers.getSigners();
      const users = [alice, bob, charlie, signers[5], signers[6]];
      const commitmentPerUser = ethers.parseEther('1000');

      await mintAndApproveCommitmentTokens(
        commitmentToken,
        testSale,
        users,
        Array(users.length).fill(commitmentPerUser),
      );

      for (const user of users) {
        await testSale
          .connect(user)
          .increaseCommitmentERC20(commitmentPerUser, ethers.getBytes('0x'), 0n);
      }

      expect(await testSale.totalCommitments()).to.equal(ethers.parseEther('5000'));
      await expectSaleState(testSale, SaleState.SUCCEEDED);
    });

    it('should revert when using ERC20 function with native asset commitment token', async () => {
      const nativeSale = await deployTestSale(deployer, saleToken, saleTokenHolder, defaultParams, {
        commitmentToken: TEST_CONSTANTS.NATIVE_ASSET,
      });
      await moveToSaleStart(nativeSale);

      await expect(
        nativeSale
          .connect(alice)
          .increaseCommitmentERC20(ethers.parseEther('100'), ethers.getBytes('0x'), 0n),
      ).to.be.revertedWithCustomError(nativeSale, 'InvalidCommitmentToken');
    });

    it('should revert when sale has not started', async () => {
      const freshSale = await deployTestSale(
        deployer,
        saleToken,
        saleTokenHolder,
        defaultParams,
        {},
      );
      // Don't time travel - sale hasn't started yet

      await expect(
        freshSale
          .connect(alice)
          .increaseCommitmentERC20(ethers.parseEther('100'), ethers.getBytes('0x'), 0n),
      ).to.be.revertedWithCustomError(freshSale, 'SaleNotActive');
    });

    it('should revert when sale has ended', async () => {
      await time.increaseTo(Number(defaultParams.saleEndTimestamp) + 1);

      await expect(
        tokenSale
          .connect(alice)
          .increaseCommitmentERC20(ethers.parseEther('100'), ethers.getBytes('0x'), 0n),
      ).to.be.revertedWithCustomError(tokenSale, 'SaleNotActive');
    });

    it('should revert when increaseAmount is 0', async () => {
      await expect(
        tokenSale.connect(alice).increaseCommitmentERC20(0, ethers.getBytes('0x'), 0n),
      ).to.be.revertedWithCustomError(tokenSale, 'ZeroAmount');
    });

    it('should revert when increase would exceed maximumTotalCommitment', async () => {
      // Create a fresh sale with smaller limits for easier testing
      const exceedSale = await deployTestSale(deployer, saleToken, saleTokenHolder, defaultParams, {
        minimumTotalCommitment: ethers.parseEther('100'),
        maximumTotalCommitment: ethers.parseEther('200'),
      });
      await moveToSaleStart(exceedSale);

      // Alice commits 150 ETH (within her per-user limit but leaves only 50 ETH room)
      await mintAndApproveCommitmentTokens(
        commitmentToken,
        exceedSale,
        [alice],
        [ethers.parseEther('150')],
      );
      await exceedSale
        .connect(alice)
        .increaseCommitmentERC20(ethers.parseEther('150'), ethers.getBytes('0x'), 0n);

      // Bob tries to commit 60 ETH which would exceed total maximum
      await mintAndApproveCommitmentTokens(
        commitmentToken,
        exceedSale,
        [bob],
        [ethers.parseEther('60')],
      );

      await expect(
        exceedSale
          .connect(bob)
          .increaseCommitmentERC20(ethers.parseEther('60'), ethers.getBytes('0x'), 0n),
      ).to.be.revertedWithCustomError(exceedSale, 'MaximumTotalCommitment');

      // Bob can commit exactly 50 ETH to reach the maximum
      await exceedSale
        .connect(bob)
        .increaseCommitmentERC20(ethers.parseEther('50'), ethers.getBytes('0x'), 0n);
      expect(await exceedSale.totalCommitments()).to.equal(ethers.parseEther('200'));
    });

    it('should revert when new commitment < minimumCommitment', async () => {
      const tooSmall = BigInt(defaultParams.minimumCommitment) - ethers.parseEther('1');
      await expect(
        tokenSale.connect(alice).increaseCommitmentERC20(tooSmall, ethers.getBytes('0x'), 0n),
      ).to.be.revertedWithCustomError(tokenSale, 'MinimumCommitment');
    });

    it('should revert when new commitment > maximumCommitment per user', async () => {
      const tooMuch = BigInt(defaultParams.maximumCommitment) + ethers.parseEther('1');
      await expect(
        tokenSale.connect(alice).increaseCommitmentERC20(tooMuch, ethers.getBytes('0x'), 0n),
      ).to.be.revertedWithCustomError(tokenSale, 'MaximumCommitment');
    });

    it('should revert when KYC verification fails', async () => {
      await kycVerifier.setVerify(false);

      await expect(
        tokenSale
          .connect(alice)
          .increaseCommitmentERC20(ethers.parseEther('100'), ethers.getBytes('0x'), 0n),
      ).to.be.revertedWithCustomError(kycVerifier, 'InvalidSignature');
    });
  });

  describe('Commitment Increase - Native Asset (ETH)', () => {
    let nativeSale: TokenSaleV1;

    beforeEach(async () => {
      const nativeParams = { ...defaultParams, commitmentToken: TEST_CONSTANTS.NATIVE_ASSET };
      nativeSale = await deployTokenSaleProxy(deployer, nativeParams);
      await moveToSaleStart(nativeSale);
    });

    it('should allow first commitment by user with native asset', async () => {
      const commitAmount = ethers.parseEther('100');
      await expect(
        nativeSale
          .connect(alice)
          .increaseCommitmentNative(ethers.getBytes('0x'), 0n, { value: commitAmount }),
      )
        .to.emit(nativeSale, 'CommitmentIncreased')
        .withArgs(alice.address, commitAmount);

      expect(await nativeSale.commitments(alice.address)).to.equal(commitAmount);
      expect(await nativeSale.totalCommitments()).to.equal(commitAmount);
      expect(await ethers.provider.getBalance(await nativeSale.getAddress())).to.equal(
        commitAmount,
      );
    });

    it('should revert when using native function with ERC20 commitment token', async () => {
      // Create a fresh ERC20-based sale
      const erc20Sale = await deployTestSale(deployer, saleToken, saleTokenHolder, defaultParams, {
        startOffset: 60,
      });
      await moveToSaleStart(erc20Sale);

      await expect(
        erc20Sale
          .connect(alice)
          .increaseCommitmentNative(ethers.getBytes('0x'), 0n, { value: ethers.parseEther('100') }),
      ).to.be.revertedWithCustomError(erc20Sale, 'InvalidCommitmentToken');
    });

    it('should enforce same validation rules as ERC20', async () => {
      // Test minimum commitment
      await expect(
        nativeSale.connect(alice).increaseCommitmentNative(ethers.getBytes('0x'), 0n, {
          value: BigInt(defaultParams.minimumCommitment) - 1n,
        }),
      ).to.be.revertedWithCustomError(nativeSale, 'MinimumCommitment');

      // Test maximum commitment
      await expect(
        nativeSale.connect(alice).increaseCommitmentNative(ethers.getBytes('0x'), 0n, {
          value: BigInt(defaultParams.maximumCommitment) + 1n,
        }),
      ).to.be.revertedWithCustomError(nativeSale, 'MaximumCommitment');
    });
  });

  describe('User Settlement - Success Case with Hedgey Lockup', () => {
    let hedgeySale: TokenSaleV1;
    let lockupStartTime: number;

    beforeEach(async () => {
      lockupStartTime = await time.latest();

      const hedgeyParams = {
        ...defaultParams,
        hedgeyLockupParams: {
          enabled: true,
          start: BigInt(lockupStartTime),
          cliff: BigInt(lockupStartTime + 1_000_000),
          ratePercentage: ethers.parseEther('0.0025'),
          period: 10_000,
          votingTokenLockupPlans: await votingTokenLockupPlans.getAddress(),
        },
      };

      hedgeySale = await deployTestSale(deployer, saleToken, saleTokenHolder, hedgeyParams, {
        startOffset: 60,
      });
      await moveToSaleStart(hedgeySale);

      // Setup commitments
      await mintAndApproveCommitmentTokens(
        commitmentToken,
        hedgeySale,
        [alice, bob],
        [ethers.parseEther('50000'), ethers.parseEther('50000')],
      );

      // Make enough commitments to succeed
      await hedgeySale
        .connect(alice)
        .increaseCommitmentERC20(defaultParams.minimumCommitment, ethers.getBytes('0x'), 0n);
      await hedgeySale
        .connect(bob)
        .increaseCommitmentERC20(defaultParams.maximumCommitment, ethers.getBytes('0x'), 0n);

      // Reach minimum total commitment
      await reachMinimumTotalCommitment(
        hedgeySale,
        commitmentToken,
        BigInt(defaultParams.minimumTotalCommitment),
        BigInt(defaultParams.maximumCommitment),
        [
          { user: alice, amount: BigInt(defaultParams.minimumCommitment) },
          { user: bob, amount: BigInt(defaultParams.maximumCommitment) },
        ],
      );

      // Move to end of sale
      await moveToSaleEnd(hedgeySale);
    });

    it('should create Hedgey lockup plan instead of direct transfer when enabled', async () => {
      const commitment = await hedgeySale.commitments(alice.address);
      const expectedSaleTokens =
        (BigInt(commitment) * TEST_CONSTANTS.PRECISION) / BigInt(defaultParams.saleTokenPrice);

      // Get initial balances
      const initialSaleTokenBalance = await saleToken.balanceOf(await hedgeySale.getAddress());
      const initialHedgeyBalance = await saleToken.balanceOf(
        await votingTokenLockupPlans.getAddress(),
      );

      // Capture the PlanCreated event from the Hedgey contract
      const tx = await hedgeySale.connect(alice).buyerSettle(alice.address);
      const receipt = await tx.wait();

      // Extract and log the PlanCreated event
      const lockupPlanId = getLockupPlanCreatedEvent(receipt, votingTokenLockupPlans).planId;

      const lockupPlan = await votingTokenLockupPlans.plans(lockupPlanId);

      expect(lockupPlan.token).to.equal(await saleToken.getAddress());
      expect(lockupPlan.amount).to.equal(expectedSaleTokens);
      expect(lockupPlan.start).to.equal(BigInt(lockupStartTime));
      expect(lockupPlan.cliff).to.equal(BigInt(lockupStartTime + 1_000_000));
      expect(lockupPlan.period).to.equal(BigInt(10_000));
      expect(lockupPlan.rate).to.equal(
        (expectedSaleTokens * ethers.parseEther('0.0025')) / TEST_CONSTANTS.PRECISION,
      );

      // verify correct end time
      expect(await votingTokenLockupPlans.planEnd(lockupPlanId)).to.equal(
        BigInt(lockupStartTime + 4_000_000),
      );

      // Verify sale tokens were transferred to Hedgey contract
      expect(await saleToken.balanceOf(await hedgeySale.getAddress())).to.equal(
        initialSaleTokenBalance - expectedSaleTokens,
      );
      expect(await saleToken.balanceOf(await votingTokenLockupPlans.getAddress())).to.equal(
        initialHedgeyBalance + expectedSaleTokens,
      );

      // Verify user didn't receive tokens directly
      expect(await saleToken.balanceOf(alice.address)).to.equal(0);
      expect(await hedgeySale.settled(alice.address)).to.be.true;
    });

    it('should create Hedgey lockup plans for multiple users', async () => {
      const aliceCommitment = await hedgeySale.commitments(alice.address);
      const bobCommitment = await hedgeySale.commitments(bob.address);

      const aliceExpectedSaleTokens =
        (BigInt(aliceCommitment) * TEST_CONSTANTS.PRECISION) / BigInt(defaultParams.saleTokenPrice);

      const bobExpectedSaleTokens =
        (BigInt(bobCommitment) * TEST_CONSTANTS.PRECISION) / BigInt(defaultParams.saleTokenPrice);

      // Settle and get lockup plan IDs
      const aliceLockupPlanId = getLockupPlanCreatedEvent(
        await (await hedgeySale.connect(alice).buyerSettle(alice.address)).wait(),
        votingTokenLockupPlans,
      ).planId;
      const bobLockupPlanId = getLockupPlanCreatedEvent(
        await (await hedgeySale.connect(bob).buyerSettle(bob.address)).wait(),
        votingTokenLockupPlans,
      ).planId;

      // Get lockup plan objects
      const aliceLockupPlan = await votingTokenLockupPlans.plans(aliceLockupPlanId);
      const bobLockupPlan = await votingTokenLockupPlans.plans(bobLockupPlanId);

      // Verify lockup plans
      expect(aliceLockupPlan.token).to.equal(await saleToken.getAddress());
      expect(aliceLockupPlan.amount).to.equal(aliceExpectedSaleTokens);
      expect(aliceLockupPlan.start).to.equal(BigInt(lockupStartTime));
      expect(aliceLockupPlan.cliff).to.equal(BigInt(lockupStartTime + 1_000_000));
      expect(aliceLockupPlan.period).to.equal(BigInt(10_000));

      expect(bobLockupPlan.token).to.equal(await saleToken.getAddress());
      expect(bobLockupPlan.amount).to.equal(bobExpectedSaleTokens);
      expect(bobLockupPlan.start).to.equal(BigInt(lockupStartTime));
      expect(bobLockupPlan.cliff).to.equal(BigInt(lockupStartTime + 1_000_000));
      expect(bobLockupPlan.period).to.equal(BigInt(10_000));

      // verify correct end time
      expect(await votingTokenLockupPlans.planEnd(aliceLockupPlanId)).to.equal(
        BigInt(lockupStartTime + 4_000_000),
      );
      expect(await votingTokenLockupPlans.planEnd(bobLockupPlanId)).to.equal(
        BigInt(lockupStartTime + 4_000_000),
      );
    });

    it('should emit SuccessfulSaleBuyerSettledHedgey event when Hedgey is enabled', async () => {
      const commitment = await hedgeySale.commitments(alice.address);
      const expectedSaleTokens =
        (BigInt(commitment) * TEST_CONSTANTS.PRECISION) / BigInt(defaultParams.saleTokenPrice);

      // The event should not be emitted when Hedgey lockup is enabled
      const tx2 = await hedgeySale.connect(alice).buyerSettle(alice.address);
      const receipt2 = await tx2.wait();

      // Read plan id from Hedgey PlanCreated
      const planCreated = getLockupPlanCreatedEvent(receipt2, votingTokenLockupPlans);
      const planId = planCreated?.planId;

      // Find SuccessfulSaleBuyerSettledHedgey event emitted by TokenSale
      const saleLog = (receipt2?.logs ?? []).find((l: any) => {
        try {
          const parsed = hedgeySale.interface.parseLog(l);
          return parsed?.name === 'SuccessfulSaleBuyerSettledHedgey';
        } catch {
          return false;
        }
      });
      const parsed = saleLog ? hedgeySale.interface.parseLog(saleLog) : null;
      expect(parsed).to.not.equal(null);
      expect(parsed?.args?.[0]).to.equal(alice.address);
      expect(parsed?.args?.[1]).to.equal(alice.address);
      expect(parsed?.args?.[2]).to.equal(expectedSaleTokens);
      expect(parsed?.args?.[3]).to.equal(planId);
    });
  });

  describe('User Settlement - Success Case without Hedgey Lockup', () => {
    beforeEach(async () => {
      tokenSale = await deployTestSale(deployer, saleToken, saleTokenHolder, defaultParams, {
        startOffset: 60,
      });
      await moveToSaleStart(tokenSale);

      // Setup commitments
      await mintAndApproveCommitmentTokens(
        commitmentToken,
        tokenSale,
        [alice, bob],
        [ethers.parseEther('50000'), ethers.parseEther('50000')],
      );

      // Make enough commitments to succeed
      await tokenSale
        .connect(alice)
        .increaseCommitmentERC20(defaultParams.minimumCommitment, ethers.getBytes('0x'), 0n);
      await tokenSale
        .connect(bob)
        .increaseCommitmentERC20(defaultParams.maximumCommitment, ethers.getBytes('0x'), 0n);

      // Reach minimum total commitment
      await reachMinimumTotalCommitment(
        tokenSale,
        commitmentToken,
        BigInt(defaultParams.minimumTotalCommitment),
        BigInt(defaultParams.maximumCommitment),
        [
          { user: alice, amount: BigInt(defaultParams.minimumCommitment) },
          { user: bob, amount: BigInt(defaultParams.maximumCommitment) },
        ],
      );

      // Move to end of sale
      await moveToSaleEnd(tokenSale);
    });

    it('should allow user to settle and receive sale tokens directly', async () => {
      const commitment = await tokenSale.commitments(alice.address);
      const expectedSaleTokens =
        (BigInt(commitment) * TEST_CONSTANTS.PRECISION) / BigInt(defaultParams.saleTokenPrice);

      await expect(tokenSale.connect(alice).buyerSettle(alice.address))
        .to.emit(tokenSale, 'SuccessfulSaleBuyerSettled')
        .withArgs(alice.address, alice.address, expectedSaleTokens);

      expect(await saleToken.balanceOf(alice.address)).to.equal(expectedSaleTokens);
      expect(await tokenSale.settled(alice.address)).to.be.true;
    });

    it('should allow settlement to different recipient address', async () => {
      const commitment = await tokenSale.commitments(alice.address);
      const expectedSaleTokens =
        (BigInt(commitment) * TEST_CONSTANTS.PRECISION) / BigInt(defaultParams.saleTokenPrice);

      await tokenSale.connect(alice).buyerSettle(bob.address);

      expect(await saleToken.balanceOf(bob.address)).to.equal(expectedSaleTokens);
      expect(await saleToken.balanceOf(alice.address)).to.equal(0);
      expect(await tokenSale.settled(alice.address)).to.be.true;
    });

    it('should revert when user settles twice', async () => {
      await tokenSale.connect(alice).buyerSettle(alice.address);

      await expect(
        tokenSale.connect(alice).buyerSettle(alice.address),
      ).to.be.revertedWithCustomError(tokenSale, 'AlreadySettled');
    });

    it('should revert when user has no commitment', async () => {
      await expect(
        tokenSale.connect(nonCommitter).buyerSettle(nonCommitter.address),
      ).to.be.revertedWithCustomError(tokenSale, 'ZeroCommitment');
    });

    it('should revert when sale is still active', async () => {
      // Create a new sale that's still active
      const activeSale = await deployTestSale(deployer, saleToken, saleTokenHolder, defaultParams, {
        startOffset: 10,
      });
      await moveToSaleStart(activeSale);

      // Make a commitment
      await mintAndApproveCommitmentTokens(
        commitmentToken,
        activeSale,
        [alice],
        [BigInt(defaultParams.minimumCommitment)],
      );
      await activeSale
        .connect(alice)
        .increaseCommitmentERC20(defaultParams.minimumCommitment, ethers.getBytes('0x'), 0n);

      await expect(
        activeSale.connect(alice).buyerSettle(alice.address),
      ).to.be.revertedWithCustomError(activeSale, 'SaleNotEnded');
    });
  });

  describe('User Settlement - Failure Case', () => {
    beforeEach(async () => {
      tokenSale = await deployTokenSaleProxy(deployer, defaultParams);
      await time.increaseTo(Number(defaultParams.saleStartTimestamp));

      // Setup minimal commitments (not enough to succeed)
      await commitmentToken.mint(alice.address, ethers.parseEther('100'));
      await commitmentToken
        .connect(alice)
        .approve(await tokenSale.getAddress(), ethers.parseEther('100'));
      await tokenSale
        .connect(alice)
        .increaseCommitmentERC20(defaultParams.minimumCommitment, ethers.getBytes('0x'), 0n);

      // Move to end of sale
      await time.increaseTo(Number(defaultParams.saleEndTimestamp) + 1);
    });

    it('should refund exact commitment amount when sale fails', async () => {
      const commitment = await tokenSale.commitments(alice.address);
      const initialBalance = await commitmentToken.balanceOf(alice.address);

      await expect(tokenSale.connect(alice).buyerSettle(alice.address))
        .to.emit(tokenSale, 'FailedSaleBuyerSettled')
        .withArgs(alice.address, alice.address, commitment);

      expect(await commitmentToken.balanceOf(alice.address)).to.equal(initialBalance + commitment);
      expect(await tokenSale.settled(alice.address)).to.be.true;
    });

    it('should not transfer any sale tokens when sale fails', async () => {
      await tokenSale.connect(alice).buyerSettle(alice.address);
      expect(await saleToken.balanceOf(alice.address)).to.equal(0);
    });

    it('should allow settlement to different recipient for refund', async () => {
      const commitment = await tokenSale.commitments(alice.address);

      await tokenSale.connect(alice).buyerSettle(bob.address);

      expect(await commitmentToken.balanceOf(bob.address)).to.equal(commitment);
      expect(await commitmentToken.balanceOf(alice.address)).to.equal(
        ethers.parseEther('100') - BigInt(commitment),
      );
    });
  });

  describe('Owner Settlement - Success Case', () => {
    beforeEach(async () => {
      tokenSale = await deployTestSale(deployer, saleToken, saleTokenHolder, defaultParams, {
        startOffset: 60,
      });
      await moveToSaleStart(tokenSale);

      // Setup successful sale
      await mintAndApproveCommitmentTokens(
        commitmentToken,
        tokenSale,
        [alice, bob],
        [ethers.parseEther('50000'), ethers.parseEther('50000')],
      );

      await tokenSale
        .connect(alice)
        .increaseCommitmentERC20(defaultParams.minimumCommitment, ethers.getBytes('0x'), 0n);
      await tokenSale
        .connect(bob)
        .increaseCommitmentERC20(defaultParams.maximumCommitment, ethers.getBytes('0x'), 0n);

      // Reach minimum total commitment
      await reachMinimumTotalCommitment(
        tokenSale,
        commitmentToken,
        BigInt(defaultParams.minimumTotalCommitment),
        BigInt(defaultParams.maximumCommitment),
        [
          { user: alice, amount: BigInt(defaultParams.minimumCommitment) },
          { user: bob, amount: BigInt(defaultParams.maximumCommitment) },
        ],
      );

      // Move to end of sale
      await moveToSaleEnd(tokenSale);
    });

    it('should distribute proceeds and protocol fees correctly', async () => {
      const totalCommitments = await tokenSale.totalCommitments();
      const commitmentTokenProtocolFeeAmount =
        (BigInt(totalCommitments) * BigInt(defaultParams.commitmentTokenProtocolFee)) /
        TEST_CONSTANTS.PRECISION;
      const commitmentTokenAmountToSeller = totalCommitments - commitmentTokenProtocolFeeAmount;
      const saleTokenTotalBalance = await saleToken.balanceOf(await tokenSale.getAddress());

      const saleTokenSold =
        (BigInt(totalCommitments) * TEST_CONSTANTS.PRECISION) /
        BigInt(defaultParams.saleTokenPrice);

      const saleTokenProtocolFeeAmount =
        (BigInt(saleTokenSold) * BigInt(defaultParams.saleTokenProtocolFee)) /
        TEST_CONSTANTS.PRECISION;

      const leftoverSaleTokenAmount =
        saleTokenTotalBalance - saleTokenSold - saleTokenProtocolFeeAmount;

      await expect(tokenSale.connect(seller).sellerSettle())
        .to.emit(tokenSale, 'SuccessfulSaleSellerSettled')
        .withArgs(
          seller.address,
          commitmentTokenProtocolFeeAmount,
          commitmentTokenAmountToSeller,
          saleTokenProtocolFeeAmount,
          leftoverSaleTokenAmount,
        );

      expect(await commitmentToken.balanceOf(saleProceedsReceiver.address)).to.equal(
        commitmentTokenAmountToSeller,
      );
      expect(await commitmentToken.balanceOf(protocolFeeReceiver.address)).to.equal(
        commitmentTokenProtocolFeeAmount,
      );
      expect(await saleToken.balanceOf(saleProceedsReceiver.address)).to.equal(
        leftoverSaleTokenAmount,
      );
      expect(await saleToken.balanceOf(protocolFeeReceiver.address)).to.equal(
        saleTokenProtocolFeeAmount,
      );
      expect(await tokenSale.sellerSettled()).to.be.true;
    });

    it('should handle different protocol fee percentages', async () => {
      // Deploy with different protocol fee
      const customSale = await deployTestSale(deployer, saleToken, saleTokenHolder, defaultParams, {
        commitmentTokenProtocolFee: ethers.parseEther('0.1'), // 10%
        saleTokenProtocolFee: ethers.parseEther('0.05'), // 5%
        startOffset: 60,
      });
      await moveToSaleStart(customSale);

      // Reach minimum total commitment
      await reachMinimumTotalCommitment(
        customSale,
        commitmentToken,
        BigInt(defaultParams.minimumTotalCommitment),
        BigInt(defaultParams.maximumCommitment),
        [],
      );

      await moveToSaleEnd(customSale);

      const totalCommitments = await customSale.totalCommitments();
      const commitmentTokenProtocolFeeAmount =
        (BigInt(totalCommitments) * ethers.parseEther('0.1')) / TEST_CONSTANTS.PRECISION;
      const commitmentTokenAmountToSeller = totalCommitments - commitmentTokenProtocolFeeAmount;

      const saleTokenSold =
        (totalCommitments * TEST_CONSTANTS.PRECISION) / BigInt(defaultParams.saleTokenPrice);

      const saleTokenProtocolFeeAmount =
        (BigInt(saleTokenSold) * ethers.parseEther('0.05')) / TEST_CONSTANTS.PRECISION;

      const saleTokenEscrowAmount = await saleToken.balanceOf(await customSale.getAddress());
      const leftoverSaleTokenAmount =
        saleTokenEscrowAmount - saleTokenSold - saleTokenProtocolFeeAmount;

      await customSale.connect(seller).sellerSettle();

      expect(await commitmentToken.balanceOf(protocolFeeReceiver.address)).to.equal(
        commitmentTokenProtocolFeeAmount,
      );
      expect(await commitmentToken.balanceOf(saleProceedsReceiver.address)).to.equal(
        commitmentTokenAmountToSeller,
      );
      expect(await saleToken.balanceOf(saleProceedsReceiver.address)).to.equal(
        leftoverSaleTokenAmount,
      );
      expect(await saleToken.balanceOf(protocolFeeReceiver.address)).to.equal(
        saleTokenProtocolFeeAmount,
      );
    });

    it('should revert when owner settles twice', async () => {
      await tokenSale.connect(seller).sellerSettle();

      await expect(tokenSale.connect(seller).sellerSettle()).to.be.revertedWithCustomError(
        tokenSale,
        'AlreadySettled',
      );
    });

    it('should allow anyone to settle', async () => {
      await expect(tokenSale.connect(alice).sellerSettle()).to.not.be.reverted;
    });
  });

  describe('Owner Settlement - Failure Case', () => {
    beforeEach(async () => {
      tokenSale = await deployTokenSaleProxy(deployer, defaultParams);
      await time.increaseTo(Number(defaultParams.saleStartTimestamp));

      // Setup failed sale
      await commitmentToken.mint(alice.address, ethers.parseEther('1000'));
      await commitmentToken
        .connect(alice)
        .approve(await tokenSale.getAddress(), ethers.parseEther('1000'));
      await kycVerifier.setVerify(true);

      await tokenSale
        .connect(alice)
        .increaseCommitmentERC20(ethers.parseEther('100'), ethers.getBytes('0x'), 0n);

      // Move to end of sale
      await time.increaseTo(Number(defaultParams.saleEndTimestamp) + 1);
    });

    it('should return all sale tokens and collected fees', async () => {
      const saleTokenBalance = await saleToken.balanceOf(await tokenSale.getAddress());

      await expect(tokenSale.connect(seller).sellerSettle())
        .to.emit(tokenSale, 'FailedSaleSellerSettled')
        .withArgs(seller.address, saleTokenBalance);

      expect(await saleToken.balanceOf(saleProceedsReceiver.address)).to.equal(saleTokenBalance);
      expect(await commitmentToken.balanceOf(saleProceedsReceiver.address)).to.equal(0);
    });
  });

  describe('Full Settlement - Success Case - Minimum total commitment', () => {
    beforeEach(async () => {
      tokenSale = await deployTestSale(deployer, saleToken, saleTokenHolder, defaultParams, {
        startOffset: 60,
        minimumTotalCommitment: ethers.parseEther('1000'),
      });
      await moveToSaleStart(tokenSale);

      // Setup successful sale
      await mintAndApproveCommitmentTokens(
        commitmentToken,
        tokenSale,
        [alice, bob],
        [ethers.parseEther('50000'), ethers.parseEther('50000')],
      );

      await tokenSale
        .connect(alice)
        .increaseCommitmentERC20(ethers.parseEther('250'), ethers.getBytes('0x'), 0n);
      await tokenSale
        .connect(bob)
        .increaseCommitmentERC20(ethers.parseEther('750'), ethers.getBytes('0x'), 0n);

      // Move to end of sale
      await moveToSaleEnd(tokenSale);
    });

    it('should distribute proceeds and protocol fees correctly', async () => {
      const totalCommitments = await tokenSale.totalCommitments();
      const escrowedSaleTokenAmount = await saleToken.balanceOf(await tokenSale.getAddress());

      await tokenSale.connect(alice).buyerSettle(alice.address);
      await tokenSale.connect(bob).buyerSettle(bob.address);

      const aliceExpectedSaleTokens =
        (BigInt(ethers.parseEther('250')) * TEST_CONSTANTS.PRECISION) /
        BigInt(defaultParams.saleTokenPrice);

      const bobExpectedSaleTokens =
        (BigInt(ethers.parseEther('750')) * TEST_CONSTANTS.PRECISION) /
        BigInt(defaultParams.saleTokenPrice);

      expect(await saleToken.balanceOf(alice.address)).to.equal(aliceExpectedSaleTokens);
      expect(await saleToken.balanceOf(bob.address)).to.equal(bobExpectedSaleTokens);

      const commitmentTokenProtocolFeeAmount =
        (BigInt(totalCommitments) * BigInt(defaultParams.commitmentTokenProtocolFee)) /
        TEST_CONSTANTS.PRECISION;
      const commitmentTokenAmountToSeller = totalCommitments - commitmentTokenProtocolFeeAmount;

      const saleTokenSold =
        (totalCommitments * TEST_CONSTANTS.PRECISION) / BigInt(defaultParams.saleTokenPrice);

      const saleTokenProtocolFeeAmount =
        (BigInt(saleTokenSold) * BigInt(defaultParams.saleTokenProtocolFee)) /
        TEST_CONSTANTS.PRECISION;

      const leftoverSaleTokenAmount =
        escrowedSaleTokenAmount - saleTokenSold - saleTokenProtocolFeeAmount;

      await expect(tokenSale.connect(seller).sellerSettle())
        .to.emit(tokenSale, 'SuccessfulSaleSellerSettled')
        .withArgs(
          seller.address,
          commitmentTokenProtocolFeeAmount,
          commitmentTokenAmountToSeller,
          saleTokenProtocolFeeAmount,
          leftoverSaleTokenAmount,
        );

      expect(await commitmentToken.balanceOf(saleProceedsReceiver.address)).to.equal(
        commitmentTokenAmountToSeller,
      );
      expect(await commitmentToken.balanceOf(protocolFeeReceiver.address)).to.equal(
        commitmentTokenProtocolFeeAmount,
      );
      expect(await saleToken.balanceOf(saleProceedsReceiver.address)).to.equal(
        leftoverSaleTokenAmount,
      );
      expect(await saleToken.balanceOf(protocolFeeReceiver.address)).to.equal(
        saleTokenProtocolFeeAmount,
      );
      expect(await tokenSale.sellerSettled()).to.be.true;

      // all users have settled, verify that token sale has no remaining commitment or sale tokens
      expect(await saleToken.balanceOf(await tokenSale.getAddress())).to.equal(0);
      expect(await commitmentToken.balanceOf(await tokenSale.getAddress())).to.equal(0);
    });
  });

  describe('Full Settlement - Success Case - Maximum total commitment', () => {
    beforeEach(async () => {
      tokenSale = await deployTestSale(deployer, saleToken, saleTokenHolder, defaultParams, {
        startOffset: 60,
        minimumTotalCommitment: ethers.parseEther('1000'),
        maximumTotalCommitment: ethers.parseEther('2000'),
      });
      await moveToSaleStart(tokenSale);

      // Setup successful sale
      await mintAndApproveCommitmentTokens(
        commitmentToken,
        tokenSale,
        [alice, bob],
        [ethers.parseEther('50000'), ethers.parseEther('50000')],
      );

      await tokenSale
        .connect(alice)
        .increaseCommitmentERC20(ethers.parseEther('1000'), ethers.getBytes('0x'), 0n);
      await tokenSale
        .connect(bob)
        .increaseCommitmentERC20(ethers.parseEther('1000'), ethers.getBytes('0x'), 0n);

      // Move to end of sale
      await moveToSaleEnd(tokenSale);
    });

    it('should distribute proceeds and protocol fees correctly', async () => {
      const totalCommitments = await tokenSale.totalCommitments();
      const escrowedSaleTokenAmount = await saleToken.balanceOf(await tokenSale.getAddress());

      await tokenSale.connect(alice).buyerSettle(alice.address);
      await tokenSale.connect(bob).buyerSettle(bob.address);

      const aliceExpectedSaleTokens =
        (BigInt(ethers.parseEther('1000')) * TEST_CONSTANTS.PRECISION) /
        BigInt(defaultParams.saleTokenPrice);

      const bobExpectedSaleTokens =
        (BigInt(ethers.parseEther('1000')) * TEST_CONSTANTS.PRECISION) /
        BigInt(defaultParams.saleTokenPrice);

      expect(await saleToken.balanceOf(alice.address)).to.equal(aliceExpectedSaleTokens);
      expect(await saleToken.balanceOf(bob.address)).to.equal(bobExpectedSaleTokens);

      const commitmentTokenProtocolFeeAmount =
        (BigInt(totalCommitments) * BigInt(defaultParams.commitmentTokenProtocolFee)) /
        TEST_CONSTANTS.PRECISION;
      const commitmentTokenAmountToSeller = totalCommitments - commitmentTokenProtocolFeeAmount;

      const saleTokenSold =
        (totalCommitments * TEST_CONSTANTS.PRECISION) / BigInt(defaultParams.saleTokenPrice);

      const saleTokenProtocolFeeAmount =
        (BigInt(saleTokenSold) * BigInt(defaultParams.saleTokenProtocolFee)) /
        TEST_CONSTANTS.PRECISION;

      const leftoverSaleTokenAmount =
        escrowedSaleTokenAmount - saleTokenSold - saleTokenProtocolFeeAmount;

      await expect(tokenSale.connect(seller).sellerSettle())
        .to.emit(tokenSale, 'SuccessfulSaleSellerSettled')
        .withArgs(
          seller.address,
          commitmentTokenProtocolFeeAmount,
          commitmentTokenAmountToSeller,
          saleTokenProtocolFeeAmount,
          leftoverSaleTokenAmount,
        );

      expect(await commitmentToken.balanceOf(saleProceedsReceiver.address)).to.equal(
        commitmentTokenAmountToSeller,
      );
      expect(await commitmentToken.balanceOf(protocolFeeReceiver.address)).to.equal(
        commitmentTokenProtocolFeeAmount,
      );
      expect(await saleToken.balanceOf(saleProceedsReceiver.address)).to.equal(
        leftoverSaleTokenAmount,
      );
      expect(await saleToken.balanceOf(protocolFeeReceiver.address)).to.equal(
        saleTokenProtocolFeeAmount,
      );
      expect(await tokenSale.sellerSettled()).to.be.true;

      // all users have settled, verify that token sale has no remaining commitment or sale tokens
      expect(await saleToken.balanceOf(await tokenSale.getAddress())).to.equal(0);
      expect(await commitmentToken.balanceOf(await tokenSale.getAddress())).to.equal(0);
    });
  });

  describe('KYC Verification', () => {
    beforeEach(async () => {
      tokenSale = await deployTokenSaleProxy(deployer, defaultParams);
      await time.increaseTo(Number(defaultParams.saleStartTimestamp));

      await commitmentToken.mint(alice.address, ethers.parseEther('1000'));
      await commitmentToken
        .connect(alice)
        .approve(await tokenSale.getAddress(), ethers.parseEther('1000'));
    });

    it('should allow commitment increases when KYC verification passes', async () => {
      await kycVerifier.setVerify(true);

      await expect(
        tokenSale
          .connect(alice)
          .increaseCommitmentERC20(ethers.parseEther('100'), ethers.getBytes('0x'), 0n),
      ).to.not.be.reverted;
    });

    it('should block commitment increases when KYC fails', async () => {
      await kycVerifier.setVerify(false);

      await expect(
        tokenSale
          .connect(alice)
          .increaseCommitmentERC20(ethers.parseEther('100'), ethers.getBytes('0x'), 0n),
      ).to.be.revertedWithCustomError(kycVerifier, 'InvalidSignature');
    });
  });

  describe('Native Asset Handling', () => {
    let nativeSale: TokenSaleV1;

    beforeEach(async () => {
      const nativeParams = {
        ...defaultParams,
        commitmentToken: TEST_CONSTANTS.NATIVE_ASSET,
      };
      nativeSale = await deployTokenSaleProxy(deployer, nativeParams);
    });

    it('should verify NATIVE_ASSET constant is correct', async () => {
      expect(TEST_CONSTANTS.NATIVE_ASSET).to.equal('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE');
    });

    it('should accept and handle ETH correctly', async () => {
      await moveToSaleStart(nativeSale);

      const commitAmount = ethers.parseEther('100');
      const initialBalance = await ethers.provider.getBalance(await nativeSale.getAddress());

      await nativeSale
        .connect(alice)
        .increaseCommitmentNative(ethers.getBytes('0x'), 0n, { value: commitAmount });

      expect(await ethers.provider.getBalance(await nativeSale.getAddress())).to.equal(
        BigInt(initialBalance) + BigInt(commitAmount),
      );
    });
  });

  describe('Edge Cases & Security', () => {
    beforeEach(async () => {
      tokenSale = await deployTokenSaleProxy(deployer, defaultParams);
    });

    it('should handle race to reach maximumTotalCommitment', async () => {
      // Use smaller values to test with limited signers
      const raceSale = await deployTestSale(deployer, saleToken, saleTokenHolder, defaultParams, {
        minimumTotalCommitment: ethers.parseEther('3000'),
        maximumTotalCommitment: ethers.parseEther('5000'), // Only need 5 users
      });
      await moveToSaleStart(raceSale);

      // Setup users with enough tokens
      await mintAndApproveCommitmentTokens(
        commitmentToken,
        raceSale,
        [alice, bob],
        [BigInt(defaultParams.maximumCommitment), BigInt(defaultParams.maximumCommitment)],
      );

      // Alice commits her maximum
      await raceSale
        .connect(alice)
        .increaseCommitmentERC20(defaultParams.maximumCommitment, ethers.getBytes('0x'), 0n);

      // Fill more of the sale with other users, leaving exactly 1000 for Bob
      const signers = await ethers.getSigners();
      // We need to fill 5000 - 1000 (alice) - 1000 (remaining for bob) = 3000
      const amountPerUser = ethers.parseEther('1000');
      const fillUsers = signers.slice(9, 12); // 3 users
      await mintAndApproveCommitmentTokens(
        commitmentToken,
        raceSale,
        fillUsers,
        Array(3).fill(amountPerUser),
      );

      for (const user of fillUsers) {
        await raceSale
          .connect(user)
          .increaseCommitmentERC20(amountPerUser, ethers.getBytes('0x'), 0n);
      }

      // Now only 1000 ETH remaining
      // Bob tries to commit more than remaining
      await expect(
        raceSale
          .connect(bob)
          .increaseCommitmentERC20(ethers.parseEther('1001'), ethers.getBytes('0x'), 0n),
      ).to.be.revertedWithCustomError(raceSale, 'MaximumTotalCommitment');

      // Bob commits exactly the remaining amount
      await raceSale
        .connect(bob)
        .increaseCommitmentERC20(ethers.parseEther('1000'), ethers.getBytes('0x'), 0n);

      expect(await raceSale.totalCommitments()).to.equal(ethers.parseEther('5000'));
      await expectSaleState(raceSale, SaleState.SUCCEEDED);
    });
  });

  describe('Event Emission', () => {
    beforeEach(async () => {
      tokenSale = await deployTokenSaleProxy(deployer, defaultParams);
      await moveToSaleStart(tokenSale);
    });

    it('should emit CommitmentIncreased with correct parameters', async () => {
      await mintAndApproveCommitmentTokens(
        commitmentToken,
        tokenSale,
        [alice],
        [ethers.parseEther('1000')],
      );

      const amount = ethers.parseEther('100');
      await expect(
        tokenSale.connect(alice).increaseCommitmentERC20(amount, ethers.getBytes('0x'), 0n),
      )
        .to.emit(tokenSale, 'CommitmentIncreased')
        .withArgs(alice.address, amount);
    });

    it('should emit all settlement events correctly', async () => {
      const escrowedSaleTokenAmount = await saleToken.balanceOf(await tokenSale.getAddress());

      // Setup successful sale - need multiple users
      await mintAndApproveCommitmentTokens(
        commitmentToken,
        tokenSale,
        [alice],
        [BigInt(defaultParams.maximumCommitment)],
      );
      await tokenSale
        .connect(alice)
        .increaseCommitmentERC20(defaultParams.maximumCommitment, ethers.getBytes('0x'), 0n);

      // Reach minimum total commitment
      await reachMinimumTotalCommitment(
        tokenSale,
        commitmentToken,
        BigInt(defaultParams.minimumTotalCommitment),
        BigInt(defaultParams.maximumCommitment),
        [{ user: alice, amount: BigInt(defaultParams.maximumCommitment) }],
      );

      await moveToSaleEnd(tokenSale);

      // User settlement
      const aliceCommitment = await tokenSale.commitments(alice.address);
      const aliceExpectedSaleTokens =
        (BigInt(aliceCommitment) * TEST_CONSTANTS.PRECISION) / BigInt(defaultParams.saleTokenPrice);

      await expect(tokenSale.connect(alice).buyerSettle(alice.address))
        .to.emit(tokenSale, 'SuccessfulSaleBuyerSettled')
        .withArgs(alice.address, alice.address, aliceExpectedSaleTokens);

      // Owner settlement
      const totalCommitments = await tokenSale.totalCommitments();
      const commitmentTokenProtocolFeeAmount =
        (BigInt(totalCommitments) * BigInt(defaultParams.commitmentTokenProtocolFee)) /
        TEST_CONSTANTS.PRECISION;
      const commitmentTokenAmountToSeller = totalCommitments - commitmentTokenProtocolFeeAmount;
      const saleTokenSold =
        (BigInt(defaultParams.minimumTotalCommitment) * TEST_CONSTANTS.PRECISION) /
        BigInt(defaultParams.saleTokenPrice);
      const saleTokenProtocolFeeAmount =
        (BigInt(saleTokenSold) * BigInt(defaultParams.saleTokenProtocolFee)) /
        TEST_CONSTANTS.PRECISION;
      const leftoverSaleTokenAmount =
        escrowedSaleTokenAmount - saleTokenSold - saleTokenProtocolFeeAmount;

      await expect(tokenSale.connect(seller).sellerSettle())
        .to.emit(tokenSale, 'SuccessfulSaleSellerSettled')
        .withArgs(
          seller.address,
          commitmentTokenProtocolFeeAmount,
          commitmentTokenAmountToSeller,
          saleTokenProtocolFeeAmount,
          leftoverSaleTokenAmount,
        );
    });
  });

  describe('View Functions', () => {
    beforeEach(async () => {
      tokenSale = await deployTokenSaleProxy(deployer, defaultParams);
    });

    it('should return all correct values from view functions', async () => {
      expect(await tokenSale.sellerSettled()).to.be.false;
      expect(await tokenSale.saleStartTimestamp()).to.equal(defaultParams.saleStartTimestamp);
      expect(await tokenSale.saleEndTimestamp()).to.equal(defaultParams.saleEndTimestamp);
      expect(await tokenSale.commitmentToken()).to.equal(defaultParams.commitmentToken);
      expect(await tokenSale.saleToken()).to.equal(defaultParams.saleToken);
      expect(await tokenSale.kycVerifier()).to.equal(defaultParams.kycVerifier);
      expect(await tokenSale.saleProceedsReceiver()).to.equal(defaultParams.saleProceedsReceiver);
      expect(await tokenSale.protocolFeeReceiver()).to.equal(defaultParams.protocolFeeReceiver);
      expect(await tokenSale.minimumCommitment()).to.equal(defaultParams.minimumCommitment);
      expect(await tokenSale.maximumCommitment()).to.equal(defaultParams.maximumCommitment);
      expect(await tokenSale.minimumTotalCommitment()).to.equal(
        defaultParams.minimumTotalCommitment,
      );
      expect(await tokenSale.maximumTotalCommitment()).to.equal(
        defaultParams.maximumTotalCommitment,
      );
      expect(await tokenSale.saleTokenPrice()).to.equal(defaultParams.saleTokenPrice);
      expect(await tokenSale.commitmentTokenProtocolFee()).to.equal(
        defaultParams.commitmentTokenProtocolFee,
      );
      expect(await tokenSale.saleTokenProtocolFee()).to.equal(defaultParams.saleTokenProtocolFee);
      expect(await tokenSale.totalCommitments()).to.equal(0);
      expect(await tokenSale.commitments(alice.address)).to.equal(0);
      expect(await tokenSale.settled(alice.address)).to.be.false;
    });
  });
});

// Run shared test suites
describe('TokenSaleV1 - Shared Tests', () => {
  let deployer: SignerWithAddress;
  let saleProceedsReceiver: SignerWithAddress;
  let protocolFeeReceiver: SignerWithAddress;
  let saleTokenHolder: SignerWithAddress;
  let tokenSale: TokenSaleV1;
  let saleToken: MockERC20;
  let commitmentToken: MockERC20;
  let kycVerifier: MockKYCVerifier;
  let defaultParams: ITokenSaleV1.InitializerParamsStruct;

  beforeEach(async () => {
    [deployer, saleProceedsReceiver, protocolFeeReceiver, saleTokenHolder] =
      await ethers.getSigners();

    // Deploy mock contracts
    const MockERC20Factory = new MockERC20__factory(deployer);
    const MockKYCVerifierFactory = new MockKYCVerifier__factory(deployer);

    saleToken = await MockERC20Factory.deploy('Sale Token', 'SALE', 18);
    commitmentToken = await MockERC20Factory.deploy('Commitment Token', 'COMMIT', 18);
    kycVerifier = await MockKYCVerifierFactory.deploy();

    // Mint tokens to sale token holder
    await saleToken.mint(saleTokenHolder.address, ethers.parseEther('1050000'));

    // Setup default parameters
    const currentTime = await time.latest();
    defaultParams = {
      saleStartTimestamp: currentTime + 3600,
      saleEndTimestamp: currentTime + 86400,
      saleTokenHolder: saleTokenHolder.address,
      commitmentToken: await commitmentToken.getAddress(),
      saleToken: await saleToken.getAddress(),
      kycVerifier: await kycVerifier.getAddress(),
      saleProceedsReceiver: saleProceedsReceiver.address,
      protocolFeeReceiver: protocolFeeReceiver.address,
      minimumCommitment: ethers.parseEther('10'),
      maximumCommitment: ethers.parseEther('1000'),
      minimumTotalCommitment: ethers.parseEther('10000'),
      maximumTotalCommitment: ethers.parseEther('100000'),
      saleTokenPrice: ethers.parseEther('0.1'),
      commitmentTokenProtocolFee: ethers.parseEther('0.02'),
      saleTokenProtocolFee: ethers.parseEther('0.05'),
      hedgeyLockupParams: {
        enabled: false,
        start: 0,
        cliff: 0,
        ratePercentage: 0,
        period: 0,
        votingTokenLockupPlans: ethers.ZeroAddress,
      },
    };

    // Enable KYC
    await kycVerifier.setVerify(true);

    // Deploy the contract
    tokenSale = await deployTokenSaleProxy(deployer, defaultParams);
  });

  describe('Deployment Block', () => {
    runDeploymentBlockTests({
      getContract: () => tokenSale,
    });
  });

  describe('Initializer Event Emitter', () => {
    let testDeployer: SignerWithAddress;
    let savedInitParams: any;

    beforeEach(async () => {
      [testDeployer] = await ethers.getSigners();
    });

    runInitializerEventEmitterTests({
      contractFactory: TokenSaleV1__factory,
      masterCopy: async () => {
        const impl = await new TokenSaleV1__factory(testDeployer).deploy();
        return await impl.getAddress();
      },
      deployer: () => testDeployer,
      initializeParams: async () => {
        // Setup params
        const currentTime = await time.latest();
        const initParams = {
          saleStartTimestamp: currentTime + 3600,
          saleEndTimestamp: currentTime + 86400,
          saleTokenHolder: saleTokenHolder.address,
          commitmentToken: await commitmentToken.getAddress(),
          saleToken: await saleToken.getAddress(),
          kycVerifier: await kycVerifier.getAddress(),
          saleProceedsReceiver: saleProceedsReceiver.address,
          protocolFeeReceiver: protocolFeeReceiver.address,
          minimumCommitment: ethers.parseEther('10'),
          maximumCommitment: ethers.parseEther('1000'),
          minimumTotalCommitment: ethers.parseEther('10000'),
          maximumTotalCommitment: ethers.parseEther('100000'),
          saleTokenPrice: ethers.parseEther('0.1'),
          commitmentTokenProtocolFee: ethers.parseEther('0.02'),
          saleTokenProtocolFee: ethers.parseEther('0.05'),
          hedgeyLockupParams: {
            enabled: false,
            start: 0,
            cliff: 0,
            ratePercentage: 0,
            period: 0,
            votingTokenLockupPlans: ethers.ZeroAddress,
          },
        };

        // Calculate required sale token amount
        const saleTokenAmount =
          (BigInt(initParams.maximumTotalCommitment) *
            (TEST_CONSTANTS.PRECISION + BigInt(initParams.saleTokenProtocolFee))) /
          BigInt(initParams.saleTokenPrice);

        // Mint tokens to saleTokenHolder
        await saleToken.mint(saleTokenHolder.address, saleTokenAmount);

        // Get current nonce - masterCopy() has already been called at this point
        const currentNonce = await ethers.provider.getTransactionCount(testDeployer.address);

        // The proxy will be deployed at the current nonce (masterCopy already deployed)
        const proxyAddress = ethers.getCreateAddress({
          from: testDeployer.address,
          nonce: currentNonce,
        });

        // Approve the predicted proxy address
        await saleToken.connect(saleTokenHolder).approve(proxyAddress, saleTokenAmount);

        // Save the params for getExpectedInitData
        savedInitParams = initParams;

        return [initParams];
      },
      getExpectedInitData: async () => {
        // Use the saved params to ensure timestamps match
        return ethers.AbiCoder.defaultAbiCoder().encode(
          [
            'tuple(uint48 saleStartTimestamp, uint48 saleEndTimestamp, address saleTokenHolder, address commitmentToken, address saleToken, address kycVerifier, address saleProceedsReceiver, address protocolFeeReceiver, uint256 minimumCommitment, uint256 maximumCommitment, uint256 minimumTotalCommitment, uint256 maximumTotalCommitment, uint256 saleTokenPrice, uint256 commitmentTokenProtocolFee, uint256 saleTokenProtocolFee, tuple(bool enabled, uint256 start, uint256 cliff, uint256 ratePercentage, uint256 period, address votingTokenLockupPlans) hedgeyLockupParams)',
          ],
          [savedInitParams],
        );
      },
    });
  });

  describe('Supports Interface', () => {
    runSupportsInterfaceTests({
      getContract: () => tokenSale,
      supportedInterfaceFactories: [
        IERC165__factory,
        ITokenSaleV1__factory,
        IVersion__factory,
        IDeploymentBlock__factory,
      ],
    });
  });
});
