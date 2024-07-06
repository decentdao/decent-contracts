import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployNonUpgradeable } from "../helpers/deployNonUpgradeable";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const chainId = await hre.getChainId();
  if (chainId === "84532") {
    console.log(`Skipping DecentHats deployment on chain ${chainId}`);
    return;
  }

  const keyValuePairs = await hre.deployments.get("KeyValuePairs");

  const hatsAddress = "0x3bc1A0Ad72417f2d411118085256fC53CBdDd137";
  const hatsAccountImplementationAddress =
    "0xfEf83A660b7C10a3EdaFdCF62DEee1fD8a875D29";
  const erc6551RegistryAddress = "0x000000006551c19487814612e58FE06813775758";

  await deployNonUpgradeable(hre, "DecentHats", [
    hatsAddress,
    hatsAccountImplementationAddress,
    erc6551RegistryAddress,
    keyValuePairs.address,
  ]);
};

export default func;
