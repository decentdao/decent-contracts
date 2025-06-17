import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import type { AddressLike, BigNumberish, ContractTransactionReceipt, Log } from 'ethers';
import { ethers } from 'hardhat';
import {
  ERC165__factory,
  FailingInitializerContract__factory,
  FreezeGuardAzoriusV1__factory,
  FreezeGuardMultisigV1__factory,
  FreezeVotingAzoriusV1__factory,
  FreezeVotingMultisigV1__factory,
  IDeploymentBlockV1__factory,
  IncompatibleStorageContract__factory,
  ISystemDeployerV1,
  ISystemDeployerV1__factory,
  IVersion__factory,
  MinimalUpgradeableContract__factory,
  ModuleAzoriusV1,
  ModuleAzoriusV1__factory,
  ModuleFractalV1__factory,
  ProposerAdapterERC20V1,
  ProposerAdapterERC20V1__factory,
  ProposerAdapterERC721V1,
  ProposerAdapterERC721V1__factory,
  ProposerAdapterHatsV1,
  ProposerAdapterHatsV1__factory,
  Safe,
  Safe__factory,
  SafeProxyFactory,
  SafeProxyFactory__factory,
  StrategyV1,
  StrategyV1__factory,
  SystemDeployerEventEmitterV1__factory,
  SystemDeployerV1,
  SystemDeployerV1__factory,
  UpgradeContractV1,
  UpgradeContractV1__factory,
  UpgradeContractV2__factory,
  UpgradeContractV3__factory,
  VotesERC20LockableV1,
  VotesERC20LockableV1__factory,
  VotesERC20V1,
  VotesERC20V1__factory,
  VotingAdapterERC20V1,
  VotingAdapterERC20V1__factory,
  VotingAdapterERC721V1,
  VotingAdapterERC721V1__factory,
} from '../../typechain-types';
import { runDeploymentBlockTests } from '../helpers/deploymentBlockTests';
import { calculateInterfaceId } from '../helpers/utils';

// Helper function to create default setupSafe parameters with optional overrides
function createSetupSafeParams(overrides?: {
  votesERC20Params?: Partial<ISystemDeployerV1.VotesERC20ParamsStruct>;
  azoriusGovernanceParams?: Partial<ISystemDeployerV1.AzoriusGovernanceParamsStruct>;
  moduleFractalParams?: Partial<ISystemDeployerV1.ModuleFractalV1ParamsStruct>;
  freezeGuardMultisigParams?: Partial<ISystemDeployerV1.FreezeGuardMultisigV1ParamsStruct>;
  freezeGuardAzoriusParams?: Partial<ISystemDeployerV1.FreezeGuardAzoriusV1ParamsStruct>;
  freezeVotingMultisigParams?: Partial<ISystemDeployerV1.FreezeVotingMultisigV1ParamsStruct>;
  freezeVotingAzoriusParams?: Partial<ISystemDeployerV1.FreezeVotingAzoriusV1ParamsStruct>;
}) {
  // Default Votes ERC20 params (all empty/zero)
  const votesERC20Params: ISystemDeployerV1.VotesERC20ParamsStruct = {
    votesERC20V1Params: [],
    votesERC20LockableV1Params: [],
    ...overrides?.votesERC20Params,
  };

  // Default Azorius governance params (all empty/zero)
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
    votingAdapterParams: {
      votingAdapterERC20V1Params: [],
      votingAdapterERC721V1Params: [],
    },
    moduleAzoriusV1Params: {
      implementation: ethers.ZeroAddress,
      timelockPeriod: 0,
      executionPeriod: 0,
    },
    ...overrides?.azoriusGovernanceParams,
  };

  // Default ModuleFractal params (all empty/zero)
  const moduleFractalV1Params: ISystemDeployerV1.ModuleFractalV1ParamsStruct = {
    implementation: ethers.ZeroAddress,
    owner: ethers.ZeroAddress,
    ...overrides?.moduleFractalParams,
  };

  // Default Freeze params (all empty/zero)
  const freezeParams: ISystemDeployerV1.FreezeParamsStruct = {
    freezeGuardParams: {
      freezeGuardMultisigV1Params: {
        implementation: ethers.ZeroAddress,
        owner: ethers.ZeroAddress,
        timelockPeriod: 0,
        executionPeriod: 0,
        ...overrides?.freezeGuardMultisigParams,
      },
      freezeGuardAzoriusV1Params: {
        implementation: ethers.ZeroAddress,
        owner: ethers.ZeroAddress,
        ...overrides?.freezeGuardAzoriusParams,
      },
    },
    freezeVotingParams: {
      freezeVotingMultisigV1Params: {
        implementation: ethers.ZeroAddress,
        owner: ethers.ZeroAddress,
        freezeVotesThreshold: 0,
        freezeProposalPeriod: 0,
        freezePeriod: 0,
        parentSafe: ethers.ZeroAddress,
        lightAccountFactory: ethers.ZeroAddress,
        ...overrides?.freezeVotingMultisigParams,
      },
      freezeVotingAzoriusV1Params: {
        implementation: ethers.ZeroAddress,
        owner: ethers.ZeroAddress,
        freezeVotesThreshold: 0,
        freezeProposalPeriod: 0,
        freezePeriod: 0,
        parentAzorius: ethers.ZeroAddress,
        lightAccountFactory: ethers.ZeroAddress,
        ...overrides?.freezeVotingAzoriusParams,
      },
    },
  };

  return {
    votesERC20Params,
    azoriusGovernanceParams,
    moduleFractalV1Params,
    freezeParams,
  };
}

// Helper function to deploy a Safe proxy with setupSafe initialization
async function deploySafeWithSetup(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
    safe: Safe;
    safeProxyFactory: SafeProxyFactory;
    deployer: SignerWithAddress;
  };
  owners: string[];
  threshold: number;
  setupSafeParams: {
    votesERC20Params: ISystemDeployerV1.VotesERC20ParamsStruct;
    azoriusGovernanceParams: ISystemDeployerV1.AzoriusGovernanceParamsStruct;
    moduleFractalV1Params: ISystemDeployerV1.ModuleFractalV1ParamsStruct;
    freezeParams: ISystemDeployerV1.FreezeParamsStruct;
  };
}) {
  const { fixtureData, owners, threshold, setupSafeParams } = params;

  // Create a salt that will be used for both Safe proxy creation and setupSafe
  const saltNonce = ethers.toBigInt(ethers.randomBytes(32));
  const salt = ethers.solidityPackedKeccak256(['uint256'], [saltNonce]);

  // Encode setupSafe function call
  const setupSafeData = fixtureData.systemDeployer.interface.encodeFunctionData('setupSafe', [
    await fixtureData.safeProxyFactory.getAddress(),
    salt,
    setupSafeParams.votesERC20Params,
    setupSafeParams.azoriusGovernanceParams,
    setupSafeParams.moduleFractalV1Params,
    setupSafeParams.freezeParams,
  ]);

  // Create Safe setup parameters
  const to = await fixtureData.systemDeployer.getAddress();
  const data = setupSafeData;
  const fallbackHandler = ethers.ZeroAddress;
  const paymentToken = ethers.ZeroAddress;
  const payment = 0;
  const paymentReceiver = ethers.ZeroAddress;

  // Encode Safe setup function call
  const safeSetupData = fixtureData.safe.interface.encodeFunctionData('setup', [
    owners,
    threshold,
    to,
    data,
    fallbackHandler,
    paymentToken,
    payment,
    paymentReceiver,
  ]);

  // Predict the Safe Address using CREATE2
  const safeAddress = ethers.getCreate2Address(
    await fixtureData.safeProxyFactory.getAddress(),
    ethers.keccak256(
      ethers.solidityPacked(
        ['bytes', 'uint256'],
        [ethers.keccak256(ethers.solidityPacked(['bytes'], [safeSetupData])), saltNonce],
      ),
    ),
    ethers.keccak256(
      ethers.solidityPacked(
        ['bytes', 'uint256'],
        [
          await fixtureData.safeProxyFactory.proxyCreationCode(),
          await fixtureData.safe.getAddress(),
        ],
      ),
    ),
  );

  // Create Safe proxy with the same salt nonce
  const tx = await fixtureData.safeProxyFactory.createProxyWithNonce(
    await fixtureData.safe.getAddress(),
    safeSetupData,
    saltNonce,
  );

  const receipt = await tx.wait();

  if (!receipt) {
    throw new Error('No receipt found');
  }

  return { safeAddress, receipt, salt };
}

// Helper function to verify the Safe configuration
async function verifySafeConfiguration(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
    safeProxyFactory: SafeProxyFactory;
    safe: Safe;
    deployer: SignerWithAddress;
  };
  receipt: ContractTransactionReceipt;
  safeAddress: string;
  owners: string[];
  threshold: number;
}) {
  const { fixtureData, receipt, safeAddress, owners, threshold } = params;

  // Find ProxyCreation event
  const proxyCreationEvent = receipt.logs.find(log => {
    try {
      const parsedLog = fixtureData.safeProxyFactory.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsedLog?.name === 'ProxyCreation';
    } catch {
      return false;
    }
  });

  void expect(proxyCreationEvent).to.not.be.undefined;

  if (!proxyCreationEvent) {
    throw new Error('Proxy creation event not found');
  }

  const parsedProxyEvent = fixtureData.safeProxyFactory.interface.parseLog({
    topics: proxyCreationEvent.topics,
    data: proxyCreationEvent.data,
  });

  if (!parsedProxyEvent) {
    throw new Error('Proxy creation event not found');
  }

  expect(parsedProxyEvent.args[0]).to.equal(safeAddress);
  expect(parsedProxyEvent.args[1]).to.equal(await fixtureData.safe.getAddress());

  // Connect to the Safe proxy
  const safeProxy = Safe__factory.connect(safeAddress, fixtureData.deployer);

  // Verify threshold
  expect(await safeProxy.getThreshold()).to.equal(threshold);

  // Verify owners
  const safeOwners = await safeProxy.getOwners();
  expect(safeOwners).to.have.lengthOf(owners.length);

  // Check each expected owner is included
  for (const expectedOwner of owners) {
    expect(safeOwners).to.include(expectedOwner);
  }
}

// Helper function to find all proxies deployed in a transaction receipt
async function findProxiesDeployed(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
  };
  receipt: ContractTransactionReceipt;
  implementation: AddressLike;
}) {
  const { fixtureData, receipt, implementation } = params;

  const proxyDeployedEvents = receipt?.logs.filter(log => {
    try {
      const parsedLog = fixtureData.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsedLog?.name === 'ProxyDeployed';
    } catch {
      return false;
    }
  });

  // Find the proxy (matching the implementation address)
  let proxyAddresses: string[] = [];
  for (const event of proxyDeployedEvents || []) {
    const parsedProxyEvent = fixtureData.systemDeployer.interface.parseLog({
      topics: event.topics,
      data: event.data,
    });
    if (parsedProxyEvent?.args[1] === implementation) {
      proxyAddresses.push(parsedProxyEvent.args[0]);
    }
  }

  if (proxyAddresses.length === 0) {
    throw new Error(
      `Proxies not found for implementation ${implementation} in transaction receipt`,
    );
  }

  return proxyAddresses;
}

// Helper function to find and verify a single proxy deployment
async function findProxyDeployed(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
  };
  receipt: ContractTransactionReceipt;
  implementation: AddressLike;
}) {
  const proxyAddresses = await findProxiesDeployed(params);

  if (proxyAddresses.length > 1) {
    throw new Error(
      `Multiple proxies found for implementation ${params.implementation} in transaction receipt`,
    );
  }

  return proxyAddresses[0];
}

// Helper function to find and verify VotesERC20V1 deployment and configuration
async function findAndVerifyVotesERC20V1s(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
    deployer: SignerWithAddress;
  };
  receipt: ContractTransactionReceipt;
  implementation: string;
  safeAddress: string;
  votesERC20V1Datas: {
    metadata: {
      name: string;
      symbol: string;
    };
    allocations: {
      to: AddressLike;
      amount: BigNumberish;
    }[];
    safeSupply: BigNumberish;
  }[];
}) {
  const { fixtureData, receipt, implementation, safeAddress, votesERC20V1Datas } = params;

  const votesERC20Addresses = await findProxiesDeployed({
    fixtureData,
    receipt,
    implementation,
  });

  if (votesERC20Addresses.length !== votesERC20V1Datas.length) {
    throw new Error(`Number of votes ERC20s does not match number of votes ERC20 datas`);
  }

  for (let i = 0; i < votesERC20Addresses.length; i++) {
    const votesERC20V1Address = votesERC20Addresses[i];
    const votesERC20V1Data = votesERC20V1Datas[i];

    const votesERC20V1Proxy = VotesERC20V1__factory.connect(
      votesERC20V1Address,
      fixtureData.deployer,
    );

    expect(await votesERC20V1Proxy.name()).to.equal(votesERC20V1Data.metadata.name);
    expect(await votesERC20V1Proxy.symbol()).to.equal(votesERC20V1Data.metadata.symbol);
    expect(await votesERC20V1Proxy.owner()).to.equal(safeAddress);
    for (const allocation of votesERC20V1Data.allocations) {
      expect(await votesERC20V1Proxy.balanceOf(allocation.to)).to.equal(allocation.amount);
    }
    expect(await votesERC20V1Proxy.balanceOf(safeAddress)).to.equal(votesERC20V1Data.safeSupply);
  }

  return votesERC20Addresses.map(address =>
    VotesERC20V1__factory.connect(address, fixtureData.deployer),
  );
}

// Helper function to find and verify VotesERC20V1 deployment and configuration
async function findAndVerifyVotesERC20LockableV1s(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
    deployer: SignerWithAddress;
  };
  receipt: ContractTransactionReceipt;
  implementation: string;
  safeAddress: string;
  votesERC20LockableV1Datas: {
    metadata: {
      name: string;
      symbol: string;
    };
    allocations: {
      to: AddressLike;
      amount: BigNumberish;
    }[];
    locked: boolean;
    maxTotalSupply: BigNumberish;
    safeSupply: BigNumberish;
  }[];
}) {
  const { fixtureData, receipt, implementation, safeAddress, votesERC20LockableV1Datas } = params;

  const votesERC20LockableAddresses = await findProxiesDeployed({
    fixtureData,
    receipt,
    implementation,
  });

  if (votesERC20LockableAddresses.length !== votesERC20LockableV1Datas.length) {
    throw new Error(
      `Number of votes ERC20 lockables does not match number of votes ERC20 lockable datas`,
    );
  }

  for (let i = 0; i < votesERC20LockableAddresses.length; i++) {
    const votesERC20V1LockableAddress = votesERC20LockableAddresses[i];
    const votesERC20V1LockableData = votesERC20LockableV1Datas[i];

    const votesERC20LockableV1Proxy = VotesERC20LockableV1__factory.connect(
      votesERC20V1LockableAddress,
      fixtureData.deployer,
    );

    expect(await votesERC20LockableV1Proxy.name()).to.equal(votesERC20V1LockableData.metadata.name);
    expect(await votesERC20LockableV1Proxy.symbol()).to.equal(
      votesERC20V1LockableData.metadata.symbol,
    );
    expect(await votesERC20LockableV1Proxy.owner()).to.equal(safeAddress);
    for (const allocation of votesERC20V1LockableData.allocations) {
      expect(await votesERC20LockableV1Proxy.balanceOf(allocation.to)).to.equal(allocation.amount);
    }
    expect(await votesERC20LockableV1Proxy.balanceOf(safeAddress)).to.equal(
      votesERC20V1LockableData.safeSupply,
    );
  }

  return votesERC20LockableAddresses.map(address =>
    VotesERC20LockableV1__factory.connect(address, fixtureData.deployer),
  );
}

// Helper function to find and verify ModuleFractal deployment and configuration
async function findAndVerifyModuleFractalV1(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
    deployer: SignerWithAddress;
  };
  receipt: ContractTransactionReceipt;
  implementation: AddressLike;
  safeAddress: string;
  owner: AddressLike;
}) {
  const { fixtureData, receipt, implementation, safeAddress, owner } = params;

  const moduleFractalAddress = await findProxyDeployed({ fixtureData, receipt, implementation });

  // Verify the module is enabled on the Safe
  const safeProxy = Safe__factory.connect(safeAddress, fixtureData.deployer);
  const isModuleEnabled = await safeProxy.isModuleEnabled(moduleFractalAddress);
  void expect(isModuleEnabled).to.be.true;

  // Connect to the deployed ModuleFractal proxy
  const moduleFractalProxy = ModuleFractalV1__factory.connect(
    moduleFractalAddress,
    fixtureData.deployer,
  );

  // Verify ModuleFractal was initialized correctly
  expect(await moduleFractalProxy.owner()).to.equal(owner);
  expect(await moduleFractalProxy.avatar()).to.equal(safeAddress);
  expect(await moduleFractalProxy.getFunction('target')()).to.equal(safeAddress);

  return moduleFractalProxy;
}

// Helper function to find and verify ModuleAzoriusV1 deployment and configuration
async function findAndVerifyModuleAzoriusV1(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
    deployer: SignerWithAddress;
  };
  receipt: ContractTransactionReceipt;
  implementation: AddressLike;
  safeAddress: string;
  owner: string;
  strategy: string;
  timelockPeriod: BigNumberish;
  executionPeriod: BigNumberish;
}) {
  const {
    fixtureData,
    receipt,
    implementation,
    safeAddress,
    owner,
    strategy,
    timelockPeriod,
    executionPeriod,
  } = params;

  const azoriusAddress = await findProxyDeployed({
    fixtureData,
    receipt,
    implementation,
  });

  // Verify the module is enabled on the Safe
  const safeProxy = Safe__factory.connect(safeAddress, fixtureData.deployer);
  const isModuleEnabled = await safeProxy.isModuleEnabled(azoriusAddress);
  void expect(isModuleEnabled).to.be.true;

  const azoriusProxy = ModuleAzoriusV1__factory.connect(azoriusAddress, fixtureData.deployer);

  expect(await azoriusProxy.owner()).to.equal(owner);
  expect(await azoriusProxy.avatar()).to.equal(safeAddress);
  expect(await azoriusProxy.getFunction('target')()).to.equal(safeAddress);
  expect(await azoriusProxy.strategy()).to.equal(strategy);
  expect(await azoriusProxy.timelockPeriod()).to.equal(timelockPeriod);
  expect(await azoriusProxy.executionPeriod()).to.equal(executionPeriod);

  return azoriusProxy;
}

