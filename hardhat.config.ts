import * as dotenv from "dotenv";
import { HardhatUserConfig, task } from "hardhat/config";
import "@nomiclabs/hardhat-etherscan";
import "@openzeppelin/hardhat-upgrades";
import "@nomiclabs/hardhat-waffle";
import "hardhat-deploy";
import "@typechain/hardhat";
import "hardhat-tracer";
import "solidity-coverage";
import "hardhat-dependency-compiler";
import "hardhat-gas-reporter";

dotenv.config();

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

const hardhatNetworkConfig = process.env.GOERLI_PROVIDER ?
  {
    forking: {
      url: process.env.GOERLI_PROVIDER,
      blockNumber: 7387621,
    },
  } : {};

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.13",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  dependencyCompiler: {
    paths: [
      "@gnosis.pm/zodiac/contracts/factory/ModuleProxyFactory.sol",
      "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol",
      "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol",
      "@tokenwalk/seele/contracts/Usul.sol",
      "@tokenwalk/seele/contracts/votingStrategies/OZLinearVoting.sol",
    ],
  },
  namedAccounts: {
    deployer: {
      default: 0,
      mainnet: `privatekey://${process.env.MAINNET_DEPLOYER_PRIVATE_KEY}`,
      goerli: `privatekey://${process.env.GOERLI_DEPLOYER_PRIVATE_KEY}`,
      rinkeby: `privatekey://${process.env.RINKEBY_DEPLOYER_PRIVATE_KEY}`,
      sepolia: `privatekey://${process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY}`,
    },
  },
  networks: {
    mainnet: {
      chainId: 1,
      url: process.env.MAINNET_PROVIDER || "",
      accounts: process.env.MAINNET_DEPLOYER_PRIVATE_KEY ? [process.env.MAINNET_DEPLOYER_PRIVATE_KEY] : [],
    },
    goerli: {
      chainId: 5,
      url: process.env.GOERLI_PROVIDER || "",
      accounts: process.env.GOERLI_DEPLOYER_PRIVATE_KEY ? [process.env.GOERLI_DEPLOYER_PRIVATE_KEY] : [],
    },
    rinkeby: {
      chainId: 4,
      url: process.env.RINKEBY_PROVIDER || "",
      accounts: process.env.RINKEBY_DEPLOYER_PRIVATE_KEY ? [process.env.RINKEBY_DEPLOYER_PRIVATE_KEY] : [],
    },
    sepolia: {
      chainId: 11155111,
      url: process.env.SEPOLIA_PROVIDER || "",
      accounts: process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY ? [process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY] : [],
    },
    hardhat: hardhatNetworkConfig,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  paths: {
    deploy: "deploy/core",
  },
};

export default config;
