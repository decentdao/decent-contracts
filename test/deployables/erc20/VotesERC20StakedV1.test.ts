import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { mine, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  IDeploymentBlockV1__factory,
  IERC165__factory,
  IERC20__factory,
  IVersion__factory,
  IVotes__factory,
  IVotesERC20StakedV1__factory,
  MockERC20Votes,
  MockERC20Votes__factory,
  VotesERC20StakedV1,
  VotesERC20StakedV1__factory,
} from '../../../typechain-types';
import { runDeploymentBlockTests } from '../../helpers/deploymentBlockTests';
import { calculateInterfaceId, executeTxAndCheckBalanceDeltas } from '../../helpers/utils';
import { runUUPSUpgradeabilityTests } from '../../helpers/uupsUpgradeabilityTests';

// Helper function for deploying VotesERC20StakedV1 instances using ERC1967Proxy
async function deployVotesERC20StakedProxy(
  proxyDeployer: SignerWithAddress,
  implementation: string,
  owner: SignerWithAddress,
  name: string,
  symbol: string,
  stakedToken: string,
  minimumStakingPeriod: bigint,
  rewardsTokens: string[],
): Promise<VotesERC20StakedV1> {
  const metadata = {
    name,
    symbol,
  };

  // Create initialization data with function selector
  const fullInitData = VotesERC20StakedV1__factory.createInterface().encodeFunctionData(
    'initialize',
    [metadata, owner.address, stakedToken, minimumStakingPeriod, rewardsTokens],
  );

  // Deploy the proxy with the implementation
  const proxy = await new ERC1967Proxy__factory(proxyDeployer).deploy(implementation, fullInitData);

  // Return a contract instance connected to the proxy
  return VotesERC20StakedV1__factory.connect(await proxy.getAddress(), owner);
}

