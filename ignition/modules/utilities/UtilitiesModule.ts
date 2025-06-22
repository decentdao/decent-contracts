import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

export default buildModule('Utilities', m => {
  // Deploy UtilityRolesManagement utility
  const utilityRolesManagementModule = m.contract('UtilityRolesManagementV1');

  return {
    utilityRolesManagementModule,
  };
});
