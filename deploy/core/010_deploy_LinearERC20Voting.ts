import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { deployNonUpgradeable } from '../helpers/deployNonUpgradeable';

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const chainId = await hre.getChainId();

  // See https://github.com/decentdao/decent-contracts/pull/96
  if (chainId === '1' || chainId === '137') {
    return;
  }

  await deployNonUpgradeable(hre, 'LinearERC20Voting', []);
};

export default func;
