# Legacy Deployments

This directory contains deployment artifacts from the previous deployment system (hardhat-deploy), preserved for historical reference and backward compatibility.

## Directory Structure

```
legacy-deployments/
├── base/         # Base network deployments
├── mainnet/      # Ethereum mainnet deployments
├── optimism/     # Optimism network deployments
├── polygon/      # Polygon network deployments
└── sepolia/      # Sepolia testnet deployments
```

## Contract Naming

These contracts use the original naming convention without V1 suffixes:

- `Azorius` (now `ModuleAzoriusV1`)
- `FractalModule` (now `ModuleFractalV1`)
- `LinearERC20Voting` (now `StrategyV1`)
- etc.

## Deployment Information

Each deployment file contains:

- Contract ABI
- Contract address (network-specific, not CREATE2)
- Deployment block number
- Transaction hash
- Other deployment metadata

## Migration Notice

New deployments use hardhat-ignition and CREATE2 for deterministic addresses across networks. These legacy deployments are maintained for:

1. Historical reference
2. Backward compatibility for existing integrations

## Usage in NPM Package

When using the `@decentdao/decent-contracts` npm package, legacy deployments are available under:

```javascript
import { legacy } from '@decentdao/decent-contracts';

// Access legacy ABIs
const azoriusABI = legacy.abis.Azorius;

// Access legacy addresses by network
const azoriusMainnetAddress = legacy.addresses.mainnet.Azorius.address;
const azoriusMainnetBlock = legacy.addresses.mainnet.Azorius.deploymentBlock;
```
