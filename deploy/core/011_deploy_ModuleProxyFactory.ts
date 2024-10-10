// import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
// import { deployNonUpgradeable } from "../helpers/deployNonUpgradeable";

const func: DeployFunction = async (/* hre: HardhatRuntimeEnvironment */) => {
  // No longer deploying ModuleProxyFactory to any new networks..
  // This contract is deployed by the Zodiac team.
  // await deployNonUpgradeable(hre, "ModuleProxyFactory", []);
};

export default func;
