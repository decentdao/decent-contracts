import { HardhatRuntimeEnvironment } from "hardhat/types";

const deployNonUpgradeable = async (
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[] = []
): Promise<void> => {
  const {
    deployments: { deploy },
    getNamedAccounts,
  } = hre;
  const { deployer } = await getNamedAccounts();

  const config = {
    log: true,
    from: deployer,
    args,
  };

  await deploy(contractName, config);
};

export { deployNonUpgradeable };
