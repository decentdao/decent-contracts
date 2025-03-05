import { getNamedAccounts } from 'hardhat';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await getNamedAccounts();

  const entrypointAddress = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

  await hre.deployments.deploy('DecentPaymasterV1Factory', {
    from: deployer,
    args: [entrypointAddress],
    log: true,
    gasLimit: 6e6,
    deterministicDeployment: true,
  });
};

func.tags = ['DecentPaymasterV1Factory'];

export default func;
