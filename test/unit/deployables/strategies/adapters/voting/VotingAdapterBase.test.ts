import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ConcreteVotingAdapterBase,
  ConcreteVotingAdapterBase__factory,
  ERC1967Proxy__factory,
  MockVotingStrategy,
  MockVotingStrategy__factory,
} from '../../../../../../typechain-types';

describe('VotingAdapterBase', () => {
  let deployer: SignerWithAddress;
  let eoaStrategySigner: SignerWithAddress; // An EOA that will be designated as the strategy for some tests
  let nonStrategySigner: SignerWithAddress;
  let concreteAdapterImplementationAddress: string;
  let mockStrategyContract: MockVotingStrategy; // Actual MockVotingStrategy contract instance

  async function deployImplementationFixture() {
    const [d, s, ns] = await ethers.getSigners();
    const factory = new ConcreteVotingAdapterBase__factory(d);
    const impl = await factory.deploy();
    await impl.waitForDeployment();
    return {
      implAddress: await impl.getAddress(),
      deployer: d,
      eoaStrategySigner: s,
      nonStrategySigner: ns,
    };
  }

  async function deployMockStrategyFixture() {
    const [d] = await ethers.getSigners(); // Deployer for the mock strategy
    const strategyFactory = new MockVotingStrategy__factory(d);
    // The proposer for MockVotingStrategy doesn't matter for these tests
    const strategy = await strategyFactory.deploy(d.address);
    await strategy.waitForDeployment();
    return { mockStrategyContract: strategy };
  }

  before(async () => {
    const {
      implAddress,
      deployer: d,
      eoaStrategySigner: es,
      nonStrategySigner: ns,
    } = await loadFixture(deployImplementationFixture);
    concreteAdapterImplementationAddress = implAddress;
    deployer = d;
    eoaStrategySigner = es;
    nonStrategySigner = ns;

    const { mockStrategyContract: ms } = await loadFixture(deployMockStrategyFixture);
    mockStrategyContract = ms;
  });

  async function deployAdapterProxy(
    strategyAddressToSet: string,
  ): Promise<ConcreteVotingAdapterBase> {
    const factory = new ConcreteVotingAdapterBase__factory(deployer);
    const initData = factory.interface.encodeFunctionData('initialize', [strategyAddressToSet]);
    const proxyFactory = new ERC1967Proxy__factory(deployer);
    const proxy = await proxyFactory.deploy(concreteAdapterImplementationAddress, initData);
    await proxy.waitForDeployment();
    return ConcreteVotingAdapterBase__factory.connect(await proxy.getAddress(), deployer);
  }

  describe('Initialization', () => {
    it('should correctly initialize with the strategy address', async () => {
      const adapter = await deployAdapterProxy(eoaStrategySigner.address);
      expect(await adapter.strategy()).to.equal(eoaStrategySigner.address);
    });

    it('should not allow reinitialization (via proxy)', async () => {
      const adapter = await deployAdapterProxy(eoaStrategySigner.address);
      await expect(adapter.initialize(nonStrategySigner.address)).to.be.revertedWithCustomError(
        adapter,
        'InvalidInitialization',
      );
    });

    it('implementation contract should have initializers disabled', async () => {
      const implContract = ConcreteVotingAdapterBase__factory.connect(
        concreteAdapterImplementationAddress,
        deployer,
      );
      await expect(
        implContract.initialize(eoaStrategySigner.address),
      ).to.be.revertedWithCustomError(implContract, 'InvalidInitialization');
    });
  });

  describe('strategy() view function', () => {
    it('should return the correct strategy address after initialization', async () => {
      const adapter = await deployAdapterProxy(eoaStrategySigner.address);
      expect(await adapter.strategy()).to.equal(eoaStrategySigner.address);
    });
  });

  describe('onlyStrategy modifier', () => {
    let adapter: ConcreteVotingAdapterBase;

    beforeEach(async () => {
      // For these tests, the adapter is initialized with the address of the deployed MockVotingStrategy contract
      adapter = await deployAdapterProxy(await mockStrategyContract.getAddress());
      // Ensure the mock strategy is aware of the adapter it's supposed to call (for the success case)
      await mockStrategyContract.setVotingAdapter(await adapter.getAddress(), true);
    });

    it('should allow recordVote to be called by the strategy contract via MockVotingStrategy.vote', async () => {
      const proposalId = 1;
      const adapterVoteData = ethers.ZeroHash; // Dummy data for the adapter

      await expect(
        mockStrategyContract.connect(nonStrategySigner).castVote(
          proposalId,
          0, // voteType (e.g., YES)
          [
            {
              votingAdapter: await adapter.getAddress(),
              adapterVoteData: adapterVoteData,
            },
          ],
          0n, // lightAccountIndex
        ),
      ).to.not.be.reverted; // Primary check: the call succeeds
    });

    it('should revert if recordVote is called directly by a non-strategy EOA', async () => {
      const voterAddress = nonStrategySigner.address;
      const proposalId = 1;
      const adapterVoteData = ethers.ZeroHash;
      await expect(
        adapter.connect(nonStrategySigner).recordVote(voterAddress, proposalId, adapterVoteData),
      ).to.be.revertedWithCustomError(adapter, 'NotStrategy');
    });
  });

  describe('onlyAuthorizedFreezeVoter modifier', () => {
    let adapter: ConcreteVotingAdapterBase;
    let authorizedCaller: SignerWithAddress;
    let unauthorizedCaller: SignerWithAddress;
    const dummyVoterAddress = ethers.Wallet.createRandom().address;
    const dummySnapshotAndId = 12345;
    const dummyAdapterVoteData = ethers.ZeroHash;

    beforeEach(async () => {
      // Deploy a new adapter instance for each test, initialized with the global mockStrategyContract
      adapter = await deployAdapterProxy(await mockStrategyContract.getAddress());

      // Setup distinct signers for testing authorization
      // deployer, eoaStrategySigner, nonStrategySigner are already globally available from the outer describe.
      // Let's use eoaStrategySigner as the one we might authorize, and nonStrategySigner as unauthorized.
      authorizedCaller = eoaStrategySigner;
      unauthorizedCaller = nonStrategySigner;
    });

    it('should revert if recordFreezeVote is called by an unauthorized EOA', async () => {
      // Ensure unauthorizedCaller is indeed not authorized
      await mockStrategyContract.removeAuthorizedFreezeVoter(unauthorizedCaller.address);

      await expect(
        adapter
          .connect(unauthorizedCaller)
          .recordFreezeVote(dummyVoterAddress, dummySnapshotAndId, dummyAdapterVoteData),
      )
        .to.be.revertedWithCustomError(adapter, 'UnauthorizedFreezeVoter')
        .withArgs(unauthorizedCaller.address);
    });

    it('should allow recordFreezeVote to be called by an authorized EOA', async () => {
      await mockStrategyContract.addAuthorizedFreezeVoter(authorizedCaller.address);

      await expect(
        adapter
          .connect(authorizedCaller)
          .recordFreezeVote(dummyVoterAddress, dummySnapshotAndId, dummyAdapterVoteData),
      ).to.emit(adapter, 'FreezeVoteRecorded'); // Check for event from Concrete implementation
    });

    it('should revert if an EOA was authorized then de-authorized', async () => {
      await mockStrategyContract.addAuthorizedFreezeVoter(authorizedCaller.address);
      // Call once successfully (optional, but good check)
      await expect(
        adapter
          .connect(authorizedCaller)
          .recordFreezeVote(dummyVoterAddress, dummySnapshotAndId, dummyAdapterVoteData),
      ).to.emit(adapter, 'FreezeVoteRecorded');

      await mockStrategyContract.removeAuthorizedFreezeVoter(authorizedCaller.address);

      await expect(
        adapter
          .connect(authorizedCaller)
          .recordFreezeVote(dummyVoterAddress, dummySnapshotAndId, dummyAdapterVoteData),
      )
        .to.be.revertedWithCustomError(adapter, 'UnauthorizedFreezeVoter')
        .withArgs(authorizedCaller.address);
    });

    it('should allow multiple authorized callers, and restrict unauthorized ones', async () => {
      const anotherAuthorizedCaller = deployer; // Using deployer as another distinct authorized caller
      await mockStrategyContract.addAuthorizedFreezeVoter(authorizedCaller.address);
      await mockStrategyContract.addAuthorizedFreezeVoter(anotherAuthorizedCaller.address);
      await mockStrategyContract.removeAuthorizedFreezeVoter(unauthorizedCaller.address);

      await expect(
        adapter
          .connect(authorizedCaller)
          .recordFreezeVote(dummyVoterAddress, dummySnapshotAndId, dummyAdapterVoteData),
      ).to.emit(adapter, 'FreezeVoteRecorded');
      await expect(
        adapter
          .connect(anotherAuthorizedCaller)
          .recordFreezeVote(dummyVoterAddress, dummySnapshotAndId, dummyAdapterVoteData),
      ).to.emit(adapter, 'FreezeVoteRecorded');

      await expect(
        adapter
          .connect(unauthorizedCaller)
          .recordFreezeVote(dummyVoterAddress, dummySnapshotAndId, dummyAdapterVoteData),
      )
        .to.be.revertedWithCustomError(adapter, 'UnauthorizedFreezeVoter')
        .withArgs(unauthorizedCaller.address);
    });
  });
});
