import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import { vars } from 'hardhat/config';

export default buildModule('Services', m => {
  // Deploy VerifierV1 (general-purpose verifier)
  const verifierV1 = m.contract('VerifierV1', [
    vars.get('KYC_VERIFIER_OWNER'),
    vars.get('KYC_VERIFIER_VERIFIER'),
  ]);

  // Deploy StrategyV1ValidatorV1
  const strategyV1ValidatorV1 = m.contract('StrategyV1ValidatorV1');

  return {
    verifierV1,
    strategyV1ValidatorV1,
  };
});