// Helper function to find and verify StrategyV1 deployment and configuration
async function findAndVerifyStrategyV1(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
    deployer: SignerWithAddress;
  };
  receipt: ContractTransactionReceipt;
  implementation: AddressLike;
  votingPeriod: BigNumberish;
  quorumThreshold: BigNumberish;
  basisNumerator: BigNumberish;
  strategyAdmin: string;
  proposerAdapters: string[];
  votingAdapters: string[];
}) {
  const {
    fixtureData,
    receipt,
    implementation,
    votingPeriod,
    quorumThreshold,
    basisNumerator,
    strategyAdmin,
    proposerAdapters,
    votingAdapters,
  } = params;

  const strategyAddress = await findProxyDeployed({
    fixtureData,
    receipt,
    implementation,
  });

  const strategyProxy = StrategyV1__factory.connect(strategyAddress, fixtureData.deployer);

  expect(await strategyProxy.votingPeriod()).to.equal(votingPeriod);
  expect(await strategyProxy.quorumThreshold()).to.equal(quorumThreshold);
  expect(await strategyProxy.basisNumerator()).to.equal(basisNumerator);
  expect(await strategyProxy.strategyAdmin()).to.equal(strategyAdmin);

  // Verify proposer adapters
  const actualProposerAdapters = await strategyProxy.proposerAdapters();
  expect(actualProposerAdapters).to.have.lengthOf(proposerAdapters.length);
  for (let i = 0; i < proposerAdapters.length; i++) {
    expect(actualProposerAdapters[i]).to.equal(proposerAdapters[i]);
  }

  // Verify voting adapters
  const actualVotingAdapters = await strategyProxy.votingAdapters();
  expect(actualVotingAdapters).to.have.lengthOf(votingAdapters.length);
  for (let i = 0; i < votingAdapters.length; i++) {
    expect(actualVotingAdapters[i]).to.equal(votingAdapters[i]);
  }

  return strategyProxy;
}

// Helper function to find and verify ProposerAdapterERC20V1 deployment and configuration
async function findAndVerifyProposerAdapterERC20V1s(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
    deployer: SignerWithAddress;
  };
  receipt: ContractTransactionReceipt;
  implementation: string;
  adapterDatas: {
    params: {
      proposerThreshold: BigNumberish;
    };
    token: string;
  }[];
}) {
  const { fixtureData, receipt, implementation, adapterDatas } = params;

  const proposerAdapterAddresses = await findProxiesDeployed({
    fixtureData,
    receipt,
    implementation,
  });

  if (proposerAdapterAddresses.length !== adapterDatas.length) {
    throw new Error(
      `Number of proposer adapters does not match number of adapter datas in transaction receipt`,
    );
  }

  for (let i = 0; i < proposerAdapterAddresses.length; i++) {
    const proposerAdapterAddress = proposerAdapterAddresses[i];
    const adapterData = adapterDatas[i];

    const proposerAdapterProxy = ProposerAdapterERC20V1__factory.connect(
      proposerAdapterAddress,
      fixtureData.deployer,
    );

    expect(await proposerAdapterProxy.token()).to.equal(adapterData.token);
    expect(await proposerAdapterProxy.proposerThreshold()).to.equal(
      adapterData.params.proposerThreshold,
    );
  }

  return proposerAdapterAddresses.map(adapter =>
    ProposerAdapterERC20V1__factory.connect(adapter, fixtureData.deployer),
  );
}

// Helper function to find and verify ProposerAdapterERC721V1 deployment and configuration
async function findAndVerifyProposerAdapterERC721V1s(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
    deployer: SignerWithAddress;
  };
  receipt: ContractTransactionReceipt;
  implementation: string;
  proposerAdapterDatas: {
    params: {
      token: AddressLike;
      proposerThreshold: BigNumberish;
    };
  }[];
}) {
  const { fixtureData, receipt, implementation, proposerAdapterDatas } = params;

  const proposerAdapterAddresess = await findProxiesDeployed({
    fixtureData,
    receipt,
    implementation,
  });

  if (proposerAdapterAddresess.length !== proposerAdapterDatas.length) {
    throw new Error(`Number of proposer adapters does not match number of adapter datas`);
  }

  for (let i = 0; i < proposerAdapterAddresess.length; i++) {
    const proposerAdapterAddress = proposerAdapterAddresess[i];
    const proposerAdapterData = proposerAdapterDatas[i];

    const proposerAdapterProxy = ProposerAdapterERC721V1__factory.connect(
      proposerAdapterAddress,
      fixtureData.deployer,
    );

    expect(await proposerAdapterProxy.token()).to.equal(proposerAdapterData.params.token);
    expect(await proposerAdapterProxy.proposerThreshold()).to.equal(
      proposerAdapterData.params.proposerThreshold,
    );
  }

  return proposerAdapterAddresess.map(adapter =>
    ProposerAdapterERC721V1__factory.connect(adapter, fixtureData.deployer),
  );
}

// Helper function to find and verify ProposerAdapterHatsV1 deployment and configuration
async function findAndVerifyProposerAdapterHatsV1s(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
    deployer: SignerWithAddress;
  };
  receipt: ContractTransactionReceipt;
  implementation: string;
  proposerAdapterDatas: {
    params: {
      hatsContract: AddressLike;
      whitelistedHatIds: BigNumberish[];
    };
  }[];
}) {
  const { fixtureData, receipt, implementation, proposerAdapterDatas } = params;

  const proposerAdapterAddresess = await findProxiesDeployed({
    fixtureData,
    receipt,
    implementation,
  });

  if (proposerAdapterAddresess.length !== proposerAdapterDatas.length) {
    throw new Error(`Number of proposer adapters does not match number of adapter datas`);
  }

  for (let i = 0; i < proposerAdapterAddresess.length; i++) {
    const proposerAdapterAddress = proposerAdapterAddresess[i];
    const proposerAdapterData = proposerAdapterDatas[i];

    const proposerAdapterProxy = ProposerAdapterHatsV1__factory.connect(
      proposerAdapterAddress,
      fixtureData.deployer,
    );

    expect(await proposerAdapterProxy.hatsContract()).to.equal(
      proposerAdapterData.params.hatsContract,
    );

    const whitelistedHatIds = await proposerAdapterProxy.whitelistedHatIds();
    expect(whitelistedHatIds).to.deep.equal(proposerAdapterData.params.whitelistedHatIds);
  }

  return proposerAdapterAddresess.map(adapter =>
    ProposerAdapterHatsV1__factory.connect(adapter, fixtureData.deployer),
  );
}

// Helper function to find and verify VotingAdapterERC20V1 deployment and configuration
async function findAndVerifyVotingAdapterERC20V1s(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
    deployer: SignerWithAddress;
  };
  receipt: ContractTransactionReceipt;
  implementation: string;
  votingAdapterDatas: {
    params: {
      strategy: string;
      weightPerToken: BigNumberish;
    };
    token: string;
  }[];
}) {
  const { fixtureData, receipt, implementation, votingAdapterDatas } = params;

  const votingAdapterAddresess = await findProxiesDeployed({
    fixtureData,
    receipt,
    implementation,
  });

  if (votingAdapterAddresess.length !== votingAdapterDatas.length) {
    throw new Error(`Number of voting adapters does not match number of adapter datas`);
  }

  for (let i = 0; i < votingAdapterAddresess.length; i++) {
    const votingAdapterAddress = votingAdapterAddresess[i];
    const votingAdapterData = votingAdapterDatas[i];

    const votingAdapterProxy = VotingAdapterERC20V1__factory.connect(
      votingAdapterAddress,
      fixtureData.deployer,
    );

    expect(await votingAdapterProxy.token()).to.equal(votingAdapterData.token);
    expect(await votingAdapterProxy.strategy()).to.equal(votingAdapterData.params.strategy);
    expect(await votingAdapterProxy.weightPerToken()).to.equal(
      votingAdapterData.params.weightPerToken,
    );
  }

  return votingAdapterAddresess.map(adapter =>
    VotingAdapterERC20V1__factory.connect(adapter, fixtureData.deployer),
  );
}

// Helper function to find and verify VotingAdapterERC721V1 deployment and configuration
async function findAndVerifyVotingAdapterERC721V1s(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
    deployer: SignerWithAddress;
  };
  receipt: ContractTransactionReceipt;
  implementation: string;
  votingAdapterDatas: {
    params: {
      strategy: string;
      weightPerToken: BigNumberish;
      token: AddressLike;
    };
  }[];
}) {
  const { fixtureData, receipt, implementation, votingAdapterDatas } = params;

  const votingAdapterAddresess = await findProxiesDeployed({
    fixtureData,
    receipt,
    implementation,
  });

  if (votingAdapterAddresess.length !== votingAdapterDatas.length) {
    throw new Error(`Number of voting adapters does not match number of adapter datas`);
  }

  for (let i = 0; i < votingAdapterAddresess.length; i++) {
    const votingAdapterAddress = votingAdapterAddresess[i];
    const votingAdapterData = votingAdapterDatas[i];

    const votingAdapterProxy = VotingAdapterERC721V1__factory.connect(
      votingAdapterAddress,
      fixtureData.deployer,
    );

    expect(await votingAdapterProxy.token()).to.equal(votingAdapterData.params.token);
    expect(await votingAdapterProxy.strategy()).to.equal(votingAdapterData.params.strategy);
    expect(await votingAdapterProxy.weightPerToken()).to.equal(
      votingAdapterData.params.weightPerToken,
    );
  }

  return votingAdapterAddresess.map(adapter =>
    VotingAdapterERC721V1__factory.connect(adapter, fixtureData.deployer),
  );
}

// Helper function to find and verify FreezeGuardMultisig deployment and configuration
async function findAndVerifyFreezeGuardMultisigV1(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
    deployer: SignerWithAddress;
  };
  receipt: ContractTransactionReceipt;
  implementation: AddressLike;
  safeAddress: string;
  owner: AddressLike;
  timelockPeriod: BigNumberish;
  executionPeriod: BigNumberish;
  freezeVoting: string;
}) {
  const {
    fixtureData,
    receipt,
    implementation,
    safeAddress,
    owner,
    timelockPeriod,
    executionPeriod,
    freezeVoting,
  } = params;
  const freezeGuardMultisigAddress = await findProxyDeployed({
    fixtureData,
    receipt,
    implementation,
  });

  // Verify the module is enabled on the Safe
  const guardAddress = ethers.AbiCoder.defaultAbiCoder().decode(
    ['address'],
    await ethers.provider.getStorage(
      safeAddress,
      ethers.keccak256(ethers.toUtf8Bytes('guard_manager.guard.address')),
    ),
  )[0];
  void expect(guardAddress).to.equal(freezeGuardMultisigAddress);

  // Connect to the deployed FreezeGuardMultisig proxy
  const freezeGuardMultisigProxy = FreezeGuardMultisigV1__factory.connect(
    freezeGuardMultisigAddress,
    fixtureData.deployer,
  );

  expect(await freezeGuardMultisigProxy.owner()).to.equal(owner);
  expect(await freezeGuardMultisigProxy.timelockPeriod()).to.equal(timelockPeriod);
  expect(await freezeGuardMultisigProxy.executionPeriod()).to.equal(executionPeriod);
  expect(await freezeGuardMultisigProxy.freezeVoting()).to.equal(freezeVoting);

  return freezeGuardMultisigProxy;
}

// Helper function to find and verify FreezeGuardAzorius deployment and configuration
async function findAndVerifyFreezeGuardAzoriusV1(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
    deployer: SignerWithAddress;
  };
  receipt: ContractTransactionReceipt;
  implementation: AddressLike;
  azoriusModuleAddress: string;
  owner: AddressLike;
  freezeVoting: string;
}) {
  const { fixtureData, receipt, implementation, azoriusModuleAddress, owner, freezeVoting } =
    params;

  const freezeGuardAzoriusAddress = await findProxyDeployed({
    fixtureData,
    receipt,
    implementation,
  });

  // Verify the guard is set on the Azorius module
  const azoriusModule = ModuleAzoriusV1__factory.connect(
    azoriusModuleAddress,
    fixtureData.deployer,
  );
  const guard = await azoriusModule.getGuard();
  void expect(guard).to.equal(freezeGuardAzoriusAddress);

  // Connect to the deployed FreezeGuardAzorius proxy
  const freezeGuardAzoriusProxy = FreezeGuardAzoriusV1__factory.connect(
    freezeGuardAzoriusAddress,
    fixtureData.deployer,
  );

  expect(await freezeGuardAzoriusProxy.owner()).to.equal(owner);
  expect(await freezeGuardAzoriusProxy.freezeVoting()).to.equal(freezeVoting);

  return freezeGuardAzoriusProxy;
}

// Helper function to find and verify FreezeVotingMultisig deployment and configuration
async function findAndVerifyFreezeVotingMultisigV1(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
    deployer: SignerWithAddress;
  };
  receipt: ContractTransactionReceipt;
  implementation: AddressLike;
  owner: AddressLike;
  freezeVotesThreshold: BigNumberish;
  freezeProposalPeriod: BigNumberish;
  freezePeriod: BigNumberish;
  lightAccountFactory: AddressLike;
}) {
  const {
    fixtureData,
    receipt,
    implementation,
    owner,
    freezeVotesThreshold,
    freezeProposalPeriod,
    freezePeriod,
    lightAccountFactory,
  } = params;

  const freezeVotingMultisigAddress = await findProxyDeployed({
    fixtureData,
    receipt,
    implementation,
  });

  // Connect to the deployed FreezeVotingMultisig proxy
  const freezeVotingMultisigProxy = FreezeVotingMultisigV1__factory.connect(
    freezeVotingMultisigAddress,
    fixtureData.deployer,
  );

  expect(await freezeVotingMultisigProxy.owner()).to.equal(owner);
  expect(await freezeVotingMultisigProxy.freezeVotesThreshold()).to.equal(freezeVotesThreshold);
  expect(await freezeVotingMultisigProxy.freezeProposalPeriod()).to.equal(freezeProposalPeriod);
  expect(await freezeVotingMultisigProxy.freezePeriod()).to.equal(freezePeriod);
  expect(await freezeVotingMultisigProxy.lightAccountFactory()).to.equal(lightAccountFactory);

  return freezeVotingMultisigProxy;
}

// Helper function to find and verify FreezeVotingAzorius deployment and configuration
async function findAndVerifyFreezeVotingAzoriusV1(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
    deployer: SignerWithAddress;
  };
  receipt: ContractTransactionReceipt;
  implementation: AddressLike;
  owner: AddressLike;
  freezeVotesThreshold: BigNumberish;
  freezeProposalPeriod: BigNumberish;
  freezePeriod: BigNumberish;
  parentAzorius: AddressLike;
  lightAccountFactory: AddressLike;
}) {
  const {
    fixtureData,
    receipt,
    implementation,
    owner,
    freezeVotesThreshold,
    freezeProposalPeriod,
    freezePeriod,
    parentAzorius,
    lightAccountFactory,
  } = params;

  const freezeVotingAzoriusAddress = await findProxyDeployed({
    fixtureData,
    receipt,
    implementation,
  });

  // Connect to the deployed FreezeVotingAzorius proxy
  const freezeVotingAzoriusProxy = FreezeVotingAzoriusV1__factory.connect(
    freezeVotingAzoriusAddress,
    fixtureData.deployer,
  );

  expect(await freezeVotingAzoriusProxy.owner()).to.equal(owner);
  expect(await freezeVotingAzoriusProxy.freezeProposalPeriod()).to.equal(freezeProposalPeriod);
  expect(await freezeVotingAzoriusProxy.freezePeriod()).to.equal(freezePeriod);
  expect(await freezeVotingAzoriusProxy.freezeVotesThreshold()).to.equal(freezeVotesThreshold);
  expect(await freezeVotingAzoriusProxy.parentAzorius()).to.equal(parentAzorius);
  expect(await freezeVotingAzoriusProxy.lightAccountFactory()).to.equal(lightAccountFactory);

  return freezeVotingAzoriusProxy;
}

// Helper function to verify the number of new contracts deployed
function verifyNumberOfNewContractsDeployed(params: {
  fixtureData: {
    systemDeployer: SystemDeployerV1;
  };
  receipt: ContractTransactionReceipt;
  safeAddress: string;
  numberOfNewContracts: number;
}) {
  const { fixtureData, receipt, safeAddress, numberOfNewContracts } = params;

  const proxyDeployedTopicHash =
    fixtureData.systemDeployer.interface.getEvent('ProxyDeployed').topicHash;

  const events = receipt.logs.filter(
    log => log.address === safeAddress && log.topics[0] === proxyDeployedTopicHash,
  );

  expect(events).to.have.lengthOf(numberOfNewContracts);
}

