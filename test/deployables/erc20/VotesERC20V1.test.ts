import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { mine, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC1967Proxy__factory,
  IDeploymentBlockV1__factory,
  IERC165__factory,
  IERC20__factory,
  IERC20Permit__factory,
  IVersion__factory,
  IVotes__factory,
  IVotesERC20V1__factory,
  VotesERC20V1,
  VotesERC20V1__factory,
} from '../../../typechain-types';
import { runDeploymentBlockTests } from '../../helpers/deploymentBlockTests';
import { calculateInterfaceId } from '../../helpers/utils';
import { runUUPSUpgradeabilityTests } from '../../helpers/uupsUpgradeabilityTests';

// Helper function for deploying VotesERC20V1 instances using ERC1967Proxy
async function deployVotesERC20Proxy(
  proxyDeployer: SignerWithAddress,
  implementation: string,
  owner: SignerWithAddress,
  name: string,
  symbol: string,
  allocationAddresses: string[],
  allocationAmounts: bigint[],
): Promise<VotesERC20V1> {
  // Create initialization data with function selector

  const allocations = allocationAddresses.map((address, index) => ({
    to: address,
    amount: allocationAmounts[index],
  }));

  const metadata = {
    name,
    symbol,
  };

  const fullInitData = VotesERC20V1__factory.createInterface().encodeFunctionData('initialize', [
    metadata,
    allocations,
    owner.address,
  ]);

  // Deploy the proxy with the implementation
  const proxy = await new ERC1967Proxy__factory(proxyDeployer).deploy(implementation, fullInitData);

  // Return a contract instance connected to the proxy
  return VotesERC20V1__factory.connect(await proxy.getAddress(), owner);
}

