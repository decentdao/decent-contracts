import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { deployNonUpgradeable } from '../helpers/deployNonUpgradeable';

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  await deployNonUpgradeable(hre, 'DecentHats_0_1_0');
};

export default func;
