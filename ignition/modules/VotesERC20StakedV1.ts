import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import { ethers } from 'hardhat';
import { VotesERC20StakedV1__factory, VotesERC20V1__factory } from '../../typechain-types';

export default buildModule('Apollo', m => {
  const eddiesAddress = '0x25910143C255828F623786f46fe9A8941B7983bB';

  const votesERC20V1Implementation = m.contract('VotesERC20V1', []);
  const votesERC20V1GovernanceTokenInitBytes =
    VotesERC20V1__factory.createInterface().encodeFunctionData('initialize', [
      { name: 'Governance Token', symbol: 'GVT' },
      [
        {
          to: eddiesAddress,
          amount: ethers.parseEther('1000000'),
        },
      ],
      eddiesAddress,
    ]);
  const votesERC20V1GovernanceTokenProxy = m.contract('ERC1967Proxy', [
    votesERC20V1Implementation,
    votesERC20V1GovernanceTokenInitBytes,
  ]);

  const votesERC20V1RewardsTokenInitBytes =
    VotesERC20V1__factory.createInterface().encodeFunctionData('initialize', [
      { name: 'Rewards Token', symbol: 'RWD' },
      [
        {
          to: eddiesAddress,
          amount: ethers.parseEther('1000000'),
        },
      ],
      eddiesAddress,
    ]);
  const votesERC20V1RewardsTokenProxy = m.contract('ERC1967Proxy', [
    votesERC20V1Implementation,
    votesERC20V1RewardsTokenInitBytes,
  ]);

  const votesERC20StakedV1Implementation = m.contract('VotesERC20StakedV1', []);

  // Metadata calldata metadata_,
  // address owner_,
  // address stakedToken_,
  // uint256 minimumStakingPeriod_,
  // address[] calldata rewardsTokens_

  const initBytes = VotesERC20StakedV1__factory.createInterface().encodeFunctionData('initialize', [
    { name: 'Staked Governance Token', symbol: 'stGVT' },
    eddiesAddress,
    votesERC20V1GovernanceTokenProxy,
    100,
    [
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      await votesERC20V1RewardsTokenProxy.getAddress(),
    ],
  ]);

  const erc1967Proxy = m.contract('ERC1967Proxy', [votesERC20StakedV1Implementation, initBytes]);

  return { erc1967Proxy };
});