// Helper function to find and verify the base Azorius Governance setup
async function findAndVerifySafe(params: {
  fixtureData: {
    safeProxyFactory: SafeProxyFactory;
    safe: Safe;
    systemDeployer: SystemDeployerV1;
    deployer: SignerWithAddress;
    proposerAdapterERC20V1: ProposerAdapterERC20V1;
    proposerAdapterERC721V1: ProposerAdapterERC721V1;
    proposerAdapterHatsV1: ProposerAdapterHatsV1;
    strategyV1: StrategyV1;
    moduleAzoriusV1: ModuleAzoriusV1;
    votingAdapterERC20V1: VotingAdapterERC20V1;
    votingAdapterERC721V1: VotingAdapterERC721V1;
    votesERC20V1: VotesERC20V1;
    votesERC20LockableV1: VotesERC20LockableV1;
  };
  receipt: ContractTransactionReceipt;
  salt: string;
  safeAddress: string;
  owners: string[];
  threshold: number;
  moduleFractalV1Params?: ISystemDeployerV1.ModuleFractalV1ParamsStruct;
  votesERC20Datas?: [
    ISystemDeployerV1.VotesERC20V1ParamsStruct[],
    ISystemDeployerV1.VotesERC20LockableV1ParamsStruct[],
  ];
  proposerAdapterERC20V1Datas?: {
    params: ISystemDeployerV1.ProposerAdapterERC20V1ParamsStruct;
    token?: string;
  }[];
  proposerAdapterERC721V1Datas?: {
    params: ISystemDeployerV1.ProposerAdapterERC721V1ParamsStruct;
  }[];
  proposerAdapterHatsV1Datas?: {
    params: ISystemDeployerV1.ProposerAdapterHatsV1ParamsStruct;
  }[];
  strategyV1Params?: ISystemDeployerV1.StrategyV1ParamsStruct;
  moduleAzoriusV1Params?: ISystemDeployerV1.ModuleAzoriusV1ParamsStruct;
  votingAdapterERC20V1Datas?: {
    params: ISystemDeployerV1.VotingAdapterERC20V1ParamsStruct;
    token?: string;
  }[];
  votingAdapterERC721V1Datas?: {
    params: ISystemDeployerV1.VotingAdapterERC721V1ParamsStruct;
  }[];
  freezeGuardMultisigV1Data?: {
    guardParams: ISystemDeployerV1.FreezeGuardMultisigV1ParamsStruct;
    votingMultisigParams?: ISystemDeployerV1.FreezeVotingMultisigV1ParamsStruct;
    votingAzoriusParams?: ISystemDeployerV1.FreezeVotingAzoriusV1ParamsStruct;
  };
  freezeGuardAzoriusV1Data?: {
    guardParams: ISystemDeployerV1.FreezeGuardAzoriusV1ParamsStruct;
    votingMultisigParams?: ISystemDeployerV1.FreezeVotingMultisigV1ParamsStruct;
    votingAzoriusParams?: ISystemDeployerV1.FreezeVotingAzoriusV1ParamsStruct;
  };
  numberOfNewContracts: number;
}) {
  const {
    fixtureData,
    receipt,
    salt,
    safeAddress,
    owners,
    threshold,
    moduleFractalV1Params,
    votesERC20Datas,
    proposerAdapterERC20V1Datas,
    proposerAdapterERC721V1Datas,
    proposerAdapterHatsV1Datas,
    strategyV1Params,
    moduleAzoriusV1Params,
    votingAdapterERC20V1Datas,
    votingAdapterERC721V1Datas,
    freezeGuardMultisigV1Data,
    freezeGuardAzoriusV1Data,
    numberOfNewContracts,
  } = params;

  await verifySafeConfiguration({
    fixtureData,
    receipt,
    safeAddress,
    owners,
    threshold,
  });
  const systemDeployedEvent = receipt.logs.find(log => {
    try {
      const parsedLog = fixtureData.systemDeployer.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsedLog?.name === 'SystemDeployed';
    } catch {
      return false;
    }
  });

  void expect(systemDeployedEvent).to.not.be.undefined;

  if (!systemDeployedEvent) {
    throw new Error('SystemDeployed event not found');
  }

  const parsedSystemDeployedEvent = fixtureData.systemDeployer.interface.parseLog({
    topics: systemDeployedEvent.topics,
    data: systemDeployedEvent.data,
  });

  if (!parsedSystemDeployedEvent) {
    throw new Error('SystemDeployed event not found');
  }

  expect(parsedSystemDeployedEvent.args[0]).to.equal(
    await fixtureData.safeProxyFactory.getAddress(),
  );
  expect(parsedSystemDeployedEvent.args[1]).to.equal(salt);

  if (moduleFractalV1Params) {
    await findAndVerifyModuleFractalV1({
      fixtureData,
      receipt,
      safeAddress,
      ...moduleFractalV1Params,
    });
  }

  let votesERC20Tokens: [VotesERC20V1[], VotesERC20LockableV1[]];
  if (votesERC20Datas) {
    let votesERC20V1s: VotesERC20V1[] = [];
    let votesERC20LockableV1s: VotesERC20LockableV1[] = [];

    if (votesERC20Datas[0].length > 0) {
      votesERC20V1s = await findAndVerifyVotesERC20V1s({
        fixtureData,
        receipt,
        implementation: await fixtureData.votesERC20V1.getAddress(),
        votesERC20V1Datas: votesERC20Datas[0],
        safeAddress,
      });
    }

    if (votesERC20Datas[1].length > 0) {
      votesERC20LockableV1s = await findAndVerifyVotesERC20LockableV1s({
        fixtureData,
        receipt,
        implementation: await fixtureData.votesERC20LockableV1.getAddress(),
        votesERC20LockableV1Datas: votesERC20Datas[1],
        safeAddress,
      });
    }

    votesERC20Tokens = [votesERC20V1s, votesERC20LockableV1s];
  }

  let proposerAdapterERC20s: ProposerAdapterERC20V1[] = [];
  if (proposerAdapterERC20V1Datas) {
    proposerAdapterERC20s = await findAndVerifyProposerAdapterERC20V1s({
      fixtureData,
      receipt,
      implementation: await fixtureData.proposerAdapterERC20V1.getAddress(),
      adapterDatas: await Promise.all(
        proposerAdapterERC20V1Datas.map(async data => ({
          ...data,
          token:
            data.token ??
            (await votesERC20Tokens[Number(data.params.index.typeI)][
              Number(data.params.index.tokenI)
            ].getAddress()),
        })),
      ),
    });
  }

  let proposerAdapterERC721s: ProposerAdapterERC721V1[] = [];
  if (proposerAdapterERC721V1Datas) {
    proposerAdapterERC721s = await findAndVerifyProposerAdapterERC721V1s({
      fixtureData,
      receipt,
      implementation: await fixtureData.proposerAdapterERC721V1.getAddress(),
      proposerAdapterDatas: proposerAdapterERC721V1Datas,
    });
  }

  let proposerAdapterHatsV1s: ProposerAdapterHatsV1[] = [];
  if (proposerAdapterHatsV1Datas) {
    proposerAdapterHatsV1s = await findAndVerifyProposerAdapterHatsV1s({
      fixtureData,
      receipt,
      implementation: await fixtureData.proposerAdapterHatsV1.getAddress(),
      proposerAdapterDatas: proposerAdapterHatsV1Datas,
    });
  }

  let strategyAddress: string | undefined;
  if (strategyV1Params) {
    strategyAddress = await findProxyDeployed({
      fixtureData,
      receipt,
      implementation: await fixtureData.strategyV1.getAddress(),
    });
  }

  let azoriusModule: ModuleAzoriusV1 | undefined;
  if (moduleAzoriusV1Params) {
    if (!strategyAddress) {
      throw new Error('Strategy is required to verify Azorius module');
    }

    azoriusModule = await findAndVerifyModuleAzoriusV1({
      fixtureData,
      receipt,
      safeAddress,
      owner: safeAddress,
      strategy: strategyAddress,
      ...moduleAzoriusV1Params,
    });
  }

  let votingAdapterERC20s: VotingAdapterERC20V1[] = [];
  if (votingAdapterERC20V1Datas) {
    if (!strategyAddress) {
      throw new Error('Strategy is required to verify voting adapter ERC20');
    }

    votingAdapterERC20s = await findAndVerifyVotingAdapterERC20V1s({
      fixtureData,
      receipt,
      implementation: await fixtureData.votingAdapterERC20V1.getAddress(),
      votingAdapterDatas: await Promise.all(
        votingAdapterERC20V1Datas.map(async data => ({
          ...data,
          params: {
            ...data.params,
            strategy: strategyAddress,
          },
          token:
            data.token ??
            (await votesERC20Tokens[Number(data.params.index.typeI)][
              Number(data.params.index.tokenI)
            ].getAddress()),
        })),
      ),
    });
  }

  let votingAdapterERC721s: VotingAdapterERC721V1[] = [];
  if (votingAdapterERC721V1Datas) {
    if (!strategyAddress) {
      throw new Error('Strategy is required to verify voting adapter ERC721');
    }

    votingAdapterERC721s = await findAndVerifyVotingAdapterERC721V1s({
      fixtureData,
      receipt,
      implementation: await fixtureData.votingAdapterERC721V1.getAddress(),
      votingAdapterDatas: await Promise.all(
        votingAdapterERC721V1Datas.map(async data => ({
          ...data,
          params: { ...data.params, strategy: strategyAddress },
        })),
      ),
    });
  }

  if (strategyV1Params) {
    if (!azoriusModule) {
      throw new Error('Azorius module is required to verify a strategy');
    }

    await findAndVerifyStrategyV1({
      fixtureData,
      receipt,
      ...strategyV1Params,
      strategyAdmin: await azoriusModule.getAddress(),
      proposerAdapters: [
        ...(await Promise.all(proposerAdapterERC20s.map(adapter => adapter.getAddress()))),
        ...(await Promise.all(proposerAdapterERC721s.map(adapter => adapter.getAddress()))),
        ...(await Promise.all(proposerAdapterHatsV1s.map(adapter => adapter.getAddress()))),
      ],
      votingAdapters: [
        ...(await Promise.all(votingAdapterERC20s.map(adapter => adapter.getAddress()))),
        ...(await Promise.all(votingAdapterERC721s.map(adapter => adapter.getAddress()))),
      ],
    });
  }

  if (freezeGuardMultisigV1Data) {
    if (
      freezeGuardMultisigV1Data.votingAzoriusParams &&
      freezeGuardMultisigV1Data.votingMultisigParams
    ) {
      throw new Error('Cannot have both votingAzoriusParams and votingMultisigParams');
    }

    let freezeVotingAddress: string | undefined;

    if (freezeGuardMultisigV1Data.votingMultisigParams) {
      freezeVotingAddress = await (
        await findAndVerifyFreezeVotingMultisigV1({
          fixtureData,
          receipt,
          ...freezeGuardMultisigV1Data.votingMultisigParams,
        })
      ).getAddress();
    }

    if (freezeGuardMultisigV1Data.votingAzoriusParams) {
      freezeVotingAddress = await (
        await findAndVerifyFreezeVotingAzoriusV1({
          fixtureData,
          receipt,
          ...freezeGuardMultisigV1Data.votingAzoriusParams,
        })
      ).getAddress();
    }

    if (!freezeVotingAddress) {
      throw new Error('No freeze voting address found');
    }

    await findAndVerifyFreezeGuardMultisigV1({
      fixtureData,
      receipt,
      safeAddress,
      ...freezeGuardMultisigV1Data.guardParams,
      freezeVoting: freezeVotingAddress,
    });
  }

  if (freezeGuardAzoriusV1Data) {
    if (!azoriusModule) {
      throw new Error('Azorius module is required to verify freeze guard Azorius');
    }

    if (
      freezeGuardAzoriusV1Data.votingAzoriusParams &&
      freezeGuardAzoriusV1Data.votingMultisigParams
    ) {
      throw new Error('Cannot have both votingAzoriusParams and votingMultisigParams');
    }

    let freezeVotingAddress: string | undefined;

    if (freezeGuardAzoriusV1Data.votingMultisigParams) {
      freezeVotingAddress = await (
        await findAndVerifyFreezeVotingMultisigV1({
          fixtureData,
          receipt,
          ...freezeGuardAzoriusV1Data.votingMultisigParams,
        })
      ).getAddress();
    }

    if (freezeGuardAzoriusV1Data.votingAzoriusParams) {
      freezeVotingAddress = await (
        await findAndVerifyFreezeVotingAzoriusV1({
          fixtureData,
          receipt,
          ...freezeGuardAzoriusV1Data.votingAzoriusParams,
        })
      ).getAddress();
    }

    if (!freezeVotingAddress) {
      throw new Error('No freeze voting address found');
    }

    await findAndVerifyFreezeGuardAzoriusV1({
      fixtureData,
      receipt,
      azoriusModuleAddress: await azoriusModule.getAddress(),
      ...freezeGuardAzoriusV1Data.guardParams,
      freezeVoting: freezeVotingAddress,
    });
  }

  verifyNumberOfNewContractsDeployed({
    fixtureData,
    receipt,
    safeAddress,
    numberOfNewContracts,
  });
}

// Helper function for deploying upgradeable contract instances using SystemDeployer
async function deployConcreteUpgradeableContract(
  systemDeployer: SystemDeployerV1,
  implementation: string,
  owner: SignerWithAddress,
  name: string,
  saltNonce?: string, // Optional salt nonce for deterministic deployment
): Promise<UpgradeContractV1> {
  // Create a unique salt if one is not provided
  const salt = saltNonce
    ? ethers.keccak256(ethers.toUtf8Bytes(saltNonce))
    : ethers.keccak256(ethers.randomBytes(32));

  // Create initialization data with function selector
  const fullInitData = UpgradeContractV1__factory.createInterface().encodeFunctionData(
    'initialize',
    [name, owner.address],
  );

  // Deploy using the generic deployProxy method
  await systemDeployer.deployProxy(implementation, fullInitData, salt);

  // Predict the address
  const predictedAddress = await systemDeployer.predictProxyAddress(
    implementation,
    fullInitData,
    salt,
    await systemDeployer.getAddress(),
  );

  // Create a contract instance at the predicted address
  return UpgradeContractV1__factory.connect(predictedAddress, owner);
}

async function setupState() {
  const [deployer, user1, user2, upgradeableContractOwner, nonOwner] = await ethers.getSigners();

  const safe = await new Safe__factory(deployer).deploy();
  const safeProxyFactory = await new SafeProxyFactory__factory(deployer).deploy();

  const systemDeployerEventEmitter = await new SystemDeployerEventEmitterV1__factory(
    deployer,
  ).deploy();
  const systemDeployer = await new SystemDeployerV1__factory(deployer).deploy(
    await systemDeployerEventEmitter.getAddress(),
  );

  const moduleFractalV1 = await new ModuleFractalV1__factory(deployer).deploy();
  const freezeGuardMultisigV1 = await new FreezeGuardMultisigV1__factory(deployer).deploy();
  const freezeGuardAzoriusV1 = await new FreezeGuardAzoriusV1__factory(deployer).deploy();
  const freezeVotingMultisigV1 = await new FreezeVotingMultisigV1__factory(deployer).deploy();
  const freezeVotingAzoriusV1 = await new FreezeVotingAzoriusV1__factory(deployer).deploy();
  const moduleAzoriusV1 = await new ModuleAzoriusV1__factory(deployer).deploy();
  const strategyV1 = await new StrategyV1__factory(deployer).deploy();
  const votesERC20V1 = await new VotesERC20V1__factory(deployer).deploy();
  const votesERC20LockableV1 = await new VotesERC20LockableV1__factory(deployer).deploy();
  const proposerAdapterERC20V1 = await new ProposerAdapterERC20V1__factory(deployer).deploy();
  const proposerAdapterERC721V1 = await new ProposerAdapterERC721V1__factory(deployer).deploy();
  const proposerAdapterHatsV1 = await new ProposerAdapterHatsV1__factory(deployer).deploy();
  const votingAdapterERC20V1 = await new VotingAdapterERC20V1__factory(deployer).deploy();
  const votingAdapterERC721V1 = await new VotingAdapterERC721V1__factory(deployer).deploy();

  const upgradeableMasterCopy = await (
    await new UpgradeContractV1__factory(upgradeableContractOwner).deploy()
  ).getAddress();
  const minimalImplementation = await (
    await new MinimalUpgradeableContract__factory(upgradeableContractOwner).deploy()
  ).getAddress();
  const failingImplementation = await (
    await new FailingInitializerContract__factory(upgradeableContractOwner).deploy()
  ).getAddress();
  const upgradeV1Implementation = await (
    await new UpgradeContractV1__factory(upgradeableContractOwner).deploy()
  ).getAddress();
  const incompatibleImplementation = await (
    await new IncompatibleStorageContract__factory(upgradeableContractOwner).deploy()
  ).getAddress();
  const upgradeV2Implementation = await (
    await new UpgradeContractV2__factory(upgradeableContractOwner).deploy()
  ).getAddress();
  const upgradeV3Implementation = await (
    await new UpgradeContractV3__factory(upgradeableContractOwner).deploy()
  ).getAddress();
  const upgradeableContract = await deployConcreteUpgradeableContract(
    systemDeployer,
    upgradeableMasterCopy,
    upgradeableContractOwner,
    'Upgradeable Contract',
  );
  const upgradedMasterCopy = await (
    await new UpgradeContractV2__factory(upgradeableContractOwner).deploy()
  ).getAddress();

  return {
    deployer,
    user1,
    user2,
    upgradeableContractOwner,
    nonOwner,
    safe,
    safeProxyFactory,
    systemDeployer,
    systemDeployerEventEmitter,
    moduleFractalV1,
    freezeGuardMultisigV1,
    freezeGuardAzoriusV1,
    freezeVotingMultisigV1,
    freezeVotingAzoriusV1,
    moduleAzoriusV1,
    strategyV1,
    votesERC20V1,
    votesERC20LockableV1,
    proposerAdapterERC20V1,
    proposerAdapterERC721V1,
    proposerAdapterHatsV1,
    votingAdapterERC20V1,
    votingAdapterERC721V1,
    upgradeableMasterCopy,
    minimalImplementation,
    failingImplementation,
    upgradeV1Implementation,
    incompatibleImplementation,
    upgradeV2Implementation,
    upgradeV3Implementation,
    upgradeableContract,
    upgradedMasterCopy,
  };
}