describe('VotesERC20StakedV1', () => {
  // signers
  let proxyDeployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  let nonOwner: SignerWithAddress;
  let rewardsDistributor: SignerWithAddress;

  // contracts
  let votesERC20Staked: VotesERC20StakedV1;
  let masterCopy: string;
  let stakedToken: MockERC20Votes;
  let rewardsTokenA: MockERC20Votes;
  let rewardsTokenB: MockERC20Votes;
  let rewardsTokenC: MockERC20Votes;

  const nativeAssetAddress = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

  beforeEach(async () => {
    // Get signers
    [proxyDeployer, owner, alice, bob, carol, nonOwner, rewardsDistributor] =
      await ethers.getSigners();

    masterCopy = await (await new VotesERC20StakedV1__factory(owner).deploy()).getAddress();
    stakedToken = await new MockERC20Votes__factory(owner).deploy();
    rewardsTokenA = await new MockERC20Votes__factory(owner).deploy();
    rewardsTokenB = await new MockERC20Votes__factory(owner).deploy();
    rewardsTokenC = await new MockERC20Votes__factory(owner).deploy();
  });

  describe('Initialization', () => {
    it('should initialize with correct values', async () => {
      votesERC20Staked = await deployVotesERC20StakedProxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Staking Contract',
        'TSC',
        await stakedToken.getAddress(),
        604800n,
        [
          await rewardsTokenA.getAddress(),
          await rewardsTokenB.getAddress(),
          await rewardsTokenC.getAddress(),
        ],
      );

      expect(await votesERC20Staked.name()).to.equal('Test Staking Contract');
      expect(await votesERC20Staked.symbol()).to.equal('TSC');
      expect(await votesERC20Staked.owner()).to.equal(owner.address);
      expect(await votesERC20Staked.stakedToken()).to.equal(await stakedToken.getAddress());
      expect(await votesERC20Staked.minimumStakingPeriod()).to.equal(604800n);
      expect(await votesERC20Staked.rewardsTokens()).to.deep.equal([
        await rewardsTokenA.getAddress(),
        await rewardsTokenB.getAddress(),
        await rewardsTokenC.getAddress(),
      ]);
    });

    it('should not allow reinitialization', async () => {
      votesERC20Staked = await deployVotesERC20StakedProxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Staking Contract',
        'TSC',
        await stakedToken.getAddress(),
        604800n,
        [
          await rewardsTokenA.getAddress(),
          await rewardsTokenB.getAddress(),
          await rewardsTokenC.getAddress(),
        ],
      );

      await expect(
        votesERC20Staked.initialize(
          { name: 'New Name', symbol: 'NEW' },
          owner.address,
          await stakedToken.getAddress(),
          604800n,
          [
            await rewardsTokenA.getAddress(),
            await rewardsTokenB.getAddress(),
            await rewardsTokenC.getAddress(),
          ],
        ),
      ).to.be.revertedWithCustomError(votesERC20Staked, 'InvalidInitialization');
    });

    it('Should have initialization disabled in the implementation', async function () {
      const implementationContract = VotesERC20StakedV1__factory.connect(masterCopy, proxyDeployer);

      await expect(
        implementationContract.initialize(
          { name: 'New Name', symbol: 'NEW' },
          owner.address,
          await stakedToken.getAddress(),
          604800n,
          [
            await rewardsTokenA.getAddress(),
            await rewardsTokenB.getAddress(),
            await rewardsTokenC.getAddress(),
          ],
        ),
      ).to.be.revertedWithCustomError(implementationContract, 'InvalidInitialization');
    });

    it('should set the owner correctly', async () => {
      votesERC20Staked = await deployVotesERC20StakedProxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Staking Contract',
        'TSC',
        await stakedToken.getAddress(),
        604800n,
        [
          await rewardsTokenA.getAddress(),
          await rewardsTokenB.getAddress(),
          await rewardsTokenC.getAddress(),
        ],
      );

      expect(await votesERC20Staked.owner()).to.equal(owner.address);
    });
  });

  describe('Ownership', () => {
    beforeEach(async () => {
      votesERC20Staked = await deployVotesERC20StakedProxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Staking Contract',
        'TSC',
        await stakedToken.getAddress(),
        604800n,
        [
          await rewardsTokenA.getAddress(),
          await rewardsTokenB.getAddress(),
          await rewardsTokenC.getAddress(),
        ],
      );
    });

    it('should set the owner correctly', async () => {
      const currentOwner = await votesERC20Staked.owner();
      expect(currentOwner).to.equal(owner.address);
    });

    it('Should allow owner to transfer ownership', async function () {
      await votesERC20Staked.connect(owner).transferOwnership(alice.address);
      await votesERC20Staked.connect(alice).acceptOwnership();
      expect(await votesERC20Staked.owner()).to.equal(alice.address);
    });

    it('should allow the owner to call authorized functions', async () => {
      await votesERC20Staked.connect(owner).renounceOwnership();
      expect(await votesERC20Staked.owner()).to.equal(ethers.ZeroAddress);
    });

    it('should not allow non-owners to call owner-only functions', async () => {
      await expect(
        votesERC20Staked.connect(alice).renounceOwnership(),
      ).to.be.revertedWithCustomError(votesERC20Staked, 'OwnableUnauthorizedAccount');
    });

    it('should allow the owner to set a new minimum staking period', async () => {
      await votesERC20Staked.connect(owner).updateMinimumStakingPeriod(10n);
      expect(await votesERC20Staked.minimumStakingPeriod()).to.equal(10n);
    });

    it('should not allow non-owners to set a new minimum staking period', async () => {
      await expect(
        votesERC20Staked.connect(alice).updateMinimumStakingPeriod(10n),
      ).to.be.revertedWithCustomError(votesERC20Staked, 'OwnableUnauthorizedAccount');
    });
  });

  describe('Version', () => {
    beforeEach(async () => {
      votesERC20Staked = await deployVotesERC20StakedProxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Staking Contract',
        'TSC',
        await stakedToken.getAddress(),
        604800n,
        [
          await rewardsTokenA.getAddress(),
          await rewardsTokenB.getAddress(),
          await rewardsTokenC.getAddress(),
        ],
      );
    });

    it('should return the correct version number', async () => {
      expect(await votesERC20Staked.version()).to.equal(1);
    });
  });

  describe('ERC165', function () {
    // Interface IDs
    let iVersionInterfaceId: string;
    let iERC20InterfaceId: string;
    let iVotesInterfaceId: string;
    let iERC165InterfaceId: string;
    let iVotesERC20StakedV1InterfaceId: string;
    beforeEach(async function () {
      votesERC20Staked = await deployVotesERC20StakedProxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Staking Contract',
        'TSC',
        await stakedToken.getAddress(),
        604800n,
        [
          await rewardsTokenA.getAddress(),
          await rewardsTokenB.getAddress(),
          await rewardsTokenC.getAddress(),
        ],
      );

      // Calculate interface IDs
      const IVersionInterface = IVersion__factory.createInterface();
      iVersionInterfaceId = calculateInterfaceId(IVersionInterface);

      const IERC20Interface = IERC20__factory.createInterface();
      iERC20InterfaceId = calculateInterfaceId(IERC20Interface);

      const IVotesInterface = IVotes__factory.createInterface();
      iVotesInterfaceId = calculateInterfaceId(IVotesInterface);

      const IERC165Interface = IERC165__factory.createInterface();
      iERC165InterfaceId = calculateInterfaceId(IERC165Interface);

      const IVotesERC20StakedV1Interface = IVotesERC20StakedV1__factory.createInterface();
      iVotesERC20StakedV1InterfaceId = calculateInterfaceId(IVotesERC20StakedV1Interface);
    });

    it('Should support IERC165 interface', async function () {
      const supported = await votesERC20Staked.supportsInterface(iERC165InterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IVotesERC20StakedV1 interface', async function () {
      const supported = await votesERC20Staked.supportsInterface(iVotesERC20StakedV1InterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IVersion interface', async function () {
      const supported = await votesERC20Staked.supportsInterface(iVersionInterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IERC20 interface', async function () {
      const supported = await votesERC20Staked.supportsInterface(iERC20InterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IVotes interface', async function () {
      const supported = await votesERC20Staked.supportsInterface(iVotesInterfaceId);
      void expect(supported).to.be.true;
    });

    it('Should support IDeploymentBlockV1 interface', async function () {
      void expect(
        await votesERC20Staked.supportsInterface(
          calculateInterfaceId(IDeploymentBlockV1__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('Should not support random interface', async function () {
      const randomInterfaceId = '0x12345678';
      const supported = await votesERC20Staked.supportsInterface(randomInterfaceId);
      void expect(supported).to.be.false;
    });
  });

  describe('Timestamp-based clock functions', () => {
    beforeEach(async () => {
      votesERC20Staked = await deployVotesERC20StakedProxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Staking Contract',
        'TSC',
        await stakedToken.getAddress(),
        604800n,
        [
          await rewardsTokenA.getAddress(),
          await rewardsTokenB.getAddress(),
          await rewardsTokenC.getAddress(),
        ],
      );
    });

    it('should return current timestamp from clock()', async () => {
      const currentTime = await ethers.provider.getBlock('latest').then(b => b!.timestamp);
      const clockTime = await votesERC20Staked.clock();

      // Allow small variance due to block mining time
      expect(Number(clockTime)).to.be.closeTo(currentTime, 5);
    });

    it("should return 'mode=timestamp' from CLOCK_MODE()", async () => {
      expect(await votesERC20Staked.CLOCK_MODE()).to.equal('mode=timestamp');
    });

    it('should use timestamp for vote checkpoints', async () => {
      // Delegate to another address
      await votesERC20Staked.connect(owner).delegate(alice.address);

      // Mine a block to move forward in time
      await mine(1);

      // Get current timestamp which is now > the delegation timestamp
      const currentTime = await time.latest();

      // The voting power at the previous timestamp should be available
      const votingPower = await votesERC20Staked.getPastVotes(alice.address, currentTime - 1);

      // Should match the owner's balance since we just delegated
      expect(votingPower).to.equal(await votesERC20Staked.balanceOf(owner.address));
    });
  });

  describe('VotesERC20V1 UUPS Upgradeability', function () {
    beforeEach(async function () {
      votesERC20Staked = await deployVotesERC20StakedProxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Staking Contract',
        'TSC',
        await stakedToken.getAddress(),
        604800n,
        [
          await rewardsTokenA.getAddress(),
          await rewardsTokenB.getAddress(),
          await rewardsTokenC.getAddress(),
        ],
      );
    });

    // Run UUPS upgradeability tests
    runUUPSUpgradeabilityTests({
      getContract: () => votesERC20Staked,
      createNewImplementation: async () => {
        const newImplementation = await new VotesERC20StakedV1__factory(owner).deploy();
        return newImplementation;
      },
      owner: () => owner,
      nonOwner: () => nonOwner,
    });
  });

  describe('Rewards Tokens', function () {
    beforeEach(async function () {
      votesERC20Staked = await deployVotesERC20StakedProxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Staking Contract',
        'TSC',
        await stakedToken.getAddress(),
        604800n,
        [
          await rewardsTokenA.getAddress(),
          await rewardsTokenB.getAddress(),
          await rewardsTokenC.getAddress(),
        ],
      );

      // Mint 10 staked tokens to alice
      await stakedToken.mint(alice.address, ethers.parseEther('10'));

      // Alice approves the staking contract to spend her tokens
      await stakedToken
        .connect(alice)
        .approve(await votesERC20Staked.getAddress(), ethers.parseEther('10'));
    });

    it('should not allow adding duplicate rewards tokens', async function () {
      await expect(
        votesERC20Staked.connect(owner).addRewardsTokens([await rewardsTokenA.getAddress()]),
      ).to.be.revertedWithCustomError(votesERC20Staked, 'DuplicateRewardsToken');
    });

    it('should allow owner to add rewards tokens', async function () {
      const rewardsTokenD = await new MockERC20Votes__factory(owner).deploy();
      const rewardsTokenE = await new MockERC20Votes__factory(owner).deploy();

      await votesERC20Staked
        .connect(owner)
        .addRewardsTokens([await rewardsTokenD.getAddress(), await rewardsTokenE.getAddress()]);

      expect(await votesERC20Staked.rewardsTokens()).to.deep.equal([
        await rewardsTokenA.getAddress(),
        await rewardsTokenB.getAddress(),
        await rewardsTokenC.getAddress(),
        await rewardsTokenD.getAddress(),
        await rewardsTokenE.getAddress(),
      ]);
    });

    it('should not allow non-owner to add rewards tokens', async function () {
      await expect(
        votesERC20Staked.connect(alice).addRewardsTokens([await rewardsTokenA.getAddress()]),
      ).to.be.revertedWithCustomError(votesERC20Staked, 'OwnableUnauthorizedAccount');
    });

    it('should return rewards token data', async function () {
      const [rewardsRate, rewardsDistributed, rewardsClaimed] =
        await votesERC20Staked.rewardsTokenData(await rewardsTokenA.getAddress());

      expect(rewardsRate).to.equal(0n);
      expect(rewardsDistributed).to.equal(0n);
      expect(rewardsClaimed).to.equal(0n);
    });

    it('should not return data for invalid rewards tokens', async function () {
      await expect(votesERC20Staked.rewardsTokenData(await bob.address))
        .to.be.revertedWithCustomError(votesERC20Staked, 'InvalidRewardsToken')
        .withArgs(await bob.address);
    });
  });

  describe('Staking', function () {
    beforeEach(async function () {
      votesERC20Staked = await deployVotesERC20StakedProxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Staking Contract',
        'TSC',
        await stakedToken.getAddress(),
        604800n,
        [
          await rewardsTokenA.getAddress(),
          await rewardsTokenB.getAddress(),
          await rewardsTokenC.getAddress(),
        ],
      );

      // Mint 10 staked tokens to alice
      await stakedToken.mint(alice.address, ethers.parseEther('10'));

      // Alice approves the staking contract to spend her tokens
      await stakedToken
        .connect(alice)
        .approve(await votesERC20Staked.getAddress(), ethers.parseEther('10'));
    });

    it('should not allow users to stake 0 tokens', async function () {
      await expect(votesERC20Staked.connect(alice).stake(0n)).to.be.revertedWithCustomError(
        votesERC20Staked,
        'ZeroStake',
      );
    });

    it('should not allow users to transfer or approve VotesERC20StakedV1 tokens', async function () {
      await votesERC20Staked.connect(alice).stake(ethers.parseEther('10'));

      await expect(
        votesERC20Staked.connect(alice).approve(bob.address, ethers.parseEther('10')),
      ).to.be.revertedWithCustomError(votesERC20Staked, 'NonTransferable');

      await expect(
        votesERC20Staked.connect(alice).transfer(bob.address, ethers.parseEther('10')),
      ).to.be.revertedWithCustomError(votesERC20Staked, 'NonTransferable');

      await expect(
        votesERC20Staked
          .connect(alice)
          .transferFrom(bob.address, alice.address, ethers.parseEther('10')),
      ).to.be.revertedWithCustomError(votesERC20Staked, 'NonTransferable');
    });

    it('should allow users to stake tokens', async function () {
      await votesERC20Staked.connect(alice).stake(ethers.parseEther('10'));

      expect(await votesERC20Staked.balanceOf(alice.address)).to.equal(ethers.parseEther('10'));
      expect(await stakedToken.balanceOf(alice.address)).to.equal(ethers.parseEther('0'));

      expect(await stakedToken.balanceOf(await votesERC20Staked.getAddress())).to.equal(
        ethers.parseEther('10'),
      );

      expect(await votesERC20Staked.totalStaked()).to.equal(ethers.parseEther('10'));

      expect(await votesERC20Staked.stakerData(alice.address)).to.deep.equal([
        ethers.parseEther('10'),
        await time.latest(),
      ]);

      expect(
        await votesERC20Staked.stakerRewardsData(await rewardsTokenA.getAddress(), alice.address),
      ).to.deep.equal([0n, 0n]);
    });

    it('should allow users to unstake tokens', async function () {
      await votesERC20Staked.connect(alice).stake(ethers.parseEther('10'));
      const stakeTimestamp = await time.latest();

      // move forward 7 days
      await time.increase(604800);

      await votesERC20Staked.connect(alice).unstake(ethers.parseEther('10'));

      expect(await votesERC20Staked.balanceOf(alice.address)).to.equal(ethers.parseEther('0'));

      expect(await stakedToken.balanceOf(alice.address)).to.equal(ethers.parseEther('10'));
      expect(await stakedToken.balanceOf(await votesERC20Staked.getAddress())).to.equal(
        ethers.parseEther('0'),
      );

      expect(await votesERC20Staked.totalStaked()).to.equal(ethers.parseEther('0'));

      expect(await votesERC20Staked.stakerData(alice.address)).to.deep.equal([
        ethers.parseEther('0'),
        stakeTimestamp,
      ]);

      expect(
        await votesERC20Staked.stakerRewardsData(await rewardsTokenA.getAddress(), alice.address),
      ).to.deep.equal([0n, 0n]);
    });

    it('should allow users to unstake less tokens than their staked amount', async function () {
      await votesERC20Staked.connect(alice).stake(ethers.parseEther('10'));
      const stakeTimestamp = await time.latest();

      // move forward 7 days
      await time.increase(604800);

      await votesERC20Staked.connect(alice).unstake(ethers.parseEther('6'));

      expect(await votesERC20Staked.balanceOf(alice.address)).to.equal(ethers.parseEther('4'));

      expect(await stakedToken.balanceOf(alice.address)).to.equal(ethers.parseEther('6'));
      expect(await stakedToken.balanceOf(await votesERC20Staked.getAddress())).to.equal(
        ethers.parseEther('4'),
      );

      expect(await votesERC20Staked.totalStaked()).to.equal(ethers.parseEther('4'));
      expect(await votesERC20Staked.stakerData(alice.address)).to.deep.equal([
        ethers.parseEther('4'),
        stakeTimestamp,
      ]);

      expect(
        await votesERC20Staked.stakerRewardsData(await rewardsTokenA.getAddress(), alice.address),
      ).to.deep.equal([0n, 0n]);
    });

    it('should not allow users to unstake zero tokens', async function () {
      await votesERC20Staked.connect(alice).stake(ethers.parseEther('10'));

      await time.increase(604800);

      await expect(votesERC20Staked.connect(alice).unstake(0n)).to.be.revertedWithCustomError(
        votesERC20Staked,
        'ZeroUnstake',
      );
    });

    it('should not allow users to unstake tokens before their minimum staking period has elapsed', async function () {
      await votesERC20Staked.connect(alice).stake(ethers.parseEther('10'));

      await expect(
        votesERC20Staked.connect(alice).unstake(ethers.parseEther('10')),
      ).to.be.revertedWithCustomError(votesERC20Staked, 'MinimumStakingPeriod');
    });

    it('should not allow users to unstake more token than they have staked', async function () {
      await votesERC20Staked.connect(alice).stake(ethers.parseEther('10'));

      await time.increase(604800);

      await expect(
        votesERC20Staked.connect(alice).unstake(ethers.parseEther('11')),
      ).to.be.revertedWithPanic(0x11);
    });
  });

  describe('Rewards Distribution', function () {
    beforeEach(async function () {
      votesERC20Staked = await deployVotesERC20StakedProxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Staking Contract',
        'TSC',
        await stakedToken.getAddress(),
        604800n,
        [await rewardsTokenA.getAddress(), await rewardsTokenB.getAddress(), nativeAssetAddress],
      );

      // Mint 10 staked tokens to alice
      await stakedToken.mint(alice.address, ethers.parseEther('10'));

      // Alice approves the staking contract to spend her tokens
      await stakedToken
        .connect(alice)
        .approve(await votesERC20Staked.getAddress(), ethers.parseEther('10'));
    });

    it('should distribute rewards for all rewards tokens', async function () {
      await votesERC20Staked.connect(alice).stake(ethers.parseEther('10'));

      await rewardsTokenA.mint(await votesERC20Staked.getAddress(), ethers.parseEther('20'));
      await rewardsTokenB.mint(await votesERC20Staked.getAddress(), ethers.parseEther('30'));
      await ethers.provider.send('eth_sendTransaction', [
        {
          to: await votesERC20Staked.getAddress(),
          value: ethers.toBeHex(ethers.parseEther('40')),
        },
      ]);

      await votesERC20Staked.connect(rewardsDistributor)['distributeRewards()']();

      // Check token A rewards data
      expect(
        await votesERC20Staked.rewardsTokenData(await rewardsTokenA.getAddress()),
      ).to.deep.equal([
        ethers.parseEther('2'), // rewardsRate: 20/10 = 2
        ethers.parseEther('20'), // rewardsDistributed
        ethers.parseEther('0'), // rewardsClaimed
      ]);

      // Check token B rewards data
      expect(
        await votesERC20Staked.rewardsTokenData(await rewardsTokenB.getAddress()),
      ).to.deep.equal([
        ethers.parseEther('3'), // rewardsRate: 30/10 = 3
        ethers.parseEther('30'), // rewardsDistributed
        ethers.parseEther('0'), // rewardsClaimed
      ]);

      // Check native asset rewards data
      expect(await votesERC20Staked.rewardsTokenData(nativeAssetAddress)).to.deep.equal([
        ethers.parseEther('4'), // rewardsRate: 40/10 = 4
        ethers.parseEther('40'), // rewardsDistributed
        ethers.parseEther('0'), // rewardsClaimed
      ]);

      // Distribute more rewards for token A
      await rewardsTokenA.mint(await votesERC20Staked.getAddress(), ethers.parseEther('50'));
      await votesERC20Staked.connect(rewardsDistributor)['distributeRewards()']();

      // Check updated rewards data for token A
      expect(
        await votesERC20Staked.rewardsTokenData(await rewardsTokenA.getAddress()),
      ).to.deep.equal([
        ethers.parseEther('7'), // rewardsRate: (20 + 50)/10 = 7
        ethers.parseEther('70'), // rewardsDistributed
        ethers.parseEther('0'), // rewardsClaimed
      ]);

      // Check rewards for token B haven't changed
      expect(
        await votesERC20Staked.rewardsTokenData(await rewardsTokenB.getAddress()),
      ).to.deep.equal([
        ethers.parseEther('3'), // rewardsRate: 30/10 = 3
        ethers.parseEther('30'), // rewardsDistributed
        ethers.parseEther('0'), // rewardsClaimed
      ]);

      // Check rewards for native asset haven't changed
      expect(await votesERC20Staked.rewardsTokenData(nativeAssetAddress)).to.deep.equal([
        ethers.parseEther('4'), // rewardsRate: 40/10 = 4
        ethers.parseEther('40'), // rewardsDistributed
        ethers.parseEther('0'), // rewardsClaimed
      ]);
    });

    it('should distribute rewards for specified rewards tokens', async function () {
      await votesERC20Staked.connect(alice).stake(ethers.parseEther('10'));

      await rewardsTokenA.mint(await votesERC20Staked.getAddress(), ethers.parseEther('20'));
      await rewardsTokenB.mint(await votesERC20Staked.getAddress(), ethers.parseEther('30'));
      await ethers.provider.send('eth_sendTransaction', [
        {
          to: await votesERC20Staked.getAddress(),
          value: ethers.toBeHex(ethers.parseEther('40')),
        },
      ]);

      // only distribute rewards for token A and B
      await votesERC20Staked
        .connect(rewardsDistributor)
        [
          'distributeRewards(address[])'
        ]([await rewardsTokenA.getAddress(), await rewardsTokenB.getAddress()]);

      // Check rewards for token A were distributed
      expect(
        await votesERC20Staked.rewardsTokenData(await rewardsTokenA.getAddress()),
      ).to.deep.equal([
        ethers.parseEther('2'), // rewardsRate: 20/10 = 2
        ethers.parseEther('20'), // rewardsDistributed
        ethers.parseEther('0'), // rewardsClaimed
      ]);

      // Check rewards for token B were distributed
      expect(
        await votesERC20Staked.rewardsTokenData(await rewardsTokenB.getAddress()),
      ).to.deep.equal([
        ethers.parseEther('3'), // rewardsRate: 30/10 = 3
        ethers.parseEther('30'), // rewardsDistributed
        ethers.parseEther('0'), // rewardsClaimed
      ]);

      // Check rewards for native asset haven't been distributed
      expect(await votesERC20Staked.rewardsTokenData(nativeAssetAddress)).to.deep.equal([
        ethers.parseEther('0'), // rewardsRate: 0/10 = 0
        ethers.parseEther('0'), // rewardsDistributed
        ethers.parseEther('0'), // rewardsClaimed
      ]);

      // now distribute rewards for native asset
      await votesERC20Staked
        .connect(rewardsDistributor)
        ['distributeRewards(address[])']([nativeAssetAddress]);

      // Check rewards for token A haven't changed
      expect(
        await votesERC20Staked.rewardsTokenData(await rewardsTokenA.getAddress()),
      ).to.deep.equal([
        ethers.parseEther('2'), // rewardsRate: 20/10 = 2
        ethers.parseEther('20'), // rewardsDistributed
        ethers.parseEther('0'), // rewardsClaimed
      ]);

      // Check rewards for token B haven't changed
      expect(
        await votesERC20Staked.rewardsTokenData(await rewardsTokenB.getAddress()),
      ).to.deep.equal([
        ethers.parseEther('3'), // rewardsRate: 30/10 = 3
        ethers.parseEther('30'), // rewardsDistributed
        ethers.parseEther('0'), // rewardsClaimed
      ]);

      // Check rewards for native asset have now been distributed
      expect(await votesERC20Staked.rewardsTokenData(nativeAssetAddress)).to.deep.equal([
        ethers.parseEther('4'), // rewardsRate: 40/10 = 4
        ethers.parseEther('40'), // rewardsDistributed
        ethers.parseEther('0'), // rewardsClaimed
      ]);
    });

    it('should not distribute rewards if staked amount is zero', async function () {
      await expect(
        votesERC20Staked.connect(rewardsDistributor)['distributeRewards()'](),
      ).to.be.revertedWithCustomError(votesERC20Staked, 'ZeroStaked');

      await expect(
        votesERC20Staked
          .connect(rewardsDistributor)
          ['distributeRewards(address[])']([await rewardsTokenA.getAddress()]),
      ).to.be.revertedWithCustomError(votesERC20Staked, 'ZeroStaked');
    });

    it('should not distribute rewards for a token that is not enabled', async function () {
      await votesERC20Staked.connect(alice).stake(ethers.parseEther('10'));

      await rewardsTokenC.mint(await votesERC20Staked.getAddress(), ethers.parseEther('20'));

      await expect(
        votesERC20Staked
          .connect(rewardsDistributor)
          ['distributeRewards(address[])']([await rewardsTokenC.getAddress()]),
      )
        .to.be.revertedWithCustomError(votesERC20Staked, 'InvalidRewardsToken')
        .withArgs(await rewardsTokenC.getAddress());
    });

    it('should return distributable rewards rewards tokens', async function () {
      await votesERC20Staked.connect(alice).stake(ethers.parseEther('10'));

      await rewardsTokenA.mint(await votesERC20Staked.getAddress(), ethers.parseEther('20'));
      await rewardsTokenB.mint(await votesERC20Staked.getAddress(), ethers.parseEther('30'));
      await ethers.provider.send('eth_sendTransaction', [
        {
          to: await votesERC20Staked.getAddress(),
          value: ethers.toBeHex(ethers.parseEther('40')),
        },
      ]);

      expect(await votesERC20Staked['distributableRewards()']()).to.deep.equal([
        ethers.parseEther('20'),
        ethers.parseEther('30'),
        ethers.parseEther('40'),
      ]);

      expect(
        await votesERC20Staked['distributableRewards(address[])']([
          await rewardsTokenA.getAddress(),
          await rewardsTokenB.getAddress(),
        ]),
      ).to.deep.equal([ethers.parseEther('20'), ethers.parseEther('30')]);

      expect(
        await votesERC20Staked['distributableRewards(address[])']([nativeAssetAddress]),
      ).to.deep.equal([ethers.parseEther('40')]);
    });
  });

  describe('Claiming', function () {
    beforeEach(async function () {
      votesERC20Staked = await deployVotesERC20StakedProxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Staking Contract',
        'TSC',
        await stakedToken.getAddress(),
        604800n,
        [await rewardsTokenA.getAddress(), await rewardsTokenB.getAddress(), nativeAssetAddress],
      );

      // Mint 10 staked tokens to alice
      await stakedToken.mint(alice.address, ethers.parseEther('10'));

      // Mint 30 staked tokens to bob
      await stakedToken.mint(bob.address, ethers.parseEther('30'));

      // Alice approves the staking contract to spend her tokens
      await stakedToken
        .connect(alice)
        .approve(await votesERC20Staked.getAddress(), ethers.parseEther('10'));

      // Bob approves the staking contract to spend his tokens
      await stakedToken
        .connect(bob)
        .approve(await votesERC20Staked.getAddress(), ethers.parseEther('30'));
    });

    it('should return claimable rewards for all tokens', async function () {
      await votesERC20Staked.connect(alice).stake(ethers.parseEther('10'));
      await votesERC20Staked.connect(bob).stake(ethers.parseEther('30'));

      await rewardsTokenA.mint(await votesERC20Staked.getAddress(), ethers.parseEther('20'));
      await rewardsTokenB.mint(await votesERC20Staked.getAddress(), ethers.parseEther('40'));
      await ethers.provider.send('eth_sendTransaction', [
        {
          to: await votesERC20Staked.getAddress(),
          value: ethers.toBeHex(ethers.parseEther('60')),
        },
      ]);

      await votesERC20Staked.connect(rewardsDistributor)['distributeRewards()']();

      // Alice => 25% of available rewards
      // Bob => 75% of available rewards

      expect(await votesERC20Staked['claimableRewards(address)'](alice.address)).to.deep.equal([
        ethers.parseEther('5'),
        ethers.parseEther('10'),
        ethers.parseEther('15'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](bob.address)).to.deep.equal([
        ethers.parseEther('15'),
        ethers.parseEther('30'),
        ethers.parseEther('45'),
      ]);
    });

    it('should return claimable rewards for specified tokens', async function () {
      await votesERC20Staked.connect(alice).stake(ethers.parseEther('10'));
      await votesERC20Staked.connect(bob).stake(ethers.parseEther('30'));

      await rewardsTokenA.mint(await votesERC20Staked.getAddress(), ethers.parseEther('20'));
      await rewardsTokenB.mint(await votesERC20Staked.getAddress(), ethers.parseEther('40'));
      await ethers.provider.send('eth_sendTransaction', [
        {
          to: await votesERC20Staked.getAddress(),
          value: ethers.toBeHex(ethers.parseEther('60')),
        },
      ]);

      await votesERC20Staked.connect(rewardsDistributor)['distributeRewards()']();

      // Alice => 25% of available rewards
      // Bob => 75% of available rewards

      expect(
        await votesERC20Staked['claimableRewards(address,address[])'](alice.address, [
          await rewardsTokenA.getAddress(),
          await rewardsTokenB.getAddress(),
        ]),
      ).to.deep.equal([ethers.parseEther('5'), ethers.parseEther('10')]);

      expect(
        await votesERC20Staked['claimableRewards(address,address[])'](alice.address, [
          nativeAssetAddress,
        ]),
      ).to.deep.equal([ethers.parseEther('15')]);

      expect(
        await votesERC20Staked['claimableRewards(address,address[])'](bob.address, [
          await rewardsTokenA.getAddress(),
          await rewardsTokenB.getAddress(),
        ]),
      ).to.deep.equal([ethers.parseEther('15'), ethers.parseEther('30')]);

      expect(
        await votesERC20Staked['claimableRewards(address,address[])'](bob.address, [
          nativeAssetAddress,
        ]),
      ).to.deep.equal([ethers.parseEther('45')]);
    });

    it('should allow stakers to claim rewards for all tokens', async function () {
      // Alice and Bob stake their tokens
      await votesERC20Staked.connect(alice).stake(ethers.parseEther('10'));
      await votesERC20Staked.connect(bob).stake(ethers.parseEther('30'));

      // Transfer tokens and ETH to the staking contract
      await rewardsTokenA.mint(await votesERC20Staked.getAddress(), ethers.parseEther('20'));
      await rewardsTokenB.mint(await votesERC20Staked.getAddress(), ethers.parseEther('40'));
      await ethers.provider.send('eth_sendTransaction', [
        {
          to: await votesERC20Staked.getAddress(),
          value: ethers.toBeHex(ethers.parseEther('60')),
        },
      ]);

      // Distribute the rewards
      await votesERC20Staked.connect(rewardsDistributor)['distributeRewards()']();

      // Alice => 25% of available rewards
      // Bob => 75% of available rewards

      // Alice claims rewards for all tokens
      await executeTxAndCheckBalanceDeltas(
        () => votesERC20Staked.connect(alice)['claimRewards(address)'](alice.address),
        alice,
        [
          {
            addressToCheck: alice.address,
            token: await rewardsTokenA.getAddress(),
            expectedBalanceDelta: ethers.parseEther('5'),
          },
          {
            addressToCheck: alice.address,
            token: await rewardsTokenB.getAddress(),
            expectedBalanceDelta: ethers.parseEther('10'),
          },
          {
            addressToCheck: alice.address,
            token: 'native',
            expectedBalanceDelta: ethers.parseEther('15'),
          },
        ],
      );

      // Bob claims rewards for all tokens
      await executeTxAndCheckBalanceDeltas(
        () => votesERC20Staked.connect(bob)['claimRewards(address)'](bob.address),
        bob,
        [
          {
            addressToCheck: bob.address,
            token: await rewardsTokenA.getAddress(),
            expectedBalanceDelta: ethers.parseEther('15'),
          },
          {
            addressToCheck: bob.address,
            token: await rewardsTokenB.getAddress(),
            expectedBalanceDelta: ethers.parseEther('30'),
          },
          {
            addressToCheck: bob.address,
            token: 'native',
            expectedBalanceDelta: ethers.parseEther('45'),
          },
        ],
      );
    });

    it('should allow stakers to claim rewards for specified tokens', async function () {
      // Alice and Bob stake their tokens
      await votesERC20Staked.connect(alice).stake(ethers.parseEther('10'));
      await votesERC20Staked.connect(bob).stake(ethers.parseEther('30'));

      // Transfer tokens and ETH to the staking contract
      await rewardsTokenA.mint(await votesERC20Staked.getAddress(), ethers.parseEther('20'));
      await rewardsTokenB.mint(await votesERC20Staked.getAddress(), ethers.parseEther('40'));
      await ethers.provider.send('eth_sendTransaction', [
        {
          to: await votesERC20Staked.getAddress(),
          value: ethers.toBeHex(ethers.parseEther('60')),
        },
      ]);

      // Distribute the rewards
      await votesERC20Staked.connect(rewardsDistributor)['distributeRewards()']();

      // Alice claims rewards for token A and B
      await executeTxAndCheckBalanceDeltas(
        async () =>
          votesERC20Staked
            .connect(alice)
            [
              'claimRewards(address,address[])'
            ](alice.address, [await rewardsTokenA.getAddress(), await rewardsTokenB.getAddress()]),
        alice,
        [
          {
            addressToCheck: alice.address,
            token: await rewardsTokenA.getAddress(),
            expectedBalanceDelta: ethers.parseEther('5'),
          },
          {
            addressToCheck: alice.address,
            token: await rewardsTokenB.getAddress(),
            expectedBalanceDelta: ethers.parseEther('10'),
          },
          {
            addressToCheck: alice.address,
            token: 'native',
            expectedBalanceDelta: ethers.parseEther('0'),
          },
        ],
      );

      // Alice claims rewards for native asset
      await executeTxAndCheckBalanceDeltas(
        async () =>
          votesERC20Staked
            .connect(alice)
            ['claimRewards(address,address[])'](alice.address, [nativeAssetAddress]),
        alice,
        [
          {
            addressToCheck: alice.address,
            token: await rewardsTokenA.getAddress(),
            expectedBalanceDelta: ethers.parseEther('0'),
          },
          {
            addressToCheck: alice.address,
            token: await rewardsTokenB.getAddress(),
            expectedBalanceDelta: ethers.parseEther('0'),
          },
          {
            addressToCheck: alice.address,
            token: 'native',
            expectedBalanceDelta: ethers.parseEther('15'),
          },
        ],
      );

      // Bob claims rewards for token A and B
      await executeTxAndCheckBalanceDeltas(
        async () =>
          votesERC20Staked
            .connect(bob)
            ['claimRewards(address,address[])'](bob.address, [await rewardsTokenA.getAddress()]),
        bob,
        [
          {
            addressToCheck: bob.address,
            token: await rewardsTokenA.getAddress(),
            expectedBalanceDelta: ethers.parseEther('15'),
          },
          {
            addressToCheck: bob.address,
            token: await rewardsTokenB.getAddress(),
            expectedBalanceDelta: ethers.parseEther('0'),
          },
          {
            addressToCheck: bob.address,
            token: 'native',
            expectedBalanceDelta: ethers.parseEther('0'),
          },
        ],
      );

      // Bob claims rewards for native asset
      await executeTxAndCheckBalanceDeltas(
        async () =>
          votesERC20Staked
            .connect(bob)
            [
              'claimRewards(address,address[])'
            ](bob.address, [await rewardsTokenB.getAddress(), nativeAssetAddress]),
        bob,
        [
          {
            addressToCheck: bob.address,
            token: await rewardsTokenA.getAddress(),
            expectedBalanceDelta: ethers.parseEther('0'),
          },
          {
            addressToCheck: bob.address,
            token: await rewardsTokenB.getAddress(),
            expectedBalanceDelta: ethers.parseEther('30'),
          },
          {
            addressToCheck: bob.address,
            token: 'native',
            expectedBalanceDelta: ethers.parseEther('45'),
          },
        ],
      );
    });
  });

  // Note that in these tests the staked token is also one of the rewards tokens
  describe('Accounting state', function () {
    beforeEach(async function () {
      votesERC20Staked = await deployVotesERC20StakedProxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Staking Contract',
        'TSC',
        await stakedToken.getAddress(),
        604800n,
        [await stakedToken.getAddress(), await rewardsTokenB.getAddress(), nativeAssetAddress],
      );

      // Mint 100 staked tokens to alice
      await stakedToken.mint(alice.address, ethers.parseEther('100'));

      // Mint 100 staked tokens to bob
      await stakedToken.mint(bob.address, ethers.parseEther('100'));

      // Mint 100 staked tokens to carol
      await stakedToken.mint(carol.address, ethers.parseEther('100'));

      // Alice approves the staking contract to spend her tokens
      await stakedToken
        .connect(alice)
        .approve(await votesERC20Staked.getAddress(), ethers.parseEther('100'));

      // Bob approves the staking contract to spend his tokens
      await stakedToken
        .connect(bob)
        .approve(await votesERC20Staked.getAddress(), ethers.parseEther('100'));

      // Carol approves the staking contract to spend her tokens
      await stakedToken
        .connect(carol)
        .approve(await votesERC20Staked.getAddress(), ethers.parseEther('100'));
    });

    it('should update all state correctly with multiple stakes, unstakes, claims, and distributions', async function () {
      await votesERC20Staked.connect(alice).stake(ethers.parseEther('10'));
      let aliceLastStakeTimestamp = await time.latest();

      await votesERC20Staked.connect(bob).stake(ethers.parseEther('30'));
      let bobLastStakeTimestamp = await time.latest();

      // Staked amounts
      // Staker  |  Staked amount  |  Staked percentage
      // Alice   |  10             |  25%
      // Bob     |  30             |  75%
      // Carol   |  0              |  0%
      // Total   |  40

      expect(await votesERC20Staked.totalStaked()).to.equal(ethers.parseEther('40'));
      expect(await votesERC20Staked.stakerData(alice.address)).to.deep.equal([
        ethers.parseEther('10'),
        BigInt(aliceLastStakeTimestamp),
      ]);
      expect(await votesERC20Staked.stakerData(bob.address)).to.deep.equal([
        ethers.parseEther('30'),
        BigInt(bobLastStakeTimestamp),
      ]);
      expect(await votesERC20Staked.stakerData(carol.address)).to.deep.equal([
        ethers.parseEther('0'),
        0n,
      ]);

      await stakedToken.mint(await votesERC20Staked.getAddress(), ethers.parseEther('100'));
      expect(await votesERC20Staked['distributableRewards()']()).to.deep.equal([
        ethers.parseEther('100'),
        ethers.parseEther('0'),
        ethers.parseEther('0'),
      ]);

      // Distribute 100 staked tokens as rewards
      await votesERC20Staked.connect(rewardsDistributor)['distributeRewards()']();

      // Expected claimable rewards
      //        | stakedToken | rewardsTokenB | nativeAsset
      // Alice  | 25          | 0             | 0
      // Bob    | 75          | 0             | 0
      // Carol  | 0           | 0             | 0

      expect(await votesERC20Staked['claimableRewards(address)'](alice.address)).to.deep.equal([
        ethers.parseEther('25'),
        ethers.parseEther('0'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](bob.address)).to.deep.equal([
        ethers.parseEther('75'),
        ethers.parseEther('0'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](carol.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('0'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked.rewardsTokenData(await stakedToken.getAddress())).to.deep.equal(
        [
          ethers.parseEther('2.5'), // reward rate = 100 distributed / 40 total staked
          ethers.parseEther('100'), // 100 distributed
          ethers.parseEther('0'), // 0 claimed
        ],
      );

      // Bob claims rewards for all tokens
      await executeTxAndCheckBalanceDeltas(
        () => votesERC20Staked.connect(bob)['claimRewards(address)'](bob.address),
        bob,
        [
          {
            addressToCheck: bob.address,
            token: await stakedToken.getAddress(),
            expectedBalanceDelta: ethers.parseEther('75'),
          },
          {
            addressToCheck: bob.address,
            token: await rewardsTokenB.getAddress(),
            expectedBalanceDelta: ethers.parseEther('0'),
          },
          {
            addressToCheck: bob.address,
            token: 'native',
            expectedBalanceDelta: ethers.parseEther('0'),
          },
        ],
      );

      // Expected claimable rewards
      //        | stakedToken | rewardsTokenB | nativeAsset
      // Alice  | 25          | 0             | 0
      // Bob    | 0           | 0             | 0
      // Carol  | 0           | 0             | 0

      expect(await votesERC20Staked['claimableRewards(address)'](alice.address)).to.deep.equal([
        ethers.parseEther('25'),
        ethers.parseEther('0'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](bob.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('0'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](carol.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('0'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked.rewardsTokenData(await stakedToken.getAddress())).to.deep.equal(
        [
          ethers.parseEther('2.5'), // reward rate = 100 distributed / 40 total staked
          ethers.parseEther('100'), // 100 distributed
          ethers.parseEther('75'), // 75 claimed
        ],
      );

      // move time forward 1 week
      await time.increase(604800);

      // Bob unstakes 10 tokens
      await executeTxAndCheckBalanceDeltas(
        () => votesERC20Staked.connect(bob).unstake(ethers.parseEther('10')),
        bob,
        [
          {
            addressToCheck: bob.address,
            token: await stakedToken.getAddress(),
            expectedBalanceDelta: ethers.parseEther('10'),
          },
          {
            addressToCheck: bob.address,
            token: await votesERC20Staked.getAddress(),
            expectedBalanceDelta: -ethers.parseEther('10'),
          },
        ],
      );

      // alice stakes 10 more tokens
      await executeTxAndCheckBalanceDeltas(
        () => votesERC20Staked.connect(alice).stake(ethers.parseEther('10')),
        alice,
        [
          {
            addressToCheck: alice.address,
            token: await stakedToken.getAddress(),
            expectedBalanceDelta: -ethers.parseEther('10'),
          },
          {
            addressToCheck: alice.address,
            token: await votesERC20Staked.getAddress(),
            expectedBalanceDelta: ethers.parseEther('10'),
          },
        ],
      );
      aliceLastStakeTimestamp = await time.latest();

      // Staker  |  Staked amount  |  Staked percentage
      // Alice   |  20             |  50%
      // Bob     |  20             |  50%
      // Carol   |  0              |  0%
      // Total   |  40

      expect(await votesERC20Staked.totalStaked()).to.equal(ethers.parseEther('40'));
      expect(await votesERC20Staked.stakerData(alice.address)).to.deep.equal([
        ethers.parseEther('20'),
        BigInt(aliceLastStakeTimestamp),
      ]);
      expect(await votesERC20Staked.stakerData(bob.address)).to.deep.equal([
        ethers.parseEther('20'),
        BigInt(bobLastStakeTimestamp),
      ]);
      expect(await votesERC20Staked.stakerData(carol.address)).to.deep.equal([
        ethers.parseEther('0'),
        0n,
      ]);

      // Distribute 200 staked tokens as rewards
      await stakedToken.mint(await votesERC20Staked.getAddress(), ethers.parseEther('200'));
      await votesERC20Staked.connect(rewardsDistributor)['distributeRewards()']();

      // Expected claimable rewards
      //        | stakedToken | rewardsTokenB | nativeAsset
      // Alice  | 125         | 0             | 0
      // Bob    | 100         | 0             | 0
      // Carol  | 0           | 0             | 0

      expect(await votesERC20Staked['claimableRewards(address)'](alice.address)).to.deep.equal([
        ethers.parseEther('125'),
        ethers.parseEther('0'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](bob.address)).to.deep.equal([
        ethers.parseEther('100'),
        ethers.parseEther('0'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](carol.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('0'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked.rewardsTokenData(await stakedToken.getAddress())).to.deep.equal(
        [
          ethers.parseEther('7.5'), // reward rate = 2.5 + (200 distributed / 40 total staked) = 7.5
          ethers.parseEther('300'), // 300 distributed
          ethers.parseEther('75'), // 75 claimed
        ],
      );

      // carol stakes 40 tokens
      await executeTxAndCheckBalanceDeltas(
        () => votesERC20Staked.connect(carol).stake(ethers.parseEther('40')),
        carol,
        [
          {
            addressToCheck: carol.address,
            token: await stakedToken.getAddress(),
            expectedBalanceDelta: -ethers.parseEther('40'),
          },
          {
            addressToCheck: carol.address,
            token: await votesERC20Staked.getAddress(),
            expectedBalanceDelta: ethers.parseEther('40'),
          },
        ],
      );
      let carolLastStakeTimestamp = await time.latest();

      // Staker  |  Staked amount  |  Staked percentage
      // Alice   |  20             |  25%
      // Bob     |  20             |  25%
      // Carol   |  40              | 50%
      // Total   |  80

      expect(await votesERC20Staked.totalStaked()).to.equal(ethers.parseEther('80'));
      expect(await votesERC20Staked.stakerData(alice.address)).to.deep.equal([
        ethers.parseEther('20'),
        BigInt(aliceLastStakeTimestamp),
      ]);
      expect(await votesERC20Staked.stakerData(bob.address)).to.deep.equal([
        ethers.parseEther('20'),
        BigInt(bobLastStakeTimestamp),
      ]);
      expect(await votesERC20Staked.stakerData(carol.address)).to.deep.equal([
        ethers.parseEther('40'),
        BigInt(carolLastStakeTimestamp),
      ]);

      // Distribute 50 rewards token B as rewards
      await rewardsTokenB.mint(await votesERC20Staked.getAddress(), ethers.parseEther('50'));
      await votesERC20Staked.connect(rewardsDistributor)['distributeRewards()']();

      // Expected claimable rewards
      //        | stakedToken | rewardsTokenB | nativeAsset
      // Alice  | 125         | 12.5          | 0
      // Bob    | 100         | 12.5          | 0
      // Carol  | 0           | 25            | 0

      expect(await votesERC20Staked['claimableRewards(address)'](alice.address)).to.deep.equal([
        ethers.parseEther('125'),
        ethers.parseEther('12.5'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](bob.address)).to.deep.equal([
        ethers.parseEther('100'),
        ethers.parseEther('12.5'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](carol.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('25'),
        ethers.parseEther('0'),
      ]);

      expect(
        await votesERC20Staked.rewardsTokenData(await rewardsTokenB.getAddress()),
      ).to.deep.equal([
        ethers.parseEther('0.625'), // reward rate = (50 distributed / 80 total staked) = 0.625
        ethers.parseEther('50'), // 50 distributed
        ethers.parseEther('0'), // 0 claimed
      ]);

      // Carol stakes 20 more tokens
      await executeTxAndCheckBalanceDeltas(
        () => votesERC20Staked.connect(carol).stake(ethers.parseEther('20')),
        carol,
        [
          {
            addressToCheck: carol.address,
            token: await stakedToken.getAddress(),
            expectedBalanceDelta: -ethers.parseEther('20'),
          },
          {
            addressToCheck: carol.address,
            token: await votesERC20Staked.getAddress(),
            expectedBalanceDelta: ethers.parseEther('20'),
          },
        ],
      );
      carolLastStakeTimestamp = await time.latest();

      // Staker  |  Staked amount  |  Staked percentage
      // Alice   |  20             |  20%
      // Bob     |  20             |  20%
      // Carol   |  60              | 60%
      // Total   |  100

      // Bob claims rewards for staked token
      await executeTxAndCheckBalanceDeltas(
        async () =>
          votesERC20Staked
            .connect(bob)
            ['claimRewards(address,address[])'](bob.address, [await stakedToken.getAddress()]),
        bob,
        [
          {
            addressToCheck: bob.address,
            token: await stakedToken.getAddress(),
            expectedBalanceDelta: ethers.parseEther('100'),
          },
          {
            addressToCheck: await votesERC20Staked.getAddress(),
            token: await stakedToken.getAddress(),
            expectedBalanceDelta: -ethers.parseEther('100'),
          },
        ],
      );
      // Expected claimable rewards
      //        | stakedToken | rewardsTokenB | nativeAsset
      // Alice  | 125         | 12.5          | 0
      // Bob    | 0           | 12.5          | 0
      // Carol  | 0           | 25            | 0

      expect(await votesERC20Staked['claimableRewards(address)'](alice.address)).to.deep.equal([
        ethers.parseEther('125'),
        ethers.parseEther('12.5'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](bob.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('12.5'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](carol.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('25'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked.rewardsTokenData(await stakedToken.getAddress())).to.deep.equal(
        [
          ethers.parseEther('7.5'), // hasn't changed since last check
          ethers.parseEther('300'), // 300 distributed
          ethers.parseEther('175'), // 175 claimed
        ],
      );

      // Distribute 400 native assets as rewards
      await ethers.provider.send('eth_sendTransaction', [
        {
          to: await votesERC20Staked.getAddress(),
          value: ethers.toBeHex(ethers.parseEther('400')),
        },
      ]);
      await votesERC20Staked.connect(rewardsDistributor)['distributeRewards()']();

      // Expected claimable rewards
      //        | stakedToken | rewardsTokenB | nativeAsset
      // Alice  | 125         | 12.5          | 80
      // Bob    | 0           | 12.5          | 80
      // Carol  | 0           | 25            | 240

      expect(await votesERC20Staked['claimableRewards(address)'](alice.address)).to.deep.equal([
        ethers.parseEther('125'),
        ethers.parseEther('12.5'),
        ethers.parseEther('80'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](bob.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('12.5'),
        ethers.parseEther('80'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](carol.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('25'),
        ethers.parseEther('240'),
      ]);

      expect(await votesERC20Staked.rewardsTokenData(nativeAssetAddress)).to.deep.equal([
        ethers.parseEther('4'), // reward rate = 400 distributed / 100 total staked
        ethers.parseEther('400'), // 400 distributed
        ethers.parseEther('0'), // 0 claimed
      ]);

      // Bob claims all rewards
      await executeTxAndCheckBalanceDeltas(
        async () =>
          votesERC20Staked
            .connect(bob)
            [
              'claimRewards(address,address[])'
            ](bob.address, [await stakedToken.getAddress(), await rewardsTokenB.getAddress(), nativeAssetAddress]),
        bob,
        [
          {
            addressToCheck: bob.address,
            token: await stakedToken.getAddress(),
            expectedBalanceDelta: ethers.parseEther('0'),
          },
          {
            addressToCheck: bob.address,
            token: await rewardsTokenB.getAddress(),
            expectedBalanceDelta: ethers.parseEther('12.5'),
          },
          {
            addressToCheck: bob.address,
            token: 'native',
            expectedBalanceDelta: ethers.parseEther('80'),
          },
        ],
      );

      // Expected claimable rewards
      //        | stakedToken | rewardsTokenB | nativeAsset
      // Alice  | 125         | 12.5          | 80
      // Bob    | 0           | 0             | 0
      // Carol  | 0           | 25            | 240

      expect(await votesERC20Staked['claimableRewards(address)'](alice.address)).to.deep.equal([
        ethers.parseEther('125'),
        ethers.parseEther('12.5'),
        ethers.parseEther('80'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](bob.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('0'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](carol.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('25'),
        ethers.parseEther('240'),
      ]);

      expect(await votesERC20Staked.rewardsTokenData(await stakedToken.getAddress())).to.deep.equal(
        [
          ethers.parseEther('7.5'), // hasn't changed since last check
          ethers.parseEther('300'), // 300 distributed
          ethers.parseEther('175'), // 75 claimed
        ],
      );

      expect(
        await votesERC20Staked.rewardsTokenData(await rewardsTokenB.getAddress()),
      ).to.deep.equal([
        ethers.parseEther('0.625'), // hasn't changed since last check
        ethers.parseEther('50'), // 50 distributed
        ethers.parseEther('12.5'), // 12.5 claimed
      ]);

      expect(await votesERC20Staked.rewardsTokenData(nativeAssetAddress)).to.deep.equal([
        ethers.parseEther('4'), // reward rate = 400 distributed / 100 total staked
        ethers.parseEther('400'), // 400 distributed
        ethers.parseEther('80'), // 80 claimed
      ]);

      // Bob unstakes all tokens
      await executeTxAndCheckBalanceDeltas(
        () => votesERC20Staked.connect(bob).unstake(ethers.parseEther('20')),
        bob,
        [
          {
            addressToCheck: bob.address,
            token: await stakedToken.getAddress(),
            expectedBalanceDelta: ethers.parseEther('20'),
          },
          {
            addressToCheck: bob.address,
            token: await votesERC20Staked.getAddress(),
            expectedBalanceDelta: -ethers.parseEther('20'),
          },
        ],
      );

      // Staker  |  Staked amount  |  Staked percentage
      // Alice   |  20             |  25%
      // Bob     |  0              |  0%
      // Carol   |  60             |  75%
      // Total   |  80

      expect(await votesERC20Staked.totalStaked()).to.equal(ethers.parseEther('80'));
      expect(await votesERC20Staked.stakerData(alice.address)).to.deep.equal([
        ethers.parseEther('20'),
        BigInt(aliceLastStakeTimestamp),
      ]);
      expect(await votesERC20Staked.stakerData(bob.address)).to.deep.equal([
        ethers.parseEther('00'),
        BigInt(bobLastStakeTimestamp),
      ]);
      expect(await votesERC20Staked.stakerData(carol.address)).to.deep.equal([
        ethers.parseEther('60'),
        BigInt(carolLastStakeTimestamp),
      ]);

      // Distribute 100 rewards token B as rewards
      await rewardsTokenB.mint(await votesERC20Staked.getAddress(), ethers.parseEther('100'));
      await votesERC20Staked.connect(rewardsDistributor)['distributeRewards()']();

      // Expected claimable rewards
      //        | stakedToken | rewardsTokenB | nativeAsset
      // Alice  | 125         | 37.5          | 80
      // Bob    | 0           | 0             | 0
      // Carol  | 0           | 100           | 240

      expect(await votesERC20Staked['claimableRewards(address)'](alice.address)).to.deep.equal([
        ethers.parseEther('125'),
        ethers.parseEther('37.5'),
        ethers.parseEther('80'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](bob.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('0'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](carol.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('100'),
        ethers.parseEther('240'),
      ]);

      // Alice claims all rewards
      await executeTxAndCheckBalanceDeltas(
        async () =>
          votesERC20Staked
            .connect(alice)
            [
              'claimRewards(address,address[])'
            ](alice.address, [await stakedToken.getAddress(), await rewardsTokenB.getAddress(), nativeAssetAddress]),
        alice,
        [
          {
            addressToCheck: alice.address,
            token: await stakedToken.getAddress(),
            expectedBalanceDelta: ethers.parseEther('125'),
          },
          {
            addressToCheck: alice.address,
            token: await rewardsTokenB.getAddress(),
            expectedBalanceDelta: ethers.parseEther('37.5'),
          },
          {
            addressToCheck: alice.address,
            token: 'native',
            expectedBalanceDelta: ethers.parseEther('80'),
          },
        ],
      );

      // Expected claimable rewards
      //        | stakedToken | rewardsTokenB | nativeAsset
      // Alice  | 0           | 0             | 0
      // Bob    | 0           | 0             | 0
      // Carol  | 0           | 100           | 240

      expect(await votesERC20Staked['claimableRewards(address)'](alice.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('0'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](bob.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('0'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](carol.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('100'),
        ethers.parseEther('240'),
      ]);

      // move time forward one week
      await time.increase(604800);

      // Alice unstakes all tokens
      await executeTxAndCheckBalanceDeltas(
        () => votesERC20Staked.connect(alice).unstake(ethers.parseEther('20')),
        alice,
        [
          {
            addressToCheck: alice.address,
            token: await stakedToken.getAddress(),
            expectedBalanceDelta: ethers.parseEther('20'),
          },
          {
            addressToCheck: alice.address,
            token: await votesERC20Staked.getAddress(),
            expectedBalanceDelta: -ethers.parseEther('20'),
          },
        ],
      );

      // Staker  |  Staked amount  |  Staked percentage
      // Alice   |  0              |  0%
      // Bob     |  0              |  0%
      // Carol   |  60             |  100%
      // Total   |  60

      expect(await votesERC20Staked.totalStaked()).to.equal(ethers.parseEther('60'));
      expect(await votesERC20Staked.stakerData(alice.address)).to.deep.equal([
        ethers.parseEther('0'),
        BigInt(aliceLastStakeTimestamp),
      ]);
      expect(await votesERC20Staked.stakerData(bob.address)).to.deep.equal([
        ethers.parseEther('0'),
        BigInt(bobLastStakeTimestamp),
      ]);
      expect(await votesERC20Staked.stakerData(carol.address)).to.deep.equal([
        ethers.parseEther('60'),
        BigInt(carolLastStakeTimestamp),
      ]);

      // Carol unstakes all tokens
      await executeTxAndCheckBalanceDeltas(
        () => votesERC20Staked.connect(carol).unstake(ethers.parseEther('60')),
        carol,
        [
          {
            addressToCheck: carol.address,
            token: await stakedToken.getAddress(),
            expectedBalanceDelta: ethers.parseEther('60'),
          },
          {
            addressToCheck: carol.address,
            token: await votesERC20Staked.getAddress(),
            expectedBalanceDelta: -ethers.parseEther('60'),
          },
        ],
      );

      // Staker  |  Staked amount  |  Staked percentage
      // Alice   |  0              |
      // Bob     |  0              |
      // Carol   |  0              |
      // Total   |  0

      expect(await votesERC20Staked.totalStaked()).to.equal(ethers.parseEther('0'));
      expect(await votesERC20Staked.stakerData(alice.address)).to.deep.equal([
        ethers.parseEther('0'),
        BigInt(aliceLastStakeTimestamp),
      ]);
      expect(await votesERC20Staked.stakerData(bob.address)).to.deep.equal([
        ethers.parseEther('0'),
        BigInt(bobLastStakeTimestamp),
      ]);
      expect(await votesERC20Staked.stakerData(carol.address)).to.deep.equal([
        ethers.parseEther('0'),
        BigInt(carolLastStakeTimestamp),
      ]);

      // Carol claims all rewards
      await executeTxAndCheckBalanceDeltas(
        async () =>
          votesERC20Staked
            .connect(carol)
            [
              'claimRewards(address,address[])'
            ](carol.address, [await stakedToken.getAddress(), await rewardsTokenB.getAddress(), nativeAssetAddress]),
        carol,
        [
          {
            addressToCheck: carol.address,
            token: await stakedToken.getAddress(),
            expectedBalanceDelta: ethers.parseEther('0'),
          },
          {
            addressToCheck: carol.address,
            token: await rewardsTokenB.getAddress(),
            expectedBalanceDelta: ethers.parseEther('100'),
          },
          {
            addressToCheck: carol.address,
            token: 'native',
            expectedBalanceDelta: ethers.parseEther('240'),
          },
        ],
      );

      // Expected claimable rewards
      //        | stakedToken | rewardsTokenB | nativeAsset
      // Alice  | 0           | 0             | 0
      // Bob    | 0           | 0             | 0
      // Carol  | 0           | 0             | 0

      expect(await votesERC20Staked['claimableRewards(address)'](alice.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('0'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](bob.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('0'),
        ethers.parseEther('0'),
      ]);

      expect(await votesERC20Staked['claimableRewards(address)'](carol.address)).to.deep.equal([
        ethers.parseEther('0'),
        ethers.parseEther('0'),
        ethers.parseEther('0'),
      ]);
    });
  });

  describe('Deployment Block', () => {
    runDeploymentBlockTests({
      getContract: () => votesERC20Staked,
    });
  });
});
