import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

export default buildModule('Deployables', m => {
  // Deploy Modules
  const moduleAzoriusV1 = m.contract('ModuleAzoriusV1');
  const moduleFractalV1 = m.contract('ModuleFractalV1');

  // Deploy StrategyV1 implementation
  const strategyV1 = m.contract('StrategyV1');

  // Deploy Proposer Adapters
  const proposerAdapterERC20V1 = m.contract('ProposerAdapterERC20V1');
  const proposerAdapterERC721V1 = m.contract('ProposerAdapterERC721V1');
  const proposerAdapterHatsV1 = m.contract('ProposerAdapterHatsV1');

  // Deploy Voting Adapters
  const votingAdapterERC20V1 = m.contract('VotingAdapterERC20V1');
  const votingAdapterERC721V1 = m.contract('VotingAdapterERC721V1');

  // Deploy Freeze Guards
  const freezeGuardAzoriusV1 = m.contract('FreezeGuardAzoriusV1');
  const freezeGuardMultisigV1 = m.contract('FreezeGuardMultisigV1');

  // Deploy Freeze Voting
  const freezeVotingAzoriusV1 = m.contract('FreezeVotingAzoriusV1');
  const freezeVotingMultisigV1 = m.contract('FreezeVotingMultisigV1');

  // Deploy VotesERC20 implementations
  const votesERC20V1 = m.contract('VotesERC20V1');
  const votesERC20StakedV1 = m.contract('VotesERC20StakedV1');

  // Deploy DecentPaymasterV1 implementation
  const decentPaymasterV1 = m.contract('DecentPaymasterV1');

  // Deploy DecentAutonomousAdminV1 implementation
  const decentAutonomousAdminV1 = m.contract('DecentAutonomousAdminV1');

  // Deploy CountersignV1 implementation
  const countersignV1 = m.contract('CountersignV1');

  return {
    moduleAzoriusV1,
    moduleFractalV1,

    strategyV1,

    proposerAdapterERC20V1,
    proposerAdapterERC721V1,
    proposerAdapterHatsV1,

    votingAdapterERC20V1,
    votingAdapterERC721V1,

    freezeGuardAzoriusV1,
    freezeGuardMultisigV1,

    freezeVotingAzoriusV1,
    freezeVotingMultisigV1,

    votesERC20V1,
    votesERC20StakedV1,

    decentPaymasterV1,

    decentAutonomousAdminV1,

    countersignV1,
  };
});
