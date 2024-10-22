import hre from 'hardhat';
import {
  GnosisSafeProxyFactory,
  GnosisSafeProxyFactory__factory,
  ModuleProxyFactory,
  ModuleProxyFactory__factory,
  MultiSendCallOnly,
  MultiSendCallOnly__factory,
  GnosisSafeL2,
  GnosisSafeL2__factory,
  MockContract,
  MockContract__factory,
} from '../typechain-types';

let gnosisSafeProxyFactory: GnosisSafeProxyFactory;
let moduleProxyFactory: ModuleProxyFactory;
let gnosisSafeL2Singleton: GnosisSafeL2;
let multiSendCallOnly: MultiSendCallOnly;
let mockContract: MockContract;

beforeEach(async () => {
  const [deployer] = await hre.ethers.getSigners();

  gnosisSafeProxyFactory = await new GnosisSafeProxyFactory__factory(deployer).deploy();
  moduleProxyFactory = await new ModuleProxyFactory__factory(deployer).deploy();
  gnosisSafeL2Singleton = await new GnosisSafeL2__factory(deployer).deploy();
  multiSendCallOnly = await new MultiSendCallOnly__factory(deployer).deploy();
  mockContract = await new MockContract__factory(deployer).deploy();
});

export const getGnosisSafeProxyFactory = (): GnosisSafeProxyFactory => {
  return gnosisSafeProxyFactory;
};

export const getModuleProxyFactory = (): ModuleProxyFactory => {
  return moduleProxyFactory;
};

export const getGnosisSafeL2Singleton = (): GnosisSafeL2 => {
  return gnosisSafeL2Singleton;
};

export const getMultiSendCallOnly = (): MultiSendCallOnly => {
  return multiSendCallOnly;
};

export const getMockContract = (): MockContract => {
  return mockContract;
};
