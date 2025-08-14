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

  // Deploy Vote Weight and Tracker Adapters
  const voteTrackerERC20V1 = m.contract('VoteTrackerERC20V1');
  const voteTrackerERC721V1 = m.contract('VoteTrackerERC721V1');
  const votingWeightERC20V1 = m.contract('VotingWeightERC20V1');
  const votingWeightERC721V1 = m.contract('VotingWeightERC721V1');

  // Deploy Freeze Guards
  const freezeGuardAzoriusV1 = m.contract('FreezeGuardAzoriusV1');
  const freezeGuardMultisigV1 = m.contract('FreezeGuardMultisigV1');

  // Deploy Freeze Voting
  const freezeVotingAzoriusV1 = m.contract('FreezeVotingAzoriusV1');
  const freezeVotingMultisigV1 = m.contract('FreezeVotingMultisigV1');
  const freezeVotingStandaloneV1 = m.contract('FreezeVotingStandaloneV1');

  // Deploy VotesERC20 implementations
  const votesERC20V1 = m.contract('VotesERC20V1');
  const votesERC20StakedV1 = m.contract('VotesERC20StakedV1');

  // Deploy DecentPaymasterV1 implementation
  const decentPaymasterV1 = m.contract('DecentPaymasterV1');

  // Deploy DecentAutonomousAdminV1 implementation
  const decentAutonomousAdminV1 = m.contract('DecentAutonomousAdminV1');

  // Deploy CountersignV1 implementation
  const countersignV1 = m.contract('CountersignV1');

  // Deploy WarrantHedgeyV1 implementation
  const warrantHedgeyV1 = m.contract('WarrantHedgeyV1');

  // Deploy TokenSaleV1 implementation
  const tokenSaleV1 = m.contract('TokenSaleV1');

  return {
    moduleAzoriusV1,
    moduleFractalV1,

    strategyV1,

    proposerAdapterERC20V1,
    proposerAdapterERC721V1,
    proposerAdapterHatsV1,

    voteTrackerERC20V1,
    voteTrackerERC721V1,
    votingWeightERC20V1,
    votingWeightERC721V1,

    freezeGuardAzoriusV1,
    freezeGuardMultisigV1,

    freezeVotingAzoriusV1,
    freezeVotingMultisigV1,
    freezeVotingStandaloneV1,

    votesERC20V1,
    votesERC20StakedV1,

    decentPaymasterV1,

    decentAutonomousAdminV1,

    countersignV1,

    warrantHedgeyV1,

    tokenSaleV1,
  };
});
