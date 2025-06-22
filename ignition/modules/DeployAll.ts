import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

import DeployablesModule from './deployables/DeployablesModule';
import ServicesModule from './services/ServicesModule';
import SingletonsModule from './singletons/SingletonsModule';
import UtilitiesModule from './utilities/UtilitiesModule';

export default buildModule('DeployAll', m => {
  // Deploy all singletons
  const singletons = m.useModule(SingletonsModule);

  // Deploy all deployables
  const deployables = m.useModule(DeployablesModule);

  // Deploy all utilities
  const utilities = m.useModule(UtilitiesModule);

  // Deploy all services
  const services = m.useModule(ServicesModule);

  return {
    ...singletons,
    ...deployables,
    ...utilities,
    ...services,
  };
});
