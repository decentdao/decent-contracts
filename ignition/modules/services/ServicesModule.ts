import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

export default buildModule('Services', m => {
  // Deploy KYCVerifierV1
  const kycVerifierV1 = m.contract('KYCVerifierV1');

  // Deploy StrategyV1ValidatorV1
  const strategyV1ValidatorV1 = m.contract('StrategyV1ValidatorV1');

  return {
    kycVerifierV1,
    strategyV1ValidatorV1,
  };
});
