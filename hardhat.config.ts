import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-verify';
import { HardhatUserConfig, vars } from 'hardhat/config';
import 'solidity-docgen';

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: '0.8.30',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  networks: {
    sepolia: {
      chainId: 11155111,
      url: vars.get('SEPOLIA_PROVIDER', ''),
      accounts: [
        vars.get(
          'TESTNET_DEPLOYER_PK',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ),
      ],
    },
    mainnet: {
      chainId: 1,
      url: vars.get('MAINNET_PROVIDER', ''),
      accounts: [
        vars.get(
          'FRACTAL_PRODUCTION_DEPLOYER_PK',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ),
      ],
    },
    polygon: {
      chainId: 137,
      url: vars.get('POLYGON_PROVIDER', ''),
      accounts: [
        vars.get(
          'FRACTAL_PRODUCTION_DEPLOYER_PK',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ),
      ],
    },
    base: {
      chainId: 8453,
      url: vars.get('BASE_PROVIDER', ''),
      accounts: [
        vars.get(
          'FRACTAL_PRODUCTION_DEPLOYER_PK',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ),
      ],
    },
    optimism: {
      chainId: 10,
      url: vars.get('OPTIMISM_PROVIDER', ''),
      accounts: [
        vars.get(
          'FRACTAL_PRODUCTION_DEPLOYER_PK',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ),
      ],
    },
  },
  etherscan: {
    apiKey: vars.get('ETHERSCAN_API_KEY', ''),
  },
  sourcify: {
    enabled: false,
  },
  docgen: {
    pages: 'files',
  },
};

export default config;