describe('VotesERC20V1', () => {
  // signers
  let proxyDeployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  let nonOwner: SignerWithAddress;

  // contracts
  let votesERC20: VotesERC20V1;
  let masterCopy: string;

  beforeEach(async () => {
    // Get signers
    [proxyDeployer, owner, alice, bob, carol, nonOwner] = await ethers.getSigners();

    masterCopy = await (await new VotesERC20V1__factory(owner).deploy()).getAddress();
  });

  describe('Initialization', () => {
    it('should initialize with correct name and symbol', async () => {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Voting Token',
        'TVT',
        [],
        [],
      );

      expect(await votesERC20.name()).to.equal('Test Voting Token');
      expect(await votesERC20.symbol()).to.equal('TVT');
    });

    it('should mint initial tokens according to allocations', async () => {
      const allocationAddresses = [alice.address, bob.address, carol.address];
      const allocationAmounts = [
        ethers.parseEther('100'),
        ethers.parseEther('200'),
        ethers.parseEther('300'),
      ];

      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Voting Token',
        'TVT',
        allocationAddresses,
        allocationAmounts,
      );

      expect(await votesERC20.balanceOf(alice.address)).to.equal(allocationAmounts[0]);
      expect(await votesERC20.balanceOf(bob.address)).to.equal(allocationAmounts[1]);
      expect(await votesERC20.balanceOf(carol.address)).to.equal(allocationAmounts[2]);
      expect(await votesERC20.totalSupply()).to.equal(
        allocationAmounts[0] + allocationAmounts[1] + allocationAmounts[2],
      );
    });

    it('should handle empty allocation arrays', async () => {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Voting Token',
        'TVT',
        [],
        [],
      );

      expect(await votesERC20.totalSupply()).to.equal(0);
    });

    it('should not allow reinitialization', async () => {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Voting Token',
        'TVT',
        [],
        [],
      );

      await expect(
        votesERC20.initialize({ name: 'New Name', symbol: 'NEW' }, [], owner.address),
      ).to.be.revertedWithCustomError(votesERC20, 'InvalidInitialization');
    });

    it('Should have initialization disabled in the implementation', async function () {
      const implementationContract = VotesERC20V1__factory.connect(masterCopy, proxyDeployer);

      await expect(
        implementationContract.initialize({ name: 'New Name', symbol: 'NEW' }, [], owner.address),
      ).to.be.revertedWithCustomError(implementationContract, 'InvalidInitialization');
    });

    it('should set the owner correctly', async () => {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Voting Token',
        'TVT',
        [],
        [],
      );

      expect(await votesERC20.owner()).to.equal(owner.address);
    });
  });

  describe('Ownership', () => {
    beforeEach(async () => {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Voting Token',
        'TVT',
        [],
        [],
      );
    });

    it('should set the owner correctly', async () => {
      const currentOwner = await votesERC20.owner();
      expect(currentOwner).to.equal(owner.address);
    });

    it('should allow the owner to call authorized functions', async () => {
      await votesERC20.connect(owner).renounceOwnership();
      expect(await votesERC20.owner()).to.equal(ethers.ZeroAddress);
    });

    it('should not allow non-owners to call owner-only functions', async () => {
      await expect(votesERC20.connect(alice).renounceOwnership()).to.be.revertedWithCustomError(
        votesERC20,
        'OwnableUnauthorizedAccount',
      );
    });
  });

  describe('Version', () => {
    beforeEach(async () => {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Voting Token',
        'TVT',
        [],
        [],
      );
    });

    it('should return the correct version number', async () => {
      expect(await votesERC20.version()).to.equal(1);
    });
  });

  describe('ERC165', function () {
    beforeEach(async function () {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Voting Token',
        'TVT',
        [],
        [],
      );
    });

    it('Should support IERC165 interface', async function () {
      void expect(
        await votesERC20.supportsInterface(
          calculateInterfaceId(IERC165__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('Should support IVersion interface', async function () {
      void expect(
        await votesERC20.supportsInterface(
          calculateInterfaceId(IVersion__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('Should support IERC20 interface', async function () {
      void expect(
        await votesERC20.supportsInterface(calculateInterfaceId(IERC20__factory.createInterface())),
      ).to.be.true;
    });

    it('Should support IVotesERC20V1 interface', async function () {
      void expect(
        await votesERC20.supportsInterface(
          calculateInterfaceId(IVotesERC20V1__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('Should support IERC20Permit interface', async function () {
      void expect(
        await votesERC20.supportsInterface(
          calculateInterfaceId(IERC20Permit__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('Should support IVotes interface', async function () {
      void expect(
        await votesERC20.supportsInterface(calculateInterfaceId(IVotes__factory.createInterface())),
      ).to.be.true;
    });

    it('Should support IDeploymentBlockV1 interface', async function () {
      void expect(
        await votesERC20.supportsInterface(
          calculateInterfaceId(IDeploymentBlockV1__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('Should not support random interface', async function () {
      const randomInterfaceId = '0x12345678';
      void expect(await votesERC20.supportsInterface(randomInterfaceId)).to.be.false;
    });
  });

  describe('Timestamp-based clock functions', () => {
    beforeEach(async () => {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Voting Token',
        'TVT',
        [],
        [],
      );
    });

    it('should return current timestamp from clock()', async () => {
      const currentTime = await ethers.provider.getBlock('latest').then(b => b!.timestamp);
      const clockTime = await votesERC20.clock();

      // Allow small variance due to block mining time
      expect(Number(clockTime)).to.be.closeTo(currentTime, 5);
    });

    it("should return 'mode=timestamp' from CLOCK_MODE()", async () => {
      expect(await votesERC20.CLOCK_MODE()).to.equal('mode=timestamp');
    });

    it('should use timestamp for vote checkpoints', async () => {
      // Delegate to another address
      await votesERC20.connect(owner).delegate(alice.address);

      // Mine a block to move forward in time
      await mine(1);

      // Get current timestamp which is now > the delegation timestamp
      const currentTime = await time.latest();

      // The voting power at the previous timestamp should be available
      const votingPower = await votesERC20.getPastVotes(alice.address, currentTime - 1);

      // Should match the owner's balance since we just delegated
      expect(votingPower).to.equal(await votesERC20.balanceOf(owner.address));
    });
  });

  describe('VotesERC20V1 UUPS Upgradeability', function () {
    beforeEach(async function () {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Voting Token',
        'TVT',
        [],
        [],
      );
    });

    // Run UUPS upgradeability tests
    runUUPSUpgradeabilityTests({
      getContract: () => votesERC20,
      createNewImplementation: async () => {
        const newImplementation = await new VotesERC20V1__factory(owner).deploy();
        return newImplementation;
      },
      owner: () => owner,
      nonOwner: () => nonOwner,
    });
  });

  describe('Deployment Block', () => {
    beforeEach(async function () {
      votesERC20 = await deployVotesERC20Proxy(
        proxyDeployer,
        masterCopy,
        owner,
        'Test Voting Token',
        'TVT',
        [],
        [],
      );
    });

    runDeploymentBlockTests({
      getContract: () => votesERC20,
    });
  });
});
