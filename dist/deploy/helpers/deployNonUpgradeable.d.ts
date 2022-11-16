import { HardhatRuntimeEnvironment } from "hardhat/types";
declare const deployNonUpgradeable: (hre: HardhatRuntimeEnvironment, contractName: string, args?: any[]) => Promise<void>;
export { deployNonUpgradeable };
