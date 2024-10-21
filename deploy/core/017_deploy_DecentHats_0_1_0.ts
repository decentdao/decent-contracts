// import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
// import { deployNonUpgradeable } from "../helpers/deployNonUpgradeable";

const func: DeployFunction = async (/* hre: HardhatRuntimeEnvironment */) => {
  // No longer deploying DecentHats_0_1_0 to any new networks..
  // This contract has been depreciated.
  // await deployNonUpgradeable(hre, "DecentHats_0_1_0");
}

export default func
