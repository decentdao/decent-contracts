import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

export default buildModule('Singletons', m => {
  // Deploy SystemDeployerV1
  const systemDeployerV1 = m.contract('SystemDeployerV1');

  // Deploy SystemDeployerEventEmitterV1
  const systemDeployerEventEmitterV1 = m.contract('SystemDeployerEventEmitterV1');

  // Deploy KeyValuePairsV1
  const keyValuePairsV1 = m.contract('KeyValuePairsV1');

  return {
    systemDeployerV1,
    systemDeployerEventEmitterV1,
    keyValuePairsV1,
  };
});
