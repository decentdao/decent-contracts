import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-etherscan";
import "@openzeppelin/hardhat-upgrades";
import "@nomiclabs/hardhat-waffle";
import "hardhat-deploy";
import "@typechain/hardhat";
import "hardhat-tracer";
import "solidity-coverage";
import "hardhat-dependency-compiler";
declare const config: HardhatUserConfig;
export default config;
