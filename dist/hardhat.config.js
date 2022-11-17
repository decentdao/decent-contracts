"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
const config_1 = require("hardhat/config");
require("@nomiclabs/hardhat-etherscan");
require("@openzeppelin/hardhat-upgrades");
require("@nomiclabs/hardhat-waffle");
require("hardhat-deploy");
require("@typechain/hardhat");
require("hardhat-tracer");
require("solidity-coverage");
require("hardhat-dependency-compiler");
dotenv.config();
// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
(0, config_1.task)("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
    const accounts = await hre.ethers.getSigners();
    for (const account of accounts) {
        console.log(account.address);
    }
});
// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more
const config = {
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
            url: process.env.MAINNET_PROVIDER,
            accounts: [process.env.MAINNET_DEPLOYER_PRIVATE_KEY || ""],
        },
        goerli: {
            chainId: 5,
            url: process.env.GOERLI_PROVIDER,
            accounts: [process.env.GOERLI_DEPLOYER_PRIVATE_KEY || ""],
        },
        rinkeby: {
            chainId: 4,
            url: process.env.RINKEBY_PROVIDER,
            accounts: [process.env.RINKEBY_DEPLOYER_PRIVATE_KEY || ""],
        },
        sepolia: {
            chainId: 11155111,
            url: process.env.SEPOLIA_PROVIDER,
            accounts: [process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY || ""],
        },
        hardhat: {
            forking: {
                url: process.env.GOERLI_PROVIDER ? process.env.GOERLI_PROVIDER : "",
                blockNumber: 7387621,
            },
        },
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY,
    },
    paths: {
        deploy: "deploy/core",
    },
};
exports.default = config;
