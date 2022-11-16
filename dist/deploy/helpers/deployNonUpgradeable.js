"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deployNonUpgradeable = void 0;
const deployNonUpgradeable = async (hre, contractName, 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
args = []) => {
    const { deployments: { deploy }, getNamedAccounts, } = hre;
    const { deployer } = await getNamedAccounts();
    const config = {
        log: true,
        from: deployer,
        args,
    };
    await deploy(contractName, config);
};
exports.deployNonUpgradeable = deployNonUpgradeable;