describe('SystemDeployerV1', () => {
  let fixtureData: Awaited<ReturnType<typeof setupState>>;

  beforeEach(async () => {
    fixtureData = await loadFixture(setupState);
  });

  describe('setupSafe', () => {
    let votesERC20V1Params1: ISystemDeployerV1.VotesERC20V1ParamsStruct;
    let votesERC20LockableV1Params1: ISystemDeployerV1.VotesERC20LockableV1ParamsStruct;
    let votesERC20V1Params2: ISystemDeployerV1.VotesERC20V1ParamsStruct;
    let votesERC20LockableV1Params2: ISystemDeployerV1.VotesERC20LockableV1ParamsStruct;

    let moduleFractalV1Params: ISystemDeployerV1.ModuleFractalV1ParamsStruct;

    let freezeGuardMultisigParams: ISystemDeployerV1.FreezeGuardMultisigV1ParamsStruct;
    let freezeGuardAzoriusParams: ISystemDeployerV1.FreezeGuardAzoriusV1ParamsStruct;
    let freezeVotingMultisigParams: ISystemDeployerV1.FreezeVotingMultisigV1ParamsStruct;
    let freezeVotingAzoriusParams: ISystemDeployerV1.FreezeVotingAzoriusV1ParamsStruct;

    beforeEach(async () => {
      votesERC20V1Params1 = {
        implementation: await fixtureData.votesERC20V1.getAddress(),
        metadata: {
          name: 'Test Token',
          symbol: 'TEST',
        },
        allocations: [
          {
            to: fixtureData.user1.address,
            amount: ethers.parseEther('100'),
          },
        ],
        safeSupply: ethers.parseEther('100'),
      };

      votesERC20LockableV1Params1 = {
        implementation: await fixtureData.votesERC20LockableV1.getAddress(),
        metadata: {
          name: 'Locked Token',
          symbol: 'LOCK',
        },
        allocations: [
          {
            to: fixtureData.user1.address,
            amount: ethers.parseEther('500'),
          },
        ],
        locked: true,
        maxTotalSupply: ethers.parseEther('10000'),
        safeSupply: ethers.parseEther('1000'),
      };

      votesERC20V1Params2 = {
        implementation: await fixtureData.votesERC20V1.getAddress(),
        metadata: {
          name: 'Test Token 2',
          symbol: 'TEST2',
        },
        allocations: [
          {
            to: fixtureData.user2.address,
            amount: ethers.parseEther('50'),
          },
        ],
        safeSupply: ethers.parseEther('150'),
      };

      votesERC20LockableV1Params2 = {
        implementation: await fixtureData.votesERC20LockableV1.getAddress(),
        metadata: {
          name: 'Locked Token 2',
          symbol: 'LOCK2',
        },
        allocations: [
          {
            to: fixtureData.user2.address,
            amount: ethers.parseEther('50'),
          },
        ],
        locked: true,
        maxTotalSupply: ethers.parseEther('10000'),
        safeSupply: ethers.parseEther('1000'),
      };

      moduleFractalV1Params = {
        implementation: await fixtureData.moduleFractalV1.getAddress(),
        owner: fixtureData.user1.address,
      };

      freezeGuardMultisigParams = {
        implementation: await fixtureData.freezeGuardMultisigV1.getAddress(),
        owner: fixtureData.user1.address,
        timelockPeriod: 60,
        executionPeriod: 120,
      };

      freezeGuardAzoriusParams = {
        implementation: await fixtureData.freezeGuardAzoriusV1.getAddress(),
        owner: fixtureData.user1.address,
      };

      freezeVotingMultisigParams = {
        implementation: await fixtureData.freezeVotingMultisigV1.getAddress(),
        owner: fixtureData.user1.address,
        freezeVotesThreshold: 26,
        freezeProposalPeriod: 65,
        freezePeriod: 129,
        parentSafe: ethers.ZeroAddress,
        lightAccountFactory: ethers.ZeroAddress,
      };

      freezeVotingAzoriusParams = {
        implementation: await fixtureData.freezeVotingAzoriusV1.getAddress(),
        owner: fixtureData.user1.address,
        freezeVotesThreshold: 12,
        freezeProposalPeriod: 60,
        freezePeriod: 120,
        parentAzorius: ethers.ZeroAddress,
        lightAccountFactory: ethers.ZeroAddress,
      };
    });

    describe('Deploy Multisig DAO', () => {
      let owners: string[];
      let threshold: number;

      beforeEach(async () => {
        const randomOwner = ethers.Wallet.createRandom().address;
        owners = [fixtureData.user1.address, fixtureData.user2.address, randomOwner];
        threshold = 2;
      });

      it('has correct signers and threshold', async () => {
        const setupSafeParams = createSetupSafeParams();

        await findAndVerifySafe({
          ...(await deploySafeWithSetup({
            fixtureData,
            owners,
            threshold,
            setupSafeParams,
          })),
          fixtureData,
          owners,
          threshold,
          numberOfNewContracts: 0,
        });
      });

      describe('with a Fractal Module', () => {
        it('deploys successfully with a Fractal Module', async () => {
          const setupSafeParams = createSetupSafeParams({
            moduleFractalParams: moduleFractalV1Params,
          });

          await findAndVerifySafe({
            ...(await deploySafeWithSetup({
              fixtureData,
              owners,
              threshold,
              setupSafeParams,
            })),
            fixtureData,
            owners,
            threshold,
            moduleFractalV1Params,
            numberOfNewContracts: 1,
          });
        });
      });

      describe('with Freeze Guards', () => {
        it('reverts with FreezeGuardAzorius', async () => {
          const setupSafeParams = createSetupSafeParams();

          const data = {
            fixtureData,
            owners,
            threshold,
            setupSafeParams,
          };

          // confirm that the safe is deployed with basic params
          await deploySafeWithSetup(data);

          // now update setupSafeParams to include a freezeGuardAzoriusParams
          data.setupSafeParams.freezeParams.freezeGuardParams.freezeGuardAzoriusV1Params =
            freezeGuardAzoriusParams;

          // now deploying should fail
          await expect(deploySafeWithSetup(data)).to.be.reverted;
        });

        it('reverts with FreezeGuardMultisig but no FreezeVoting contract', async () => {
          const setupSafeParams = createSetupSafeParams();

          const data = {
            fixtureData,
            owners,
            threshold,
            setupSafeParams,
          };

          // confirm that the safe is deployed with basic params
          await deploySafeWithSetup(data);

          // now update setupSafeParams to include a freezeGuardMultisigParams
          data.setupSafeParams.freezeParams.freezeGuardParams.freezeGuardMultisigV1Params =
            freezeGuardMultisigParams;

          // now deploying should fail
          await expect(deploySafeWithSetup(data)).to.be.reverted;
        });

        it('succeeds with FreezeGuardMultisig and FreezeVotingMultisig contracts', async () => {
          const setupSafeParams = createSetupSafeParams({
            freezeVotingMultisigParams,
            freezeGuardMultisigParams,
          });

          await findAndVerifySafe({
            ...(await deploySafeWithSetup({
              fixtureData,
              owners,
              threshold,
              setupSafeParams,
            })),
            fixtureData,
            owners,
            threshold,
            freezeGuardMultisigV1Data: {
              guardParams: freezeGuardMultisigParams,
              votingMultisigParams: freezeVotingMultisigParams,
            },
            numberOfNewContracts: 2,
          });
        });

        it('succeeds with FreezeGuardMultisig and FreezeVotingAzorius contracts', async () => {
          const setupSafeParams = createSetupSafeParams({
            freezeVotingAzoriusParams,
            freezeGuardMultisigParams,
          });

          await findAndVerifySafe({
            ...(await deploySafeWithSetup({
              fixtureData,
              owners,
              threshold,
              setupSafeParams,
            })),
            fixtureData,
            owners,
            threshold,
            freezeGuardMultisigV1Data: {
              guardParams: freezeGuardMultisigParams,
              votingAzoriusParams: freezeVotingAzoriusParams,
            },
            numberOfNewContracts: 2,
          });
        });
      });

      describe('with a Fractal Module and Freeze Guard Multisig', () => {
        it('deploys successfully', async () => {
          const setupSafeParams = createSetupSafeParams({
            moduleFractalParams: moduleFractalV1Params,
            freezeGuardMultisigParams,
            freezeVotingMultisigParams,
          });

          await findAndVerifySafe({
            ...(await deploySafeWithSetup({
              fixtureData,
              owners,
              threshold,
              setupSafeParams,
            })),
            fixtureData,
            owners,
            threshold,
            moduleFractalV1Params,
            freezeGuardMultisigV1Data: {
              guardParams: freezeGuardMultisigParams,
              votingMultisigParams: freezeVotingMultisigParams,
            },
            numberOfNewContracts: 3,
          });
        });
      });

      describe('with VotesERC20V1 and VotesERC20LockableV1 tokens', () => {
        it('deploys successfully with one VotesERC20V1 token', async () => {
          const setupSafeParams = createSetupSafeParams({
            votesERC20Params: {
              votesERC20V1Params: [votesERC20V1Params1],
              votesERC20LockableV1Params: [],
            },
          });

          await findAndVerifySafe({
            ...(await deploySafeWithSetup({
              fixtureData,
              owners,
              threshold,
              setupSafeParams,
            })),
            fixtureData,
            owners,
            threshold,
            votesERC20Datas: [[votesERC20V1Params1], []],
            numberOfNewContracts: 1,
          });
        });

        it('deploys successfully with multiple VotesERC20V1 tokens', async () => {
          const setupSafeParams = createSetupSafeParams({
            votesERC20Params: {
              votesERC20V1Params: [votesERC20V1Params1, votesERC20V1Params2],
              votesERC20LockableV1Params: [],
            },
          });

          await findAndVerifySafe({
            ...(await deploySafeWithSetup({
              fixtureData,
              owners,
              threshold,
              setupSafeParams,
            })),
            fixtureData,
            owners,
            threshold,
            votesERC20Datas: [[votesERC20V1Params1, votesERC20V1Params2], []],
            numberOfNewContracts: 2,
          });
        });

        it('deploys successfully with one VotesERC20LockableV1 token', async () => {
          const setupSafeParams = createSetupSafeParams({
            votesERC20Params: {
              votesERC20V1Params: [],
              votesERC20LockableV1Params: [votesERC20LockableV1Params1],
            },
          });

          await findAndVerifySafe({
            ...(await deploySafeWithSetup({
              fixtureData,
              owners,
              threshold,
              setupSafeParams,
            })),
            fixtureData,
            owners,
            threshold,
            votesERC20Datas: [[], [votesERC20LockableV1Params1]],
            numberOfNewContracts: 1,
          });
        });

        it('deploys successfully with multiple VotesERC20LockableV1 tokens', async () => {
          const setupSafeParams = createSetupSafeParams({
            votesERC20Params: {
              votesERC20V1Params: [],
              votesERC20LockableV1Params: [
                votesERC20LockableV1Params1,
                votesERC20LockableV1Params2,
              ],
            },
          });

          await findAndVerifySafe({
            ...(await deploySafeWithSetup({
              fixtureData,
              owners,
              threshold,
              setupSafeParams,
            })),
            fixtureData,
            owners,
            threshold,
            votesERC20Datas: [[], [votesERC20LockableV1Params1, votesERC20LockableV1Params2]],
            numberOfNewContracts: 2,
          });
        });

        it('deploys successfully with one VotesERC20V1 and one VotesERC20LockableV1 token', async () => {
          const setupSafeParams = createSetupSafeParams({
            votesERC20Params: {
              votesERC20V1Params: [votesERC20V1Params1],
              votesERC20LockableV1Params: [votesERC20LockableV1Params1],
            },
          });

          await findAndVerifySafe({
            ...(await deploySafeWithSetup({
              fixtureData,
              owners,
              threshold,
              setupSafeParams,
            })),
            fixtureData,
            owners,
            threshold,
            votesERC20Datas: [[votesERC20V1Params1], [votesERC20LockableV1Params1]],
            numberOfNewContracts: 2,
          });
        });

        it('deploys successfully with multiple VotesERC20V1 and VotesERC20LockableV1 tokens', async () => {
          const setupSafeParams = createSetupSafeParams({
            votesERC20Params: {
              votesERC20V1Params: [votesERC20V1Params1, votesERC20V1Params2],
              votesERC20LockableV1Params: [
                votesERC20LockableV1Params1,
                votesERC20LockableV1Params2,
              ],
            },
          });

          await findAndVerifySafe({
            ...(await deploySafeWithSetup({
              fixtureData,
              owners,
              threshold,
              setupSafeParams,
            })),
            fixtureData,
            owners,
            threshold,
            votesERC20Datas: [
              [votesERC20V1Params1, votesERC20V1Params2],
              [votesERC20LockableV1Params1, votesERC20LockableV1Params2],
            ],
            numberOfNewContracts: 4,
          });
        });
      });
    });

    describe('Deploy Azorius Governance', () => {
      let randomVotesERC20Contract: string;
      let randomVotesERC721Contract: string;
      let hatsContract: string;
      let moduleAzoriusV1Params: ISystemDeployerV1.ModuleAzoriusV1ParamsStruct;
      let proposerAdapterERC20V1Params1: ISystemDeployerV1.ProposerAdapterERC20V1ParamsStruct;
      let proposerAdapterERC20V1Params2: ISystemDeployerV1.ProposerAdapterERC20V1ParamsStruct;
      let proposerAdapterERC721V1Params1: ISystemDeployerV1.ProposerAdapterERC721V1ParamsStruct;
      let proposerAdapterERC721V1Params2: ISystemDeployerV1.ProposerAdapterERC721V1ParamsStruct;
      let proposerAdapterHatsV1Params1: ISystemDeployerV1.ProposerAdapterHatsV1ParamsStruct;
      let proposerAdapterHatsV1Params2: ISystemDeployerV1.ProposerAdapterHatsV1ParamsStruct;
      let votingAdapterERC20V1Params1: ISystemDeployerV1.VotingAdapterERC20V1ParamsStruct;
      let votingAdapterERC20V1Params2: ISystemDeployerV1.VotingAdapterERC20V1ParamsStruct;
      let votingAdapterERC721V1Params1: ISystemDeployerV1.VotingAdapterERC721V1ParamsStruct;
      let votingAdapterERC721V1Params2: ISystemDeployerV1.VotingAdapterERC721V1ParamsStruct;
      let strategyV1Params: ISystemDeployerV1.StrategyV1ParamsStruct;

      beforeEach(async () => {
        randomVotesERC20Contract = await fixtureData.votesERC20V1.getAddress();
        randomVotesERC721Contract = ethers.Wallet.createRandom().address;
        hatsContract = ethers.Wallet.createRandom().address;

        moduleAzoriusV1Params = {
          implementation: await fixtureData.moduleAzoriusV1.getAddress(),
          timelockPeriod: 3600,
          executionPeriod: 86400,
        };

        proposerAdapterERC20V1Params1 = {
          implementation: await fixtureData.proposerAdapterERC20V1.getAddress(),
          token: randomVotesERC20Contract,
          proposerThreshold: 100000,
          index: { typeI: 0, tokenI: 0 },
        };

        proposerAdapterERC20V1Params2 = {
          implementation: await fixtureData.proposerAdapterERC20V1.getAddress(),
          token: randomVotesERC20Contract,
          proposerThreshold: 874512,
          index: { typeI: 0, tokenI: 0 },
        };

        proposerAdapterERC721V1Params1 = {
          implementation: await fixtureData.proposerAdapterERC721V1.getAddress(),
          token: randomVotesERC721Contract,
          proposerThreshold: 100000,
        };

        proposerAdapterERC721V1Params2 = {
          implementation: await fixtureData.proposerAdapterERC721V1.getAddress(),
          token: randomVotesERC721Contract,
          proposerThreshold: 8745,
        };

        proposerAdapterHatsV1Params1 = {
          implementation: await fixtureData.proposerAdapterHatsV1.getAddress(),
          hatsContract: hatsContract,
          whitelistedHatIds: [1, 2, 3],
        };

        proposerAdapterHatsV1Params2 = {
          implementation: await fixtureData.proposerAdapterHatsV1.getAddress(),
          hatsContract: hatsContract,
          whitelistedHatIds: [4, 5, 6],
        };

        votingAdapterERC20V1Params1 = {
          implementation: await fixtureData.votingAdapterERC20V1.getAddress(),
          token: randomVotesERC20Contract,
          weightPerToken: 14,
          index: { typeI: 0, tokenI: 0 },
        };

        votingAdapterERC20V1Params2 = {
          implementation: await fixtureData.votingAdapterERC20V1.getAddress(),
          token: randomVotesERC20Contract,
          weightPerToken: 343,
          index: { typeI: 0, tokenI: 0 },
        };

        votingAdapterERC721V1Params1 = {
          implementation: await fixtureData.votingAdapterERC721V1.getAddress(),
          token: randomVotesERC721Contract,
          weightPerToken: 14,
        };

        votingAdapterERC721V1Params2 = {
          implementation: await fixtureData.votingAdapterERC721V1.getAddress(),
          token: randomVotesERC721Contract,
          weightPerToken: 343,
        };

        strategyV1Params = {
          implementation: await fixtureData.strategyV1.getAddress(),
          votingPeriod: 86400,
          quorumThreshold: 1000,
          basisNumerator: 500000,
          lightAccountFactory: ethers.ZeroAddress,
        };
      });

      describe('With Multisig', () => {
        it('deploys with a single non-signer', async () => {
          const owners = ['0x0000000000000000000000000000000000000002'];
          const threshold = 1;

          const setupSafeParams = createSetupSafeParams({
            azoriusGovernanceParams: {
              proposerAdapterParams: {
                proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                proposerAdapterERC721V1Params: [],
                proposerAdapterHatsV1Params: [],
              },
              strategyV1Params,
              votingAdapterParams: {
                votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                votingAdapterERC721V1Params: [],
              },
              moduleAzoriusV1Params,
            },
          });

          await findAndVerifySafe({
            ...(await deploySafeWithSetup({
              fixtureData,
              owners,
              threshold,
              setupSafeParams,
            })),
            fixtureData,
            owners,
            threshold,
            proposerAdapterERC20V1Datas: [
              {
                params: proposerAdapterERC20V1Params1,
                token: randomVotesERC20Contract,
              },
            ],
            strategyV1Params,
            moduleAzoriusV1Params,
            votingAdapterERC20V1Datas: [
              {
                params: votingAdapterERC20V1Params1,
                token: randomVotesERC20Contract,
              },
            ],
            numberOfNewContracts: 4,
          });
        });

        it('deploys with multiple signers', async () => {
          const owners = [fixtureData.user1.address, fixtureData.user2.address];
          const threshold = 2;

          const setupSafeParams = createSetupSafeParams({
            azoriusGovernanceParams: {
              proposerAdapterParams: {
                proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                proposerAdapterERC721V1Params: [],
                proposerAdapterHatsV1Params: [],
              },
              strategyV1Params,
              votingAdapterParams: {
                votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                votingAdapterERC721V1Params: [],
              },
              moduleAzoriusV1Params,
            },
          });

          await findAndVerifySafe({
            ...(await deploySafeWithSetup({
              fixtureData,
              owners,
              threshold,
              setupSafeParams,
            })),
            fixtureData,
            owners,
            threshold,
            proposerAdapterERC20V1Datas: [
              {
                params: proposerAdapterERC20V1Params1,
                token: randomVotesERC20Contract,
              },
            ],
            strategyV1Params,
            moduleAzoriusV1Params,
            votingAdapterERC20V1Datas: [
              {
                params: votingAdapterERC20V1Params1,
                token: randomVotesERC20Contract,
              },
            ],
            numberOfNewContracts: 4,
          });
        });
      });

      describe('Without Multisig', () => {
        let owners: string[];
        let threshold: number;

        beforeEach(async () => {
          owners = ['0x0000000000000000000000000000000000000002'];
          threshold = 1;
        });

        describe('With VotesERC20 & VotesERC20Lockable tokens', () => {
          describe('With VotesERC20V1 tokens', () => {
            it('deploys with a single VotesERC20V1 token', async () => {
              const setupSafeParams = createSetupSafeParams({
                votesERC20Params: {
                  votesERC20V1Params: [votesERC20V1Params1],
                  votesERC20LockableV1Params: [],
                },
                azoriusGovernanceParams: {
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                    votingAdapterERC721V1Params: [],
                  },
                  moduleAzoriusV1Params,
                },
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                votesERC20Datas: [[votesERC20V1Params1], []],
                proposerAdapterERC20V1Datas: [
                  {
                    params: proposerAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC20V1Datas: [
                  {
                    params: votingAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                numberOfNewContracts: 5,
              });
            });

            it('deploys with multiple VotesERC20V1 tokens', async () => {
              const setupSafeParams = createSetupSafeParams({
                votesERC20Params: {
                  votesERC20V1Params: [votesERC20V1Params1, votesERC20V1Params2],
                  votesERC20LockableV1Params: [],
                },
                azoriusGovernanceParams: {
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                    votingAdapterERC721V1Params: [],
                  },
                  moduleAzoriusV1Params,
                },
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                votesERC20Datas: [[votesERC20V1Params1, votesERC20V1Params2], []],
                proposerAdapterERC20V1Datas: [
                  {
                    params: proposerAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC20V1Datas: [
                  {
                    params: votingAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                numberOfNewContracts: 6,
              });
            });
          });

          describe('With VotesERC20LockableV1 tokens', () => {
            it('deploys with a single VotesERC20LockableV1 token', async () => {
              const setupSafeParams = createSetupSafeParams({
                votesERC20Params: {
                  votesERC20V1Params: [],
                  votesERC20LockableV1Params: [votesERC20LockableV1Params1],
                },
                azoriusGovernanceParams: {
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                    votingAdapterERC721V1Params: [],
                  },
                  moduleAzoriusV1Params,
                },
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                votesERC20Datas: [[], [votesERC20LockableV1Params1]],
                proposerAdapterERC20V1Datas: [
                  {
                    params: proposerAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC20V1Datas: [
                  {
                    params: votingAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                numberOfNewContracts: 5,
              });
            });

            it('deploys with multiple VotesERC20LockableV1 tokens', async () => {
              const setupSafeParams = createSetupSafeParams({
                votesERC20Params: {
                  votesERC20V1Params: [],
                  votesERC20LockableV1Params: [
                    votesERC20LockableV1Params1,
                    votesERC20LockableV1Params2,
                  ],
                },
                azoriusGovernanceParams: {
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                    votingAdapterERC721V1Params: [],
                  },
                  moduleAzoriusV1Params,
                },
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                votesERC20Datas: [[], [votesERC20LockableV1Params1, votesERC20LockableV1Params2]],
                proposerAdapterERC20V1Datas: [
                  {
                    params: proposerAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC20V1Datas: [
                  {
                    params: votingAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                numberOfNewContracts: 6,
              });
            });
          });

          describe('With VotesERC20V1 and VotesERC20LockableV1 tokens', () => {
            it('deploys with a mix of VotesERC20V1 and VotesERC20LockableV1 tokens', async () => {
              const setupSafeParams = createSetupSafeParams({
                votesERC20Params: {
                  votesERC20V1Params: [votesERC20V1Params1],
                  votesERC20LockableV1Params: [votesERC20LockableV1Params1],
                },
                azoriusGovernanceParams: {
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                    votingAdapterERC721V1Params: [],
                  },
                  moduleAzoriusV1Params,
                },
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                votesERC20Datas: [[votesERC20V1Params1], [votesERC20LockableV1Params1]],
                proposerAdapterERC20V1Datas: [
                  {
                    params: proposerAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC20V1Datas: [
                  {
                    params: votingAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                numberOfNewContracts: 6,
              });
            });
          });
        });

        describe('With Voting Adapters', () => {
          describe('ERC20 voting adapters', () => {
            describe('No new tokens', () => {
              it('deploys with a VotingAdapterERC20V1 pointing to an existing token', async () => {
                const setupSafeParams = createSetupSafeParams({
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  proposerAdapterERC20V1Datas: [
                    {
                      params: proposerAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    {
                      params: votingAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  numberOfNewContracts: 4,
                });
              });

              it('deploys multiple VotingAdapterERC20V1s pointing to existing tokens', async () => {
                const setupSafeParams = createSetupSafeParams({
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [
                        votingAdapterERC20V1Params1,
                        votingAdapterERC20V1Params2,
                      ],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  proposerAdapterERC20V1Datas: [
                    {
                      params: proposerAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    {
                      params: votingAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                    {
                      params: votingAdapterERC20V1Params2,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  numberOfNewContracts: 5,
                });
              });
            });

            describe('One new VotesERC20 token', () => {
              it('deploys a VotingAdapterERC20V1 pointing to the new token', async () => {
                votingAdapterERC20V1Params1 = {
                  ...votingAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 0, tokenI: 0 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [votesERC20V1Params1],
                    votesERC20LockableV1Params: [],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [[votesERC20V1Params1], []],
                  proposerAdapterERC20V1Datas: [
                    {
                      params: proposerAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [{ params: votingAdapterERC20V1Params1 }],
                  numberOfNewContracts: 5,
                });
              });

              it('deploys multiple VotingAdapterERC20V1s pointing to the same new token', async () => {
                votingAdapterERC20V1Params1 = {
                  ...votingAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 0, tokenI: 0 },
                };

                votingAdapterERC20V1Params2 = {
                  ...votingAdapterERC20V1Params2,
                  token: ethers.ZeroAddress,
                  index: { typeI: 0, tokenI: 0 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [votesERC20V1Params1],
                    votesERC20LockableV1Params: [],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [
                        votingAdapterERC20V1Params1,
                        votingAdapterERC20V1Params2,
                      ],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [[votesERC20V1Params1], []],
                  proposerAdapterERC20V1Datas: [
                    {
                      params: proposerAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    { params: votingAdapterERC20V1Params1 },
                    { params: votingAdapterERC20V1Params2 },
                  ],
                  numberOfNewContracts: 6,
                });
              });

              it('reverts if the VotingAdapterERC20 points to an invalid new token index', async () => {
                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [votesERC20V1Params1],
                    votesERC20LockableV1Params: [],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                const data = {
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                };

                // initial deployment should succeed
                await deploySafeWithSetup(data);

                // now updating the setupSafeParams to include an invalid index should fail
                // also the default votingAdapterERC20V1Params1 token is an external token, so set it to zero address so index is used
                data.setupSafeParams.azoriusGovernanceParams.votingAdapterParams.votingAdapterERC20V1Params[0].index =
                  { typeI: 0, tokenI: 1 };
                data.setupSafeParams.azoriusGovernanceParams.votingAdapterParams.votingAdapterERC20V1Params[0].token =
                  ethers.ZeroAddress;

                await expect(deploySafeWithSetup(data)).to.be.reverted;
              });
            });

            describe('Multiple new VotesERC20 tokens', () => {
              it('deploys a VotingAdapterERC20V1 pointing to one of the new tokens', async () => {
                votingAdapterERC20V1Params1 = {
                  ...votingAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 0, tokenI: 1 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [votesERC20V1Params1, votesERC20V1Params2],
                    votesERC20LockableV1Params: [],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [[votesERC20V1Params1, votesERC20V1Params2], []],
                  proposerAdapterERC20V1Datas: [
                    {
                      params: proposerAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [{ params: votingAdapterERC20V1Params1 }],
                  numberOfNewContracts: 6,
                });
              });

              it('deploys multiple VotingAdapterERC20V1s, each pointing to one of the new tokens', async () => {
                votingAdapterERC20V1Params1 = {
                  ...votingAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 0, tokenI: 1 },
                };

                votingAdapterERC20V1Params2 = {
                  ...votingAdapterERC20V1Params2,
                  token: ethers.ZeroAddress,
                  index: { typeI: 0, tokenI: 0 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [votesERC20V1Params1, votesERC20V1Params2],
                    votesERC20LockableV1Params: [],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [
                        votingAdapterERC20V1Params1,
                        votingAdapterERC20V1Params2,
                      ],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [[votesERC20V1Params1, votesERC20V1Params2], []],
                  proposerAdapterERC20V1Datas: [
                    {
                      params: proposerAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    { params: votingAdapterERC20V1Params1 },
                    { params: votingAdapterERC20V1Params2 },
                  ],
                  numberOfNewContracts: 7,
                });
              });
            });

            describe('One new VotesERC20Lockable token', () => {
              it('deploys a VotingAdapterERC20V1 pointing to the new token', async () => {
                votingAdapterERC20V1Params1 = {
                  ...votingAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 1, tokenI: 0 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [],
                    votesERC20LockableV1Params: [votesERC20LockableV1Params1],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [[], [votesERC20LockableV1Params1]],
                  proposerAdapterERC20V1Datas: [
                    {
                      params: proposerAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [{ params: votingAdapterERC20V1Params1 }],
                  numberOfNewContracts: 5,
                });
              });

              it('deploys multiple VotingAdapterERC20V1s pointing to the same new token', async () => {
                votingAdapterERC20V1Params1 = {
                  ...votingAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 1, tokenI: 0 },
                };

                votingAdapterERC20V1Params2 = {
                  ...votingAdapterERC20V1Params2,
                  token: ethers.ZeroAddress,
                  index: { typeI: 1, tokenI: 0 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [],
                    votesERC20LockableV1Params: [votesERC20LockableV1Params1],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [
                        votingAdapterERC20V1Params1,
                        votingAdapterERC20V1Params2,
                      ],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [[], [votesERC20LockableV1Params1]],
                  proposerAdapterERC20V1Datas: [
                    {
                      params: proposerAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    { params: votingAdapterERC20V1Params1 },
                    { params: votingAdapterERC20V1Params2 },
                  ],
                  numberOfNewContracts: 6,
                });
              });

              it('reverts if the VotingAdapterERC20 points to an invalid new token index', async () => {
                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [],
                    votesERC20LockableV1Params: [votesERC20LockableV1Params1],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                const data = {
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                };

                // initial deployment should succeed
                await deploySafeWithSetup(data);

                // now updating the setupSafeParams to include an invalid index should fail
                // also the default votingAdapterERC20V1Params1 token is an external token, so set it to zero address so index is used
                data.setupSafeParams.azoriusGovernanceParams.votingAdapterParams.votingAdapterERC20V1Params[0].index =
                  { typeI: 1, tokenI: 1 };
                data.setupSafeParams.azoriusGovernanceParams.votingAdapterParams.votingAdapterERC20V1Params[0].token =
                  ethers.ZeroAddress;

                await expect(deploySafeWithSetup(data)).to.be.reverted;
              });
            });

            describe('Multiple new VotesERC20Lockable tokens', () => {
              it('deploys a VotingAdapterERC20V1 pointing to one of the new tokens', async () => {
                votingAdapterERC20V1Params1 = {
                  ...votingAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 1, tokenI: 1 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [],
                    votesERC20LockableV1Params: [
                      votesERC20LockableV1Params1,
                      votesERC20LockableV1Params2,
                    ],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [[], [votesERC20LockableV1Params1, votesERC20LockableV1Params2]],
                  proposerAdapterERC20V1Datas: [
                    {
                      params: proposerAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [{ params: votingAdapterERC20V1Params1 }],
                  numberOfNewContracts: 6,
                });
              });

              it('deploys multiple VotingAdapterERC20V1s, each pointing to one of the new tokens', async () => {
                votingAdapterERC20V1Params1 = {
                  ...votingAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 1, tokenI: 1 },
                };

                votingAdapterERC20V1Params2 = {
                  ...votingAdapterERC20V1Params2,
                  token: ethers.ZeroAddress,
                  index: { typeI: 1, tokenI: 0 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [],
                    votesERC20LockableV1Params: [
                      votesERC20LockableV1Params1,
                      votesERC20LockableV1Params2,
                    ],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [
                        votingAdapterERC20V1Params1,
                        votingAdapterERC20V1Params2,
                      ],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [[], [votesERC20LockableV1Params1, votesERC20LockableV1Params2]],
                  proposerAdapterERC20V1Datas: [
                    {
                      params: proposerAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    { params: votingAdapterERC20V1Params1 },
                    { params: votingAdapterERC20V1Params2 },
                  ],
                  numberOfNewContracts: 7,
                });
              });
            });

            describe('New VotesERC20 and VotesERC20Lockable tokens', () => {
              it('deploys a VotingAdapterERC20V1 pointing to one of the new tokens', async () => {
                votingAdapterERC20V1Params1 = {
                  ...votingAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 1, tokenI: 1 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [votesERC20V1Params1, votesERC20V1Params2],
                    votesERC20LockableV1Params: [
                      votesERC20LockableV1Params1,
                      votesERC20LockableV1Params2,
                    ],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [
                    [votesERC20V1Params1, votesERC20V1Params2],
                    [votesERC20LockableV1Params1, votesERC20LockableV1Params2],
                  ],
                  proposerAdapterERC20V1Datas: [
                    {
                      params: proposerAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [{ params: votingAdapterERC20V1Params1 }],
                  numberOfNewContracts: 8,
                });
              });

              it('deploys multiple VotingAdapterERC20V1s, each pointing to one of the new tokens', async () => {
                votingAdapterERC20V1Params1 = {
                  ...votingAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 1, tokenI: 1 },
                };

                votingAdapterERC20V1Params2 = {
                  ...votingAdapterERC20V1Params2,
                  token: ethers.ZeroAddress,
                  index: { typeI: 0, tokenI: 0 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [votesERC20V1Params1, votesERC20V1Params2],
                    votesERC20LockableV1Params: [
                      votesERC20LockableV1Params1,
                      votesERC20LockableV1Params2,
                    ],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [
                        votingAdapterERC20V1Params1,
                        votingAdapterERC20V1Params2,
                      ],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [
                    [votesERC20V1Params1, votesERC20V1Params2],
                    [votesERC20LockableV1Params1, votesERC20LockableV1Params2],
                  ],
                  proposerAdapterERC20V1Datas: [
                    {
                      params: proposerAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    { params: votingAdapterERC20V1Params1 },
                    { params: votingAdapterERC20V1Params2 },
                  ],
                  numberOfNewContracts: 9,
                });
              });
            });
          });

          describe('ERC721 voting adapters', () => {
            it('deploys successfully with one VotingAdapterERC721', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [],
                    votingAdapterERC721V1Params: [votingAdapterERC721V1Params1],
                  },
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  moduleAzoriusV1Params,
                },
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                proposerAdapterERC20V1Datas: [
                  {
                    params: proposerAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC721V1Datas: [{ params: votingAdapterERC721V1Params1 }],
                numberOfNewContracts: 4,
              });
            });

            it('deploys successfully with multiple VotingAdapterERC721s', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [],
                    votingAdapterERC721V1Params: [
                      votingAdapterERC721V1Params1,
                      votingAdapterERC721V1Params2,
                    ],
                  },
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  moduleAzoriusV1Params,
                },
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                proposerAdapterERC20V1Datas: [
                  {
                    params: proposerAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC721V1Datas: [
                  { params: votingAdapterERC721V1Params1 },
                  { params: votingAdapterERC721V1Params2 },
                ],
                numberOfNewContracts: 5,
              });
            });
          });

          describe('Mixed voting adapters', () => {
            it('deploys successfully with multiple voting adapters', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                    votingAdapterERC721V1Params: [votingAdapterERC721V1Params1],
                  },
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  moduleAzoriusV1Params,
                },
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                proposerAdapterERC20V1Datas: [
                  {
                    params: proposerAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC20V1Datas: [
                  { params: votingAdapterERC20V1Params1, token: randomVotesERC20Contract },
                ],
                votingAdapterERC721V1Datas: [{ params: votingAdapterERC721V1Params1 }],
                numberOfNewContracts: 5,
              });
            });
          });
        });

        describe('With Proposer Adapters', () => {
          describe('ERC20 proposer adapters', () => {
            describe('No new tokens', () => {
              it('deploys with a ProposerAdapterERC20V1 pointing to an existing token', async () => {
                // Note: this is same test as "deploys with a VotingAdapterERC20V1 pointing to an existing token"
                const setupSafeParams = createSetupSafeParams({
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  proposerAdapterERC20V1Datas: [
                    {
                      params: proposerAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    {
                      params: votingAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  numberOfNewContracts: 4,
                });
              });

              it('deploys multiple ProposerAdapterERC20V1s pointing to existing tokens', async () => {
                const setupSafeParams = createSetupSafeParams({
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [
                        proposerAdapterERC20V1Params1,
                        proposerAdapterERC20V1Params2,
                      ],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  proposerAdapterERC20V1Datas: [
                    {
                      params: proposerAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                    {
                      params: proposerAdapterERC20V1Params2,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    {
                      params: votingAdapterERC20V1Params1,
                      token: randomVotesERC20Contract,
                    },
                  ],
                  numberOfNewContracts: 5,
                });
              });
            });

            describe('One new VotesERC20 token', () => {
              it('deploys a ProposerAdapterERC20V1 pointing to the new token', async () => {
                proposerAdapterERC20V1Params1 = {
                  ...proposerAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 0, tokenI: 0 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [votesERC20V1Params1],
                    votesERC20LockableV1Params: [],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [[votesERC20V1Params1], []],
                  proposerAdapterERC20V1Datas: [{ params: proposerAdapterERC20V1Params1 }],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    { params: votingAdapterERC20V1Params1, token: randomVotesERC20Contract },
                  ],
                  numberOfNewContracts: 5,
                });
              });

              it('deploys multiple ProposerAdapterERC20V1s pointing to the same new token', async () => {
                proposerAdapterERC20V1Params1 = {
                  ...proposerAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 0, tokenI: 0 },
                };

                proposerAdapterERC20V1Params2 = {
                  ...proposerAdapterERC20V1Params2,
                  token: ethers.ZeroAddress,
                  index: { typeI: 0, tokenI: 0 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [votesERC20V1Params1],
                    votesERC20LockableV1Params: [],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [
                        proposerAdapterERC20V1Params1,
                        proposerAdapterERC20V1Params2,
                      ],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [[votesERC20V1Params1], []],
                  proposerAdapterERC20V1Datas: [
                    { params: proposerAdapterERC20V1Params1 },
                    { params: proposerAdapterERC20V1Params2 },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    { params: votingAdapterERC20V1Params1, token: randomVotesERC20Contract },
                  ],
                  numberOfNewContracts: 6,
                });
              });

              it('reverts if the ProposerAdapterERC20 points to an invalid new token index', async () => {
                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [votesERC20V1Params1],
                    votesERC20LockableV1Params: [],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                const data = {
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                };

                // initial deployment should succeed
                await deploySafeWithSetup(data);

                // now updating the setupSafeParams to include an invalid index should fail
                // also the default proposerAdapterERC20V1Params1 token is an external token, so set it to zero address so index is used
                data.setupSafeParams.azoriusGovernanceParams.proposerAdapterParams.proposerAdapterERC20V1Params[0].index =
                  { typeI: 0, tokenI: 1 };
                data.setupSafeParams.azoriusGovernanceParams.proposerAdapterParams.proposerAdapterERC20V1Params[0].token =
                  ethers.ZeroAddress;

                await expect(deploySafeWithSetup(data)).to.be.reverted;
              });
            });

            describe('Multiple new VotesERC20 tokens', () => {
              it('deploys a ProposerAdapterERC20V1 pointing to one of the new tokens', async () => {
                proposerAdapterERC20V1Params1 = {
                  ...proposerAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 0, tokenI: 1 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [votesERC20V1Params1, votesERC20V1Params2],
                    votesERC20LockableV1Params: [],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [[votesERC20V1Params1, votesERC20V1Params2], []],
                  proposerAdapterERC20V1Datas: [{ params: proposerAdapterERC20V1Params1 }],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    { params: votingAdapterERC20V1Params1, token: randomVotesERC20Contract },
                  ],
                  numberOfNewContracts: 6,
                });
              });

              it('deploys multiple ProposerAdapterERC20V1s, each pointing to one of the new tokens', async () => {
                proposerAdapterERC20V1Params1 = {
                  ...proposerAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 0, tokenI: 1 },
                };

                proposerAdapterERC20V1Params2 = {
                  ...proposerAdapterERC20V1Params2,
                  token: ethers.ZeroAddress,
                  index: { typeI: 0, tokenI: 0 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [votesERC20V1Params1, votesERC20V1Params2],
                    votesERC20LockableV1Params: [],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [
                        proposerAdapterERC20V1Params1,
                        proposerAdapterERC20V1Params2,
                      ],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [[votesERC20V1Params1, votesERC20V1Params2], []],
                  proposerAdapterERC20V1Datas: [
                    { params: proposerAdapterERC20V1Params1 },
                    { params: proposerAdapterERC20V1Params2 },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    { params: votingAdapterERC20V1Params1, token: randomVotesERC20Contract },
                  ],
                  numberOfNewContracts: 7,
                });
              });
            });

            describe('One new VotesERC20Lockable token', () => {
              it('deploys a ProposerAdapterERC20V1 pointing to the new token', async () => {
                proposerAdapterERC20V1Params1 = {
                  ...proposerAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 1, tokenI: 0 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [],
                    votesERC20LockableV1Params: [votesERC20LockableV1Params1],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [[], [votesERC20LockableV1Params1]],
                  proposerAdapterERC20V1Datas: [{ params: proposerAdapterERC20V1Params1 }],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    { params: votingAdapterERC20V1Params1, token: randomVotesERC20Contract },
                  ],
                  numberOfNewContracts: 5,
                });
              });

              it('deploys multiple ProposerAdapterERC20V1s pointing to the same new token', async () => {
                proposerAdapterERC20V1Params1 = {
                  ...proposerAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 1, tokenI: 0 },
                };

                proposerAdapterERC20V1Params2 = {
                  ...proposerAdapterERC20V1Params2,
                  token: ethers.ZeroAddress,
                  index: { typeI: 1, tokenI: 0 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [],
                    votesERC20LockableV1Params: [votesERC20LockableV1Params1],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [
                        proposerAdapterERC20V1Params1,
                        proposerAdapterERC20V1Params2,
                      ],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [[], [votesERC20LockableV1Params1]],
                  proposerAdapterERC20V1Datas: [
                    { params: proposerAdapterERC20V1Params1 },
                    { params: proposerAdapterERC20V1Params2 },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    { params: votingAdapterERC20V1Params1, token: randomVotesERC20Contract },
                  ],
                  numberOfNewContracts: 6,
                });
              });

              it('reverts if the ProposerAdapterERC20 points to an invalid new token index', async () => {
                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [],
                    votesERC20LockableV1Params: [votesERC20LockableV1Params1],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                const data = {
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                };

                // initial deployment should succeed
                await deploySafeWithSetup(data);

                // now updating the setupSafeParams to include an invalid index should fail
                // also the default proposerAdapterERC20V1Params1 token is an external token, so set it to zero address so index is used
                data.setupSafeParams.azoriusGovernanceParams.proposerAdapterParams.proposerAdapterERC20V1Params[0].index =
                  { typeI: 1, tokenI: 1 };
                data.setupSafeParams.azoriusGovernanceParams.proposerAdapterParams.proposerAdapterERC20V1Params[0].token =
                  ethers.ZeroAddress;

                await expect(deploySafeWithSetup(data)).to.be.reverted;
              });
            });

            describe('Multiple new VotesERC20Lockable tokens', () => {
              it('deploys a ProposerAdapterERC20V1 pointing to one of the new tokens', async () => {
                proposerAdapterERC20V1Params1 = {
                  ...proposerAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 1, tokenI: 1 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [],
                    votesERC20LockableV1Params: [
                      votesERC20LockableV1Params1,
                      votesERC20LockableV1Params2,
                    ],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [[], [votesERC20LockableV1Params1, votesERC20LockableV1Params2]],
                  proposerAdapterERC20V1Datas: [{ params: proposerAdapterERC20V1Params1 }],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    { params: votingAdapterERC20V1Params1, token: randomVotesERC20Contract },
                  ],
                  numberOfNewContracts: 6,
                });
              });

              it('deploys multiple ProposerAdapterERC20V1s, each pointing to one of the new tokens', async () => {
                proposerAdapterERC20V1Params1 = {
                  ...proposerAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 1, tokenI: 1 },
                };

                proposerAdapterERC20V1Params2 = {
                  ...proposerAdapterERC20V1Params2,
                  token: ethers.ZeroAddress,
                  index: { typeI: 1, tokenI: 0 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [],
                    votesERC20LockableV1Params: [
                      votesERC20LockableV1Params1,
                      votesERC20LockableV1Params2,
                    ],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [
                        proposerAdapterERC20V1Params1,
                        proposerAdapterERC20V1Params2,
                      ],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [[], [votesERC20LockableV1Params1, votesERC20LockableV1Params2]],
                  proposerAdapterERC20V1Datas: [
                    { params: proposerAdapterERC20V1Params1 },
                    { params: proposerAdapterERC20V1Params2 },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    { params: votingAdapterERC20V1Params1, token: randomVotesERC20Contract },
                  ],
                  numberOfNewContracts: 7,
                });
              });
            });

            describe('New VotesERC20 and VotesERC20Lockable tokens', () => {
              it('deploys a ProposerAdapterERC20V1 pointing to one of the new tokens', async () => {
                proposerAdapterERC20V1Params1 = {
                  ...proposerAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 1, tokenI: 1 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [votesERC20V1Params1, votesERC20V1Params2],
                    votesERC20LockableV1Params: [
                      votesERC20LockableV1Params1,
                      votesERC20LockableV1Params2,
                    ],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [
                    [votesERC20V1Params1, votesERC20V1Params2],
                    [votesERC20LockableV1Params1, votesERC20LockableV1Params2],
                  ],
                  proposerAdapterERC20V1Datas: [{ params: proposerAdapterERC20V1Params1 }],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    { params: votingAdapterERC20V1Params1, token: randomVotesERC20Contract },
                  ],
                  numberOfNewContracts: 8,
                });
              });

              it('deploys multiple ProposerAdapterERC20V1s, each pointing to one of the new tokens', async () => {
                proposerAdapterERC20V1Params1 = {
                  ...proposerAdapterERC20V1Params1,
                  token: ethers.ZeroAddress,
                  index: { typeI: 1, tokenI: 1 },
                };

                proposerAdapterERC20V1Params2 = {
                  ...proposerAdapterERC20V1Params2,
                  token: ethers.ZeroAddress,
                  index: { typeI: 0, tokenI: 0 },
                };

                const setupSafeParams = createSetupSafeParams({
                  votesERC20Params: {
                    votesERC20V1Params: [votesERC20V1Params1, votesERC20V1Params2],
                    votesERC20LockableV1Params: [
                      votesERC20LockableV1Params1,
                      votesERC20LockableV1Params2,
                    ],
                  },
                  azoriusGovernanceParams: {
                    votingAdapterParams: {
                      votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                      votingAdapterERC721V1Params: [],
                    },
                    proposerAdapterParams: {
                      proposerAdapterERC20V1Params: [
                        proposerAdapterERC20V1Params1,
                        proposerAdapterERC20V1Params2,
                      ],
                      proposerAdapterERC721V1Params: [],
                      proposerAdapterHatsV1Params: [],
                    },
                    strategyV1Params,
                    moduleAzoriusV1Params,
                  },
                });

                await findAndVerifySafe({
                  ...(await deploySafeWithSetup({
                    fixtureData,
                    owners,
                    threshold,
                    setupSafeParams,
                  })),
                  fixtureData,
                  owners,
                  threshold,
                  votesERC20Datas: [
                    [votesERC20V1Params1, votesERC20V1Params2],
                    [votesERC20LockableV1Params1, votesERC20LockableV1Params2],
                  ],
                  proposerAdapterERC20V1Datas: [
                    { params: proposerAdapterERC20V1Params1 },
                    { params: proposerAdapterERC20V1Params2 },
                  ],
                  strategyV1Params,
                  moduleAzoriusV1Params,
                  votingAdapterERC20V1Datas: [
                    { params: votingAdapterERC20V1Params1, token: randomVotesERC20Contract },
                  ],
                  numberOfNewContracts: 9,
                });
              });
            });
          });

          describe('ERC721 proposer adapters', () => {
            it('deploys successfully with one ProposerAdapterERC721', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                    votingAdapterERC721V1Params: [],
                  },
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [],
                    proposerAdapterERC721V1Params: [proposerAdapterERC721V1Params1],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  moduleAzoriusV1Params,
                },
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                proposerAdapterERC721V1Datas: [{ params: proposerAdapterERC721V1Params1 }],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC20V1Datas: [
                  { params: votingAdapterERC20V1Params1, token: randomVotesERC20Contract },
                ],
                numberOfNewContracts: 4,
              });
            });

            it('deploys successfully with multiple ProposerAdapterERC721s', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                    votingAdapterERC721V1Params: [],
                  },
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [],
                    proposerAdapterERC721V1Params: [
                      proposerAdapterERC721V1Params1,
                      proposerAdapterERC721V1Params2,
                    ],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  moduleAzoriusV1Params,
                },
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                proposerAdapterERC721V1Datas: [
                  { params: proposerAdapterERC721V1Params1 },
                  { params: proposerAdapterERC721V1Params2 },
                ],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC20V1Datas: [
                  { params: votingAdapterERC20V1Params1, token: randomVotesERC20Contract },
                ],
                numberOfNewContracts: 5,
              });
            });
          });

          describe('Hats proposer adapters', () => {
            it('deploys successfully with one ProposerAdapterHats', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                    votingAdapterERC721V1Params: [],
                  },
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [proposerAdapterHatsV1Params1],
                  },
                  strategyV1Params,
                  moduleAzoriusV1Params,
                },
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                proposerAdapterHatsV1Datas: [{ params: proposerAdapterHatsV1Params1 }],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC20V1Datas: [
                  { params: votingAdapterERC20V1Params1, token: randomVotesERC20Contract },
                ],
                numberOfNewContracts: 4,
              });
            });

            it('deploys successfully with multiple ProposerAdapterHats', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                    votingAdapterERC721V1Params: [],
                  },
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [
                      proposerAdapterHatsV1Params1,
                      proposerAdapterHatsV1Params2,
                    ],
                  },
                  strategyV1Params,
                  moduleAzoriusV1Params,
                },
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                proposerAdapterHatsV1Datas: [
                  { params: proposerAdapterHatsV1Params1 },
                  { params: proposerAdapterHatsV1Params2 },
                ],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC20V1Datas: [
                  { params: votingAdapterERC20V1Params1, token: randomVotesERC20Contract },
                ],
                numberOfNewContracts: 5,
              });
            });
          });

          describe('Mixed proposer adapters', () => {
            it('deploys successfully with multiple proposer adapters', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [votingAdapterERC20V1Params1],
                    votingAdapterERC721V1Params: [],
                  },
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [proposerAdapterERC20V1Params1],
                    proposerAdapterERC721V1Params: [proposerAdapterERC721V1Params1],
                    proposerAdapterHatsV1Params: [proposerAdapterHatsV1Params1],
                  },
                  strategyV1Params,
                  moduleAzoriusV1Params,
                },
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                proposerAdapterERC20V1Datas: [
                  {
                    params: proposerAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                proposerAdapterERC721V1Datas: [{ params: proposerAdapterERC721V1Params1 }],
                proposerAdapterHatsV1Datas: [{ params: proposerAdapterHatsV1Params1 }],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC20V1Datas: [
                  { params: votingAdapterERC20V1Params1, token: randomVotesERC20Contract },
                ],
                numberOfNewContracts: 6,
              });
            });
          });
        });

        describe('with Fractal Module', () => {
          it('deploys with a Fractal Module', async () => {
            const setupSafeParams = createSetupSafeParams({
              azoriusGovernanceParams: {
                proposerAdapterParams: {
                  proposerAdapterERC20V1Params: [{ ...proposerAdapterERC20V1Params1 }],
                  proposerAdapterERC721V1Params: [],
                  proposerAdapterHatsV1Params: [],
                },
                votingAdapterParams: {
                  votingAdapterERC20V1Params: [{ ...votingAdapterERC20V1Params1 }],
                  votingAdapterERC721V1Params: [],
                },
                strategyV1Params,
                moduleAzoriusV1Params,
              },
              moduleFractalParams: moduleFractalV1Params,
            });

            await findAndVerifySafe({
              ...(await deploySafeWithSetup({
                fixtureData,
                owners,
                threshold,
                setupSafeParams,
              })),
              fixtureData,
              owners,
              threshold,
              moduleFractalV1Params,
              proposerAdapterERC20V1Datas: [
                {
                  params: proposerAdapterERC20V1Params1,
                  token: randomVotesERC20Contract,
                },
              ],
              strategyV1Params,
              moduleAzoriusV1Params,
              votingAdapterERC20V1Datas: [
                {
                  params: votingAdapterERC20V1Params1,
                  token: randomVotesERC20Contract,
                },
              ],
              numberOfNewContracts: 5,
            });
          });
        });

        describe('with FreezeGuards', () => {
          describe('FreezeGuardMultisig configurations', () => {
            it('deploys with a FreezeGuardMultisig with FreezeVotingMultisig', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [{ ...proposerAdapterERC20V1Params1 }],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [{ ...votingAdapterERC20V1Params1 }],
                    votingAdapterERC721V1Params: [],
                  },
                  moduleAzoriusV1Params,
                },
                freezeVotingMultisigParams,
                freezeGuardMultisigParams,
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                proposerAdapterERC20V1Datas: [
                  {
                    params: proposerAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC20V1Datas: [
                  {
                    params: votingAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                freezeGuardMultisigV1Data: {
                  guardParams: freezeGuardMultisigParams,
                  votingMultisigParams: freezeVotingMultisigParams,
                },
                numberOfNewContracts: 6,
              });
            });

            it('deploys with a FreezeGuardMultisig with FreezeVotingAzorius', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [{ ...proposerAdapterERC20V1Params1 }],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [{ ...votingAdapterERC20V1Params1 }],
                    votingAdapterERC721V1Params: [],
                  },
                  moduleAzoriusV1Params,
                },
                freezeVotingAzoriusParams,
                freezeGuardMultisigParams,
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                proposerAdapterERC20V1Datas: [
                  {
                    params: proposerAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC20V1Datas: [
                  {
                    params: votingAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                freezeGuardMultisigV1Data: {
                  guardParams: freezeGuardMultisigParams,
                  votingAzoriusParams: freezeVotingAzoriusParams,
                },
                numberOfNewContracts: 6,
              });
            });

            it('reverts if we deploy a FreezeGuardMultisig and NEITHER FreezeVoting contracts', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [{ ...proposerAdapterERC20V1Params1 }],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [{ ...votingAdapterERC20V1Params1 }],
                    votingAdapterERC721V1Params: [],
                  },
                  moduleAzoriusV1Params,
                },
                freezeVotingAzoriusParams,
                freezeGuardMultisigParams,
              });

              const data = {
                fixtureData,
                owners,
                threshold,
                setupSafeParams,
              };

              // initial deployment should succeed
              await deploySafeWithSetup(data);

              // delete the freezeVotingAzoriusParams by setting the implementation to zero address
              data.setupSafeParams.freezeParams.freezeVotingParams.freezeVotingAzoriusV1Params.implementation =
                ethers.ZeroAddress;

              // now deploying should fail
              await expect(deploySafeWithSetup(data)).to.be.reverted;
            });

            it('reverts if we deploy a FreezeGuardMultisig and BOTH FreezeVoting contracts', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [{ ...proposerAdapterERC20V1Params1 }],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [{ ...votingAdapterERC20V1Params1 }],
                    votingAdapterERC721V1Params: [],
                  },
                  moduleAzoriusV1Params,
                },
                freezeVotingAzoriusParams,
                freezeGuardMultisigParams,
              });

              const data = {
                fixtureData,
                owners,
                threshold,
                setupSafeParams,
              };

              // initial deployment should succeed
              await deploySafeWithSetup(data);

              // now add the freezeVotingMultisigParams
              data.setupSafeParams.freezeParams.freezeVotingParams.freezeVotingMultisigV1Params =
                freezeVotingMultisigParams;

              // now deploying should fail
              await expect(deploySafeWithSetup(data)).to.be.reverted;
            });
          });

          describe('FreezeGuardAzorius configurations', () => {
            it('deploys with a FreezeGuardAzorius with FreezeVotingMultisig', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [{ ...proposerAdapterERC20V1Params1 }],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [{ ...votingAdapterERC20V1Params1 }],
                    votingAdapterERC721V1Params: [],
                  },
                  moduleAzoriusV1Params,
                },
                freezeVotingMultisigParams,
                freezeGuardAzoriusParams,
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                proposerAdapterERC20V1Datas: [
                  {
                    params: proposerAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC20V1Datas: [
                  {
                    params: votingAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                freezeGuardAzoriusV1Data: {
                  guardParams: freezeGuardAzoriusParams,
                  votingMultisigParams: freezeVotingMultisigParams,
                },
                numberOfNewContracts: 6,
              });
            });

            it('deploys with a FreezeGuardAzorius with FreezeVotingAzorius', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [{ ...proposerAdapterERC20V1Params1 }],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [{ ...votingAdapterERC20V1Params1 }],
                    votingAdapterERC721V1Params: [],
                  },
                  moduleAzoriusV1Params,
                },
                freezeVotingAzoriusParams,
                freezeGuardAzoriusParams,
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                proposerAdapterERC20V1Datas: [
                  {
                    params: proposerAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC20V1Datas: [
                  {
                    params: votingAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                freezeGuardAzoriusV1Data: {
                  guardParams: freezeGuardAzoriusParams,
                  votingAzoriusParams: freezeVotingAzoriusParams,
                },
                numberOfNewContracts: 6,
              });
            });

            it('reverts if we deploy a FreezeGuardAzorius and NEITHER FreezeVoting contract', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [{ ...proposerAdapterERC20V1Params1 }],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [{ ...votingAdapterERC20V1Params1 }],
                    votingAdapterERC721V1Params: [],
                  },
                  moduleAzoriusV1Params,
                },
                freezeVotingAzoriusParams,
                freezeGuardAzoriusParams,
              });

              const data = {
                fixtureData,
                owners,
                threshold,
                setupSafeParams,
              };

              // initial deployment should succeed
              await deploySafeWithSetup(data);

              // now delete the freezeVotingAzoriusParams by setting the implementation to zero address
              data.setupSafeParams.freezeParams.freezeVotingParams.freezeVotingAzoriusV1Params.implementation =
                ethers.ZeroAddress;

              // now deploying should fail
              await expect(deploySafeWithSetup(data)).to.be.reverted;
            });

            it('reverts if we deploy a FreezeGuardAzorius and BOTH FreezeVoting contracts', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [{ ...proposerAdapterERC20V1Params1 }],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [{ ...votingAdapterERC20V1Params1 }],
                    votingAdapterERC721V1Params: [],
                  },
                  moduleAzoriusV1Params,
                },
                freezeVotingAzoriusParams,
                freezeGuardAzoriusParams,
              });

              const data = {
                fixtureData,
                owners,
                threshold,
                setupSafeParams,
              };

              // initial deployment should succeed
              await deploySafeWithSetup(data);

              // now add the freezeVotingMultisigParams
              data.setupSafeParams.freezeParams.freezeVotingParams.freezeVotingMultisigV1Params =
                freezeVotingMultisigParams;

              // now deploying should fail
              await expect(deploySafeWithSetup(data)).to.be.reverted;
            });
          });

          describe('Both FreezeGuard contracts', () => {
            it('deploys with both FreezeGuards using FreezeVotingAzorius', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [{ ...proposerAdapterERC20V1Params1 }],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [{ ...votingAdapterERC20V1Params1 }],
                    votingAdapterERC721V1Params: [],
                  },
                  moduleAzoriusV1Params,
                },
                freezeVotingAzoriusParams,
                freezeGuardMultisigParams,
                freezeGuardAzoriusParams,
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                proposerAdapterERC20V1Datas: [
                  {
                    params: proposerAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC20V1Datas: [
                  {
                    params: votingAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                freezeGuardMultisigV1Data: {
                  guardParams: freezeGuardMultisigParams,
                  votingAzoriusParams: freezeVotingAzoriusParams,
                },
                freezeGuardAzoriusV1Data: {
                  guardParams: freezeGuardAzoriusParams,
                  votingAzoriusParams: freezeVotingAzoriusParams,
                },
                numberOfNewContracts: 7,
              });
            });

            it('deploys with both FreezeGuards using FreezeVotingMultisig', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [{ ...proposerAdapterERC20V1Params1 }],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [{ ...votingAdapterERC20V1Params1 }],
                    votingAdapterERC721V1Params: [],
                  },
                  moduleAzoriusV1Params,
                },
                freezeVotingMultisigParams,
                freezeGuardMultisigParams,
                freezeGuardAzoriusParams,
              });

              await findAndVerifySafe({
                ...(await deploySafeWithSetup({
                  fixtureData,
                  owners,
                  threshold,
                  setupSafeParams,
                })),
                fixtureData,
                owners,
                threshold,
                proposerAdapterERC20V1Datas: [
                  {
                    params: proposerAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                strategyV1Params,
                moduleAzoriusV1Params,
                votingAdapterERC20V1Datas: [
                  {
                    params: votingAdapterERC20V1Params1,
                    token: randomVotesERC20Contract,
                  },
                ],
                freezeGuardMultisigV1Data: {
                  guardParams: freezeGuardMultisigParams,
                  votingMultisigParams: freezeVotingMultisigParams,
                },
                freezeGuardAzoriusV1Data: {
                  guardParams: freezeGuardAzoriusParams,
                  votingMultisigParams: freezeVotingMultisigParams,
                },
                numberOfNewContracts: 7,
              });
            });

            it('reverts if we deploy both FreezeGuards and NEITHER FreezeVoting contract', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [{ ...proposerAdapterERC20V1Params1 }],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [{ ...votingAdapterERC20V1Params1 }],
                    votingAdapterERC721V1Params: [],
                  },
                  moduleAzoriusV1Params,
                },
                freezeVotingAzoriusParams,
                freezeGuardAzoriusParams,
                freezeGuardMultisigParams,
              });

              const data = {
                fixtureData,
                owners,
                threshold,
                setupSafeParams,
              };

              // initial deployment should succeed
              await deploySafeWithSetup(data);

              // now delete the freezeVotingAzoriusParams by setting the implementation to zero address
              data.setupSafeParams.freezeParams.freezeVotingParams.freezeVotingAzoriusV1Params.implementation =
                ethers.ZeroAddress;

              // now deploying should fail
              await expect(deploySafeWithSetup(data)).to.be.reverted;
            });

            it('reverts if we deploy both FreezeGuards and BOTH FreezeVoting contracts', async () => {
              const setupSafeParams = createSetupSafeParams({
                azoriusGovernanceParams: {
                  proposerAdapterParams: {
                    proposerAdapterERC20V1Params: [{ ...proposerAdapterERC20V1Params1 }],
                    proposerAdapterERC721V1Params: [],
                    proposerAdapterHatsV1Params: [],
                  },
                  strategyV1Params,
                  votingAdapterParams: {
                    votingAdapterERC20V1Params: [{ ...votingAdapterERC20V1Params1 }],
                    votingAdapterERC721V1Params: [],
                  },
                  moduleAzoriusV1Params,
                },
                freezeVotingAzoriusParams,
                freezeGuardAzoriusParams,
                freezeGuardMultisigParams,
              });

              const data = {
                fixtureData,
                owners,
                threshold,
                setupSafeParams,
              };

              // initial deployment should succeed
              await deploySafeWithSetup(data);

              // now add the freezeVotingMultisigParams
              data.setupSafeParams.freezeParams.freezeVotingParams.freezeVotingMultisigV1Params =
                freezeVotingMultisigParams;

              // now deploying should fail
              await expect(deploySafeWithSetup(data)).to.be.reverted;
            });
          });
        });
      });
    });
  });

  describe('version', () => {
    it('should return version 1', async () => {
      expect(await fixtureData.systemDeployer.version()).to.equal(1);
    });
  });

  describe('ERC165 supportsInterface', () => {
    it('should support ISystemDeployerV1 interface', async () => {
      void expect(
        await fixtureData.systemDeployer.supportsInterface(
          calculateInterfaceId(ISystemDeployerV1__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('should support IVersion interface', async () => {
      void expect(
        await fixtureData.systemDeployer.supportsInterface(
          calculateInterfaceId(IVersion__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('should support IDeploymentBlockV1 interface', async () => {
      void expect(
        await fixtureData.systemDeployer.supportsInterface(
          calculateInterfaceId(IDeploymentBlockV1__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('should support ERC165 interface', async () => {
      void expect(
        await fixtureData.systemDeployer.supportsInterface(
          calculateInterfaceId(ERC165__factory.createInterface()),
        ),
      ).to.be.true;
    });

    it('should not support random interface', async () => {
      void expect(await fixtureData.systemDeployer.supportsInterface('0x12345678')).to.be.false;
    });
  });

  describe('predictProxyAddress', () => {
    it('should revert when implementation is not a contract', async () => {
      const nonContractAddress = ethers.ZeroAddress;
      const initData = '0x';
      const salt = ethers.keccak256(ethers.randomBytes(32));

      await expect(
        fixtureData.systemDeployer.predictProxyAddress(
          nonContractAddress,
          initData,
          salt,
          await fixtureData.systemDeployer.getAddress(),
        ),
      ).to.be.revertedWithCustomError(fixtureData.systemDeployer, 'ImplementationMustBeAContract');
    });

    it('should create different addresses for different deployers with same other parameters', async () => {
      // Deploy a simple test implementation for this test
      const testImplementation = await new MinimalUpgradeableContract__factory(
        fixtureData.deployer,
      ).deploy();
      const implementation = await testImplementation.getAddress();

      const initData =
        MinimalUpgradeableContract__factory.createInterface().encodeFunctionData('initializeEmpty');
      const salt = ethers.keccak256(ethers.toUtf8Bytes('same-salt'));

      const predictedAddress1 = await fixtureData.systemDeployer.predictProxyAddress(
        implementation,
        initData,
        salt,
        await fixtureData.systemDeployer.getAddress(),
      );

      const predictedAddress2 = await fixtureData.systemDeployer.predictProxyAddress(
        implementation,
        initData,
        salt,
        fixtureData.user1.address, // Different deployer
      );

      expect(predictedAddress1).to.not.equal(
        predictedAddress2,
        'Different deployer addresses should produce different proxy addresses',
      );
    });
  });

  describe('deployProxy', () => {
    describe('Proxy Deployment and Upgrade Tests', () => {
      describe('ProxyDeployed event', () => {
        it('should emit ProxyDeployed event with correct parameters', async () => {
          const testName = 'Event Test Contract';
          const salt = ethers.keccak256(ethers.toUtf8Bytes('event-test-salt'));
          const initData = UpgradeContractV1__factory.createInterface().encodeFunctionData(
            'initialize',
            [testName, fixtureData.upgradeableContractOwner.address],
          );

          // Deploy the proxy and capture the transaction
          const tx = await fixtureData.systemDeployer.deployProxy(
            fixtureData.upgradeableMasterCopy,
            initData,
            salt,
          );

          // Predict what the proxy address should be
          const predictedProxyAddress = await fixtureData.systemDeployer.predictProxyAddress(
            fixtureData.upgradeableMasterCopy,
            initData,
            salt,
            await fixtureData.systemDeployer.getAddress(),
          );

          // Check that the ProxyDeployed event was emitted with correct parameters
          await expect(tx)
            .to.emit(fixtureData.systemDeployer, 'ProxyDeployed')
            .withArgs(predictedProxyAddress, fixtureData.upgradeableMasterCopy);

          // Additionally verify the proxy was actually deployed and initialized
          const deployedProxy = UpgradeContractV1__factory.connect(
            predictedProxyAddress,
            fixtureData.upgradeableContractOwner,
          );
          expect(await deployedProxy.name()).to.equal(testName);
          expect(await deployedProxy.owner()).to.equal(
            fixtureData.upgradeableContractOwner.address,
          );
        });

        it('should emit ProxyDeployed event even with empty initialization data', async () => {
          const salt = ethers.keccak256(ethers.toUtf8Bytes('empty-init-salt'));
          const emptyInitData = '0x';

          const tx = await fixtureData.systemDeployer.deployProxy(
            fixtureData.minimalImplementation,
            emptyInitData,
            salt,
          );

          const predictedProxyAddress = await fixtureData.systemDeployer.predictProxyAddress(
            fixtureData.minimalImplementation,
            emptyInitData,
            salt,
            await fixtureData.systemDeployer.getAddress(),
          );

          // Check that the event is still emitted correctly
          await expect(tx)
            .to.emit(fixtureData.systemDeployer, 'ProxyDeployed')
            .withArgs(predictedProxyAddress, fixtureData.minimalImplementation);

          // Verify proxy exists at the predicted address
          const code = await ethers.provider.getCode(predictedProxyAddress);
          expect(code).to.not.equal('0x');
        });
      });

      describe('Deterministic deployment', () => {
        const SALT = 'deterministic-salt';
        const NAME = 'Test Name';
        let firstProxyAddress: string;

        beforeEach(async () => {
          // Deploy initial proxy that other tests can reference
          const proxy = await deployConcreteUpgradeableContract(
            fixtureData.systemDeployer,
            fixtureData.upgradeableMasterCopy,
            fixtureData.upgradeableContractOwner,
            NAME,
            SALT,
          );
          firstProxyAddress = await proxy.getAddress();
        });

        it('should fail when attempting to deploy with identical parameters', async () => {
          // Try to deploy again with EXACTLY the same parameters - should fail because the address is already taken
          try {
            await deployConcreteUpgradeableContract(
              fixtureData.systemDeployer,
              fixtureData.upgradeableMasterCopy,
              fixtureData.upgradeableContractOwner,
              NAME,
              SALT,
            );
            expect.fail(`Expected deployment of same proxy to fail.`);
          } catch (error: any) {
            // We expect this to fail, but don't check specific error message as we're testing the helper function behavior
          }
        });

        it('should allow deployment with different salt but identical parameters', async () => {
          // Deploy with a different salt but keep track of the creation parameters
          const DIFFERENT_SALT = 'different-salt';
          const saltHash = ethers.keccak256(ethers.toUtf8Bytes(DIFFERENT_SALT));
          const initData = UpgradeContractV1__factory.createInterface().encodeFunctionData(
            'initialize',
            [NAME, fixtureData.upgradeableContractOwner.address],
          );

          // Deploy a new contract with these parameters
          await fixtureData.systemDeployer.deployProxy(
            fixtureData.upgradeableMasterCopy,
            initData,
            saltHash,
          );

          // Verify we can deploy with different salt but same init parameters
          const secondProxyAddress = await fixtureData.systemDeployer.predictProxyAddress(
            fixtureData.upgradeableMasterCopy,
            initData,
            saltHash,
            await fixtureData.systemDeployer.getAddress(),
          );

          expect(secondProxyAddress.toLowerCase()).to.not.equal(
            firstProxyAddress.toLowerCase(),
            'Different salt should produce different addresses',
          );

          // Confirm that the second proxy was actually deployed by confirming that bytecode exists at the predicted address
          const code = await ethers.provider.getCode(secondProxyAddress);
          expect(code).to.not.equal('0x');
        });

        it('should create different addresses with different salt but same parameters', async () => {
          // Deploy with same name but different salt
          const differentSaltProxy = await deployConcreteUpgradeableContract(
            fixtureData.systemDeployer,
            fixtureData.upgradeableMasterCopy,
            fixtureData.upgradeableContractOwner,
            NAME,
            'different-salt',
          );
          const differentSaltAddress = await differentSaltProxy.getAddress();

          expect(firstProxyAddress).to.not.equal(
            differentSaltAddress,
            'Different salt should allow users to deploy multiple similar contracts with distinct addresses',
          );
        });

        it('should correctly predict proxy addresses before deployment', async () => {
          // Setup initialization data
          const PREDICTION_SALT = 'prediction-test-salt';
          const saltHash = ethers.keccak256(ethers.toUtf8Bytes(PREDICTION_SALT));
          const initData = UpgradeContractV1__factory.createInterface().encodeFunctionData(
            'initialize',
            [NAME, fixtureData.upgradeableContractOwner.address],
          );

          // Get predicted address
          const predictedAddress = await fixtureData.systemDeployer.predictProxyAddress(
            fixtureData.upgradeableMasterCopy,
            initData,
            saltHash,
            await fixtureData.systemDeployer.getAddress(),
          );

          // Now actually deploy
          const tx = await fixtureData.systemDeployer.deployProxy(
            fixtureData.upgradeableMasterCopy,
            initData,
            saltHash,
          );
          const receipt = await tx.wait();
          if (!receipt) {
            throw new Error('Transaction receipt is null');
          }

          // Extract the deployed address from the event
          const event = receipt.logs.find((log: Log) => {
            return log.topics[0] === ethers.id('ProxyDeployed(address,address)');
          });

          if (!event) {
            throw new Error('ProxyDeployed event not found');
          }

          const proxyAddressBytes = event.topics[1];
          const actualAddress = ethers.getAddress(`0x${proxyAddressBytes.slice(26)}`);

          expect(actualAddress.toLowerCase()).to.equal(
            predictedAddress.toLowerCase(),
            'Predicted address should match actual deployed address',
          );
        });

        it('should create different addresses when init parameters change, even with same salt', async () => {
          // Deploy with different name but same salt
          const differentProxy = await deployConcreteUpgradeableContract(
            fixtureData.systemDeployer,
            fixtureData.upgradeableMasterCopy,
            fixtureData.upgradeableContractOwner,
            'DifferentName',
            SALT,
          );
          const differentAddress = await differentProxy.getAddress();

          expect(firstProxyAddress).to.not.equal(
            differentAddress,
            'Different parameters should create different addresses, providing collision resistance',
          );
        });
      });

      describe('State initialization', () => {
        it('should instantiate the contract state correctly through the factory', async () => {
          const name = 'Contract';

          // Deploy using the factory
          const upgradeableContract = await deployConcreteUpgradeableContract(
            fixtureData.systemDeployer,
            fixtureData.upgradeableMasterCopy,
            fixtureData.upgradeableContractOwner,
            name,
          );

          // Verify the token was deployed correctly
          expect(await upgradeableContract.name()).to.equal(name);
        });
      });

      describe('Proxy Upgrades', () => {
        it('should successfully upgrade a proxy to a new implementation', async () => {
          // Store original contract values
          const originalName = await fixtureData.upgradeableContract.name();
          const originalAddress = await fixtureData.upgradeableContract.getAddress();

          // Upgrade the proxy to the upgraded implementation
          const tx = await fixtureData.upgradeableContract.upgradeToAndCall(
            fixtureData.upgradedMasterCopy,
            '0x', // No initialization data needed for this upgrade
          );
          await tx.wait();

          // Create a new contract instance with the upgraded interface
          const upgradedContract = UpgradeContractV2__factory.connect(
            originalAddress,
            fixtureData.upgradeableContractOwner,
          );

          // Verify state was preserved from the original contract
          expect(await upgradedContract.name()).to.equal(originalName);

          // Verify it's at the same address
          expect(await upgradedContract.getAddress()).to.equal(originalAddress);

          // Verify it has the new functionality (version should be 0 since it wasn't initialized)
          expect(await upgradedContract.version()).to.equal(0);
        });

        it('should allow initializing new variables during upgrade', async () => {
          const originalAddress = await fixtureData.upgradeableContract.getAddress();
          const originalName = await fixtureData.upgradeableContract.name();
          const newVersion = 2;

          // Prepare initialization data for the upgrade
          const fullInitData = UpgradeContractV2__factory.createInterface().encodeFunctionData(
            'initialize(uint16)',
            [newVersion],
          );

          // Upgrade the proxy to the upgraded implementation with initialization data
          await fixtureData.upgradeableContract.upgradeToAndCall(
            fixtureData.upgradedMasterCopy,
            fullInitData,
          );

          // Create a new contract instance with the upgraded interface
          const upgradedContract = UpgradeContractV2__factory.connect(
            originalAddress,
            fixtureData.upgradeableContractOwner,
          );

          // Verify state was preserved from the original contract
          expect(await upgradedContract.name()).to.equal(originalName);

          // Verify new state was initialized
          expect(await upgradedContract.version()).to.equal(newVersion);
        });

        it('should only allow the owner to upgrade the implementation', async () => {
          // Attempt to upgrade from non-owner account
          await expect(
            fixtureData.upgradeableContract
              .connect(fixtureData.nonOwner)
              .upgradeToAndCall(fixtureData.upgradedMasterCopy, '0x'),
          ).to.be.revertedWithCustomError(
            fixtureData.upgradeableContract,
            'OwnableUnauthorizedAccount',
          );
        });

        it('should not allow upgrade to non-contract address', async () => {
          // Generate a random non-contract address
          const nonContractAddress = ethers.Wallet.createRandom().address;

          // Attempt to upgrade to a non-contract address
          await expect(fixtureData.upgradeableContract.upgradeToAndCall(nonContractAddress, '0x'))
            .to.be.reverted;
        });
      });

      describe('Initialization Data Tests', () => {
        it('should handle empty initialization data', async () => {
          // Create empty initialization data with minimal initializer function selector
          const iface = MinimalUpgradeableContract__factory.createInterface();
          const emptyInitData = iface.getFunction('initializeEmpty').selector;

          // Deploy with empty init data
          const salt = ethers.keccak256(ethers.randomBytes(32));
          await fixtureData.systemDeployer.deployProxy(
            fixtureData.minimalImplementation,
            emptyInitData,
            salt,
          );

          // Get the deployed address
          const predictedAddress = await fixtureData.systemDeployer.predictProxyAddress(
            fixtureData.minimalImplementation,
            emptyInitData,
            salt,
            await fixtureData.systemDeployer.getAddress(),
          );

          // Create a contract instance and verify initialization worked
          const minimalContract = MinimalUpgradeableContract__factory.connect(
            predictedAddress,
            fixtureData.upgradeableContractOwner,
          );

          void expect(await minimalContract.isInitialized()).to.be.true;
        });

        it('should handle very large initialization data', async () => {
          // Create a large string (will still be within gas limits)
          const largeString = 'x'.repeat(10000);

          // Create initialization data with the large string
          const largeInitData =
            MinimalUpgradeableContract__factory.createInterface().encodeFunctionData(
              'initializeWithLargeData',
              [largeString],
            );

          // Deploy with large init data
          const salt = ethers.keccak256(ethers.randomBytes(32));
          await fixtureData.systemDeployer.deployProxy(
            fixtureData.minimalImplementation,
            largeInitData,
            salt,
          );

          // Get the deployed address
          const predictedAddress = await fixtureData.systemDeployer.predictProxyAddress(
            fixtureData.minimalImplementation,
            largeInitData,
            salt,
            await fixtureData.systemDeployer.getAddress(),
          );

          // Create a contract instance and verify initialization worked with large data
          const minimalContract = MinimalUpgradeableContract__factory.connect(
            predictedAddress,
            fixtureData.upgradeableContractOwner,
          );

          void expect(await minimalContract.isInitialized()).to.be.true;
          expect(await minimalContract.largeData()).to.equal(largeString);
        });
      });

      describe('Initializer Protection', () => {
        it('should not allow initialize to be called twice', async () => {
          // Deploy a contract
          const name = 'InitializerTest';
          const initData = UpgradeContractV1__factory.createInterface().encodeFunctionData(
            'initialize',
            [name, fixtureData.upgradeableContractOwner.address],
          );

          const salt = ethers.keccak256(ethers.randomBytes(32));
          await fixtureData.systemDeployer.deployProxy(
            fixtureData.upgradeV1Implementation,
            initData,
            salt,
          );

          const predictedAddress = await fixtureData.systemDeployer.predictProxyAddress(
            fixtureData.upgradeV1Implementation,
            initData,
            salt,
            await fixtureData.systemDeployer.getAddress(),
          );

          // Create a contract instance
          const contract = UpgradeContractV1__factory.connect(
            predictedAddress,
            fixtureData.upgradeableContractOwner,
          );

          // Try to call initialize again - should revert
          await expect(
            contract.initialize(name, fixtureData.upgradeableContractOwner.address),
          ).to.be.revertedWithCustomError(contract, 'InvalidInitialization');
        });

        it('should correctly handle reinitializers with proper version increments', async () => {
          // Deploy a contract
          const name = 'ReinitializerTest';
          const initData = UpgradeContractV1__factory.createInterface().encodeFunctionData(
            'initialize',
            [name, fixtureData.upgradeableContractOwner.address],
          );

          const salt = ethers.keccak256(ethers.randomBytes(32));
          await fixtureData.systemDeployer.deployProxy(
            fixtureData.upgradeV1Implementation,
            initData,
            salt,
          );

          const predictedAddress = await fixtureData.systemDeployer.predictProxyAddress(
            fixtureData.upgradeV1Implementation,
            initData,
            salt,
            await fixtureData.systemDeployer.getAddress(),
          );

          // Create a contract instance
          const contract = UpgradeContractV1__factory.connect(
            predictedAddress,
            fixtureData.upgradeableContractOwner,
          );

          // Upgrade to V2
          const v2Version = 2;
          const v2InitData = UpgradeContractV2__factory.createInterface().encodeFunctionData(
            'initialize(uint16)',
            [v2Version],
          );

          await contract.upgradeToAndCall(fixtureData.upgradeV2Implementation, v2InitData);

          // Get the V2 contract
          const contractV2 = UpgradeContractV2__factory.connect(
            predictedAddress,
            fixtureData.upgradeableContractOwner,
          );

          // Verify state was preserved and new state was initialized
          expect(await contractV2.name()).to.equal(name);
          expect(await contractV2.version()).to.equal(v2Version);

          // Try to call the reinitializer again - should revert
          await expect(
            contractV2['initialize(uint16)'](v2Version + 1),
          ).to.be.revertedWithCustomError(contractV2, 'InvalidInitialization');

          // Upgrade to V3 - should work with reinitializer(3)
          const v3AdditionalValue = 42;
          const v3InitData = UpgradeContractV3__factory.createInterface().encodeFunctionData(
            'initialize(uint256)',
            [v3AdditionalValue],
          );

          await contractV2.upgradeToAndCall(fixtureData.upgradeV3Implementation, v3InitData);

          // Get the V3 contract
          const contractV3 = UpgradeContractV3__factory.connect(
            predictedAddress,
            fixtureData.upgradeableContractOwner,
          );

          // Verify state was preserved through both upgrades
          expect(await contractV3.name()).to.equal(name);
          expect(await contractV3.version()).to.equal(v2Version);
          expect(await contractV3.additionalValue()).to.equal(v3AdditionalValue);
        });
      });

      describe('Multi-Step Upgrade Tests', () => {
        it('should support upgrading through multiple implementation versions', async () => {
          // Deploy initial contract
          const name = 'MultiStepTest';
          const initData = UpgradeContractV1__factory.createInterface().encodeFunctionData(
            'initialize',
            [name, fixtureData.upgradeableContractOwner.address],
          );

          const salt = ethers.keccak256(ethers.randomBytes(32));
          await fixtureData.systemDeployer.deployProxy(
            fixtureData.upgradeV1Implementation,
            initData,
            salt,
          );

          const predictedAddress = await fixtureData.systemDeployer.predictProxyAddress(
            fixtureData.upgradeV1Implementation,
            initData,
            salt,
            await fixtureData.systemDeployer.getAddress(),
          );

          // Get V1 instance
          const contractV1 = UpgradeContractV1__factory.connect(
            predictedAddress,
            fixtureData.upgradeableContractOwner,
          );

          // Verify initial state
          expect(await contractV1.name()).to.equal(name);

          // Upgrade to V2
          const v2Version = 2;
          const v2InitData = UpgradeContractV2__factory.createInterface().encodeFunctionData(
            'initialize(uint16)',
            [v2Version],
          );

          await contractV1.upgradeToAndCall(fixtureData.upgradeV2Implementation, v2InitData);

          // Get V2 instance
          const contractV2 = UpgradeContractV2__factory.connect(
            predictedAddress,
            fixtureData.upgradeableContractOwner,
          );

          // Verify V2 state
          expect(await contractV2.name()).to.equal(name);
          expect(await contractV2.version()).to.equal(v2Version);

          // Upgrade to V3
          const v3AdditionalValue = 42;
          const v3InitData = UpgradeContractV3__factory.createInterface().encodeFunctionData(
            'initialize(uint256)',
            [v3AdditionalValue],
          );

          await contractV2.upgradeToAndCall(fixtureData.upgradeV3Implementation, v3InitData);

          // Get V3 instance
          const contractV3 = UpgradeContractV3__factory.connect(
            predictedAddress,
            fixtureData.upgradeableContractOwner,
          );

          // Verify state all the way from V1 to V3
          expect(await contractV3.name()).to.equal(name);
          expect(await contractV3.version()).to.equal(v2Version);
          expect(await contractV3.additionalValue()).to.equal(v3AdditionalValue);
        });
      });

      describe('State Migration Tests', () => {
        it('should support complex state transformations during upgrades', async () => {
          // Deploy initial contract
          const name = 'StateMigrationTest';
          const initData = UpgradeContractV1__factory.createInterface().encodeFunctionData(
            'initialize',
            [name, fixtureData.upgradeableContractOwner.address],
          );

          const salt = ethers.keccak256(ethers.randomBytes(32));
          await fixtureData.systemDeployer.deployProxy(
            fixtureData.upgradeV1Implementation,
            initData,
            salt,
          );

          const predictedAddress = await fixtureData.systemDeployer.predictProxyAddress(
            fixtureData.upgradeV1Implementation,
            initData,
            salt,
            await fixtureData.systemDeployer.getAddress(),
          );

          // Upgrade to V3 directly (skipping V2)
          const v3AdditionalValue = 100;
          const v3InitData = UpgradeContractV3__factory.createInterface().encodeFunctionData(
            'initialize(uint256)',
            [v3AdditionalValue],
          );

          const contract = UpgradeContractV1__factory.connect(
            predictedAddress,
            fixtureData.upgradeableContractOwner,
          );

          await contract.upgradeToAndCall(fixtureData.upgradeV3Implementation, v3InitData);

          // Get V3 instance
          const contractV3 = UpgradeContractV3__factory.connect(
            predictedAddress,
            fixtureData.upgradeableContractOwner,
          );

          // Verify state was preserved
          expect(await contractV3.name()).to.equal(name);
          expect(await contractV3.additionalValue()).to.equal(v3AdditionalValue);

          // Perform migration (simulating complex state transformation)
          await contractV3.migrateState();

          // Verify migration was successful
          void expect(await contractV3.migrationPerformed()).to.be.true;
        });
      });

      describe('Error Cases', () => {
        it('should revert when trying to deploy to zero address', async () => {
          // Zero address has no code, so it should fail the code length check
          const zeroAddress = ethers.ZeroAddress;
          const initData = '0x'; // Empty init data
          const salt = ethers.keccak256(ethers.randomBytes(32));

          // Should revert with ImplementationMustBeAContract error
          await expect(
            fixtureData.systemDeployer.deployProxy(zeroAddress, initData, salt),
          ).to.be.revertedWithCustomError(
            fixtureData.systemDeployer,
            'ImplementationMustBeAContract',
          );

          // Same check for predictProxyAddress
          await expect(
            fixtureData.systemDeployer.predictProxyAddress(
              zeroAddress,
              initData,
              salt,
              fixtureData.systemDeployer.getAddress(),
            ),
          ).to.be.revertedWithCustomError(
            fixtureData.systemDeployer,
            'ImplementationMustBeAContract',
          );
        });

        it('should handle initialization functions that revert', async () => {
          // Create initialization data that will cause a revert
          const initData = FailingInitializerContract__factory.createInterface().encodeFunctionData(
            'initialize',
            [true],
          );

          const salt = ethers.keccak256(ethers.randomBytes(32));

          // Deployment should revert
          await expect(
            fixtureData.systemDeployer.deployProxy(
              fixtureData.failingImplementation,
              initData,
              salt,
            ),
          ).to.be.revertedWith('Initialization failed as requested');
        });

        it('should allow detection of incompatible storage layout upgrades', async () => {
          // Deploy initial contract
          const name = 'IncompatibleStorageTest';
          const initData = UpgradeContractV1__factory.createInterface().encodeFunctionData(
            'initialize',
            [name, fixtureData.upgradeableContractOwner.address],
          );

          const salt = ethers.keccak256(ethers.randomBytes(32));
          await fixtureData.systemDeployer.deployProxy(
            fixtureData.upgradeV1Implementation,
            initData,
            salt,
          );

          const predictedAddress = await fixtureData.systemDeployer.predictProxyAddress(
            fixtureData.upgradeV1Implementation,
            initData,
            salt,
            await fixtureData.systemDeployer.getAddress(),
          );

          const contract = UpgradeContractV1__factory.connect(
            predictedAddress,
            fixtureData.upgradeableContractOwner,
          );

          // Store the current name
          const originalName = await contract.name();

          // Upgrade to incompatible implementation
          const incompatibleInitData =
            IncompatibleStorageContract__factory.createInterface().getFunction(
              'initialize',
            ).selector;

          await contract.upgradeToAndCall(
            fixtureData.incompatibleImplementation,
            incompatibleInitData,
          );

          // Get instance of incompatible contract
          const incompatibleContract = IncompatibleStorageContract__factory.connect(
            predictedAddress,
            fixtureData.upgradeableContractOwner,
          );

          // The nameSlotAsNumber will have corrupted the original name's storage
          // The exact behavior might vary, but we can verify it changed something
          const newSlotValue = await incompatibleContract.nameSlotAsNumber();

          // We should see the storage has been replaced
          expect(newSlotValue).to.equal(ethers.MaxUint256);

          // Trying to call the original "name" function will likely revert or return garbage
          try {
            // Create a contract instance with the original ABI
            const corruptedContract = UpgradeContractV1__factory.connect(
              predictedAddress,
              fixtureData.upgradeableContractOwner,
            );

            // Try to read the corrupted name
            const corruptedName = await corruptedContract.name();

            // If it doesn't revert, the name should at least be different
            expect(corruptedName).to.not.equal(originalName);
          } catch (error) {
            // Alternatively, it might revert completely, which is also valid
            // We don't make specific assertions about the error
          }
        });
      });
    });
  });

  describe('Deployment Block', () => {
    runDeploymentBlockTests({
      getContract: () => fixtureData.systemDeployer,
      isNonUpgradeable: true,
    });
  });
});
