import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-dependency-compiler";
import "hardhat-deploy";
import "solidity-docgen";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  dependencyCompiler: {
    paths: [
      "@gnosis.pm/safe-contracts/contracts/libraries/MultiSendCallOnly.sol",
      "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol",
      "@gnosis.pm/safe-contracts/contracts/GnosisSafeL2.sol",
      "@gnosis.pm/zodiac/contracts/factory/ModuleProxyFactory.sol",
    ],
  },
  namedAccounts: {
    deployer: {
      default: 0,
      mainnet: `privatekey://${process.env.MAINNET_DEPLOYER_PRIVATE_KEY}`,
      sepolia: `privatekey://${process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY}`,
      polygon: `privatekey://${process.env.POLYGON_DEPLOYER_PRIVATE_KEY}`,
      baseSepolia: `privatekey://${process.env.BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY}`,
      base: `privatekey://${process.env.BASE_DEPLOYER_PRIVATE_KEY}`,
      optimism: `privatekey://${process.env.OPTIMISM_DEPLOYER_PRIVATE_KEY}`,
    },
  },
  networks: {
    mainnet: {
      chainId: 1,
      url: process.env.MAINNET_PROVIDER || "",
      accounts: process.env.MAINNET_DEPLOYER_PRIVATE_KEY
        ? [process.env.MAINNET_DEPLOYER_PRIVATE_KEY]
        : [],
    },
    sepolia: {
      chainId: 11155111,
      url: process.env.SEPOLIA_PROVIDER || "",
      accounts: process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY
        ? [process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY]
        : [],
    },
    polygon: {
      chainId: 137,
      url: process.env.POLYGON_PROVIDER || "",
      accounts: process.env.POLYGON_DEPLOYER_PRIVATE_KEY
        ? [process.env.POLYGON_DEPLOYER_PRIVATE_KEY]
        : [],
    },
    baseSepolia: {
      chainId: 84532,
      url: process.env.BASE_SEPOLIA_PROVIDER || "",
      accounts: process.env.BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY
        ? [process.env.BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY]
        : [],
    },
    base: {
      chainId: 8453,
      url: process.env.BASE_PROVIDER || "",
      accounts: process.env.BASE_DEPLOYER_PRIVATE_KEY
        ? [process.env.BASE_DEPLOYER_PRIVATE_KEY]
        : [],
    },
    optimism: {
      chainId: 10,
      url: process.env.OPTIMISM_PROVIDER || "",
      accounts: process.env.OPTIMISM_DEPLOYER_PRIVATE_KEY
        ? [process.env.OPTIMISM_DEPLOYER_PRIVATE_KEY]
        : [],
    },
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY || "",
      sepolia: process.env.ETHERSCAN_API_KEY || "",
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      baseSepolia: process.env.BASESCAN_API_KEY || "",
      base: process.env.BASESCAN_API_KEY || "",
      optimism: process.env.OPTIMISTIC_ETHERSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },
  paths: {
    deploy: "deploy/core",
  },
  docgen: {
    pages: "files",
  },
};

export default config;
