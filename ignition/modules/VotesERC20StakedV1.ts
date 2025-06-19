import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import { VotesERC20StakedV1__factory } from '../../typechain-types';

export default buildModule('VotesERC20StakedV1', m => {

  const votesERC20StakedV1Implementation = m.contract('VotesERC20StakedV1');

  const metadata = {
    name: 'Staked Governance Token',
    symbol: 'stGVT',
  };
  const ownerAddress = '0x25910143C255828F623786f46fe9A8941B7983bB';
  const stakedTokenAddress = '0x9cE0E5c1C8437e3724e01232f45EA9332B1082dD';
  const minimumStakingPeriod = 60 * 60 * 24 * 7; // 7 days
  const rewardsTokens = [
    '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    stakedTokenAddress,
  ];

  const initBytes = VotesERC20StakedV1__factory.createInterface().encodeFunctionData('initialize', [
    metadata,
    ownerAddress,
    stakedTokenAddress,
    minimumStakingPeriod,
    rewardsTokens,
  ]);

  const votesERC20StakedV1Proxy = m.contract('ERC1967Proxy', [votesERC20StakedV1Implementation, initBytes]);

  return { votesERC20StakedV1Proxy };
});
