import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployNonUpgradeable } from "../helpers/deployNonUpgradeable";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  await deployNonUpgradeable(hre, "FractalUsul", [
    "0x0000000000000000000000000000000000000001",
    "0x0000000000000000000000000000000000000001",
    "0x0000000000000000000000000000000000000001",
    ["0x0000000000000000000000000000000000000002"],
  ]);
};

func.tags = ["usul"];

export default func;
