import * as dotenv from 'dotenv';
import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import 'hardhat-dependency-compiler';
import 'hardhat-deploy';
import 'solidity-docgen';

dotenv.config();

// first address from `test test test test test test test test test test test junk`
const dummyPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: '0.8.19',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: '0.8.28',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  dependencyCompiler: {
    paths: [
      '@gnosis.pm/safe-contracts/contracts/libraries/MultiSendCallOnly.sol',
      '@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol',
      '@gnosis.pm/safe-contracts/contracts/GnosisSafeL2.sol',
      '@gnosis.pm/zodiac/contracts/factory/ModuleProxyFactory.sol',
    ],
  },
  namedAccounts: {
    deployer: {
      default: 0,
      mainnet: `privatekey://${process.env.MAINNET_DEPLOYER_PRIVATE_KEY}`,
      sepolia: `privatekey://${process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY}`,
      polygon: `privatekey://${process.env.POLYGON_DEPLOYER_PRIVATE_KEY}`,
      base: `privatekey://${process.env.BASE_DEPLOYER_PRIVATE_KEY}`,
      optimism: `privatekey://${process.env.OPTIMISM_DEPLOYER_PRIVATE_KEY}`,
    },
  },
  networks: {
    mainnet: {
      chainId: 1,
      url: process.env.MAINNET_PROVIDER || 'https://ethereum-rpc.publicnode.com',
      accounts: process.env.MAINNET_DEPLOYER_PRIVATE_KEY
        ? [process.env.MAINNET_DEPLOYER_PRIVATE_KEY]
        : [dummyPrivateKey],
    },
    sepolia: {
      chainId: 11155111,
      url: process.env.SEPOLIA_PROVIDER || 'https://ethereum-sepolia-rpc.publicnode.com',
      accounts: process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY
        ? [process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY]
        : [dummyPrivateKey],
    },
    polygon: {
      chainId: 137,
      url: process.env.POLYGON_PROVIDER || 'https://polygon-bor-rpc.publicnode.com',
      accounts: process.env.POLYGON_DEPLOYER_PRIVATE_KEY
        ? [process.env.POLYGON_DEPLOYER_PRIVATE_KEY]
        : [dummyPrivateKey],
    },
    base: {
      chainId: 8453,
      url: process.env.BASE_PROVIDER || 'https://base-rpc.publicnode.com',
      accounts: process.env.BASE_DEPLOYER_PRIVATE_KEY
        ? [process.env.BASE_DEPLOYER_PRIVATE_KEY]
        : [dummyPrivateKey],
    },
    optimism: {
      chainId: 10,
      url: process.env.OPTIMISM_PROVIDER || 'https://optimism-rpc.publicnode.com',
      accounts: process.env.OPTIMISM_DEPLOYER_PRIVATE_KEY
        ? [process.env.OPTIMISM_DEPLOYER_PRIVATE_KEY]
        : [dummyPrivateKey],
    },
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY || '',
      sepolia: process.env.ETHERSCAN_API_KEY || '',
      polygon: process.env.POLYGONSCAN_API_KEY || '',
      base: process.env.BASESCAN_API_KEY || '',
      optimisticEthereum: process.env.OPTIMISTIC_ETHERSCAN_API_KEY || '',
    },
  },
  sourcify: {
    enabled: true,
  },
  paths: {
    deploy: 'deploy/core',
  },
  docgen: {
    pages: 'files',
  },
};

export default config;
