import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import { ethers } from 'hardhat';
import { VotesERC20V1__factory } from '../../typechain-types';

export default buildModule('VotesERC20V1', m => {

  const votesERC20V1Implementation = m.contract('VotesERC20V1');

  const metadata = {
    name: 'Governance Token',
    symbol: 'GVT',
  };
  const owner = '0x25910143C255828F623786f46fe9A8941B7983bB';
  const allocations = [
    {
      to: owner,
      amount: ethers.parseEther('1000000'),
    },
  ];

  const initBytes = VotesERC20V1__factory.createInterface().encodeFunctionData('initialize', [
    metadata,
    allocations,
    owner,
  ]);

  const votesERC20V1Proxy = m.contract('ERC1967Proxy', [votesERC20V1Implementation, initBytes]);

  return { votesERC20V1Proxy };
});
