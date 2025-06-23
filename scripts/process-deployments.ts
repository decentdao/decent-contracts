#!/usr/bin/env ts-node

/**
 * Process Deployment Artifacts for NPM Publishing
 *
 * This script consolidates deployment artifacts from two sources:
 * 1. Legacy deployments (hardhat-deploy) - stored in /legacy-deployments/
 * 2. Current deployments (hardhat-ignition) - stored in /ignition/deployments/
 *
 * Key Features:
 * - Groups current contracts by category (deployables, services, singletons, utilities, etc.)
 * - Preserves legacy contract names and network-specific addresses
 * - Validates deployment consistency with different rules for testnets vs mainnets
 * - Outputs TypeScript files for type-safe contract imports
 *
 * Network Validation Rules:
 * - Sepolia (testnet): Lenient - can have different contracts/addresses than mainnets
 * - All other networks: Strict - must be identical (treated as mainnet networks)
 * - Mixed deployments: Mainnet consistency enforced, Sepolia differences logged as info
 *
 * Output Structure:
 * /publish/
 *   ├── abis.ts          # Current contract ABIs grouped by category
 *   ├── addresses.ts     # Current contract addresses (same across networks via CREATE2)
 *   ├── legacy/
 *   │   ├── abis.ts      # Legacy contract ABIs with original names
 *   │   ├── addresses.ts # Legacy addresses by network with deployment blocks
 *   │   └── index.ts     # Legacy export file
 *   └── index.ts         # Main export file
 *
 * Usage: npx ts-node scripts/process-deployments.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface LegacyDeployment {
  address: string;
  abi: any[];
  receipt: {
    blockNumber: number;
  };
}

interface IgnitionArtifact {
  abi: any[];
}

interface DeployedAddresses {
  [key: string]: string;
}

interface LegacyAddressInfo {
  address: string;
  deploymentBlock: number;
}

interface LegacyAddresses {
  [network: string]: {
    [contract: string]: LegacyAddressInfo;
  };
}

interface ABIs {
  [contractName: string]: any[];
}

interface Addresses {
  [contractName: string]: string;
}

// Dynamic types that adapt to whatever categories exist
type GroupedABIs = Record<string, ABIs>;
type GroupedAddresses = Record<string, Addresses>;

// Helper function to extract contract name and category from ignition format
function parseIgnitionKey(ignitionKey: string): { category: string; contractName: string } {
  // Format: "Module#ContractName" -> { category: "module", contractName: "ContractName" }
  const parts = ignitionKey.split('#');
  if (parts.length > 1) {
    return {
      category: parts[0].toLowerCase(),
      contractName: parts[1],
    };
  }
  return {
    category: 'unknown',
    contractName: ignitionKey,
  };
}

// Process legacy deployments
function processLegacyDeployments(): { abis: ABIs; addresses: LegacyAddresses } {
  const legacyPath = path.join(__dirname, '..', 'legacy-deployments');
  const legacyAbis: ABIs = {};
  const legacyAddresses: LegacyAddresses = {};

  if (!fs.existsSync(legacyPath)) {
    console.log('No legacy deployments found');
    return { abis: legacyAbis, addresses: legacyAddresses };
  }

  const networks = fs
    .readdirSync(legacyPath)
    .filter(dir => fs.statSync(path.join(legacyPath, dir)).isDirectory() && !dir.startsWith('.'));

  for (const network of networks) {
    const networkPath = path.join(legacyPath, network);

    // Read chain ID from .chainId file
    const chainIdPath = path.join(networkPath, '.chainId');
    let chainId: string;

    try {
      chainId = fs.readFileSync(chainIdPath, 'utf8').trim();
    } catch (error) {
      throw new Error(`Missing .chainId file for network ${network}.`);
    }

    const files = fs
      .readdirSync(networkPath)
      .filter(file => file.endsWith('.json') && !file.startsWith('.'));

    legacyAddresses[chainId] = {};

    for (const file of files) {
      const contractName = path.basename(file, '.json');
      const filePath = path.join(networkPath, file);

      try {
        const content: LegacyDeployment = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        // Store ABI (deduplicated by contract name)
        if (content.abi && content.abi.length > 0) {
          legacyAbis[contractName] = content.abi;
        }

        // Store address and deployment block
        legacyAddresses[chainId][contractName] = {
          address: content.address,
          deploymentBlock: content.receipt?.blockNumber,
        };
      } catch (error) {
        throw new Error(
          `Failed to process legacy deployment file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return { abis: legacyAbis, addresses: legacyAddresses };
}

// Process ignition deployments
function processIgnitionDeployments(): {
  abis: GroupedABIs;
  addresses: GroupedAddresses;
  networkIds: number[];
} {
  const ignitionPath = path.join(__dirname, '..', 'ignition', 'deployments');
  const groupedAbis: GroupedABIs = {};
  const groupedAddresses: GroupedAddresses = {};
  const networkIds: number[] = [];

  if (!fs.existsSync(ignitionPath)) {
    console.log('No ignition deployments found');
    return { abis: groupedAbis, addresses: groupedAddresses, networkIds };
  }

  // Get all chain directories
  const chainDirs = fs
    .readdirSync(ignitionPath)
    .filter(
      dir => dir.startsWith('chain-') && fs.statSync(path.join(ignitionPath, dir)).isDirectory(),
    );

  // Extract network IDs from chain directories
  for (const chainDir of chainDirs) {
    const chainId = parseInt(chainDir.replace('chain-', ''), 10);
    networkIds.push(chainId);
  }

  // Define network types
  const SEPOLIA_CHAIN_ID = '11155111';

  // Separate testnet from mainnet deployments
  // Everything except Sepolia is considered a mainnet network
  const sepoliaDir = chainDirs.find(dir => dir === `chain-${SEPOLIA_CHAIN_ID}`);
  const mainnetDirs = chainDirs.filter(dir => dir !== `chain-${SEPOLIA_CHAIN_ID}`);

  // Log deployment information
  console.log(`Found deployments on ${chainDirs.length} network(s):`);
  if (sepoliaDir) {
    console.log(`  - Sepolia (testnet): ${sepoliaDir}`);
  }
  if (mainnetDirs.length > 0) {
    console.log(`  - Mainnet networks: ${mainnetDirs.join(', ')}`);
  }

  if (mainnetDirs.length > 1) {
    console.log('  ⚠️  Multiple mainnet networks found - will enforce strict consistency');
  }
  if (sepoliaDir && mainnetDirs.length > 0) {
    console.log('  ℹ️  Sepolia deployments will be checked separately (lenient mode)');
  }

  // First, collect all contracts from all networks to verify consistency
  const contractsByNetwork: Map<string, Set<string>> = new Map();
  const allContracts: Map<
    string,
    { category: string; address: string; abi?: any[]; network?: string }
  > = new Map();

  for (const chainDir of chainDirs) {
    const chainPath = path.join(ignitionPath, chainDir);
    const addressesPath = path.join(chainPath, 'deployed_addresses.json');

    if (fs.existsSync(addressesPath)) {
      const deployedAddresses: DeployedAddresses = JSON.parse(
        fs.readFileSync(addressesPath, 'utf8'),
      );

      const contractsInNetwork = new Set<string>();

      for (const [ignitionKey, address] of Object.entries(deployedAddresses)) {
        const { category, contractName } = parseIgnitionKey(ignitionKey);
        const fullKey = `${category}#${contractName}`;
        contractsInNetwork.add(fullKey);

        // Read ABI from artifacts
        const artifactPath = path.join(chainPath, 'artifacts', `${ignitionKey}.json`);
        let currentAbi: any[] | undefined;

        if (fs.existsSync(artifactPath)) {
          try {
            const artifact: IgnitionArtifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
            if (artifact.abi && artifact.abi.length > 0) {
              currentAbi = artifact.abi;
            }
          } catch (error) {
            throw new Error(
              `Failed to read artifact file ${artifactPath}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        // Store contract info if not already stored
        if (!allContracts.has(fullKey)) {
          allContracts.set(fullKey, { category, address, abi: currentAbi, network: chainDir });
        } else {
          // Verify consistency across networks
          const existingInfo = allContracts.get(fullKey)!;

          // Check if either network is Sepolia
          const currentIsSepolia = chainDir === `chain-${SEPOLIA_CHAIN_ID}`;
          const previousIsSepolia = existingInfo.network === `chain-${SEPOLIA_CHAIN_ID}`;
          const isSepoliaInvolved = currentIsSepolia || previousIsSepolia;

          // Verify address consistency
          if (existingInfo.address !== address) {
            if (isSepoliaInvolved) {
              // If Sepolia is involved, just warn
              console.log(
                `INFO: Contract ${contractName} has different addresses:`,
                `\n  ${chainDir}: ${address}`,
                `\n  ${existingInfo.network}: ${existingInfo.address}`,
                `\n  (This is OK - Sepolia can differ from mainnet)`,
              );
            } else {
              // If only mainnet networks, this is critical
              throw new Error(
                `CRITICAL: Contract ${contractName} has different addresses on mainnet networks!` +
                  `\n  ${chainDir}: ${address}` +
                  `\n  ${existingInfo.network}: ${existingInfo.address}` +
                  `\n  All mainnet deployments must use CREATE2 with identical addresses!`,
              );
            }
          }

          // Verify ABI consistency
          if (currentAbi && existingInfo.abi) {
            const currentAbiStr = JSON.stringify(currentAbi);
            const existingAbiStr = JSON.stringify(existingInfo.abi);

            if (currentAbiStr !== existingAbiStr) {
              if (isSepoliaInvolved) {
                // If Sepolia is involved, just warn
                console.log(
                  `INFO: Contract ${contractName} has different ABIs between networks:`,
                  `\n  ${chainDir} vs ${existingInfo.network}`,
                  `\n  (This is OK - Sepolia can have different ABIs from mainnet)`,
                );
              } else {
                // If only mainnet networks, this is critical
                throw new Error(
                  `CRITICAL: Contract ${contractName} has different ABIs on mainnet networks!` +
                    `\n  Networks: ${chainDir} vs ${existingInfo.network}` +
                    `\n  All mainnet deployments must have identical ABIs!`,
                );
              }
            }
          }

          // If we don't have an ABI yet but this network does, use it
          if (!existingInfo.abi && currentAbi) {
            existingInfo.abi = currentAbi;
          }
        }
      }

      contractsByNetwork.set(chainDir, contractsInNetwork);
    }
  }

  // Verify mainnet consistency (strict) and handle Sepolia separately (lenient)
  if (mainnetDirs.length > 1) {
    // Check consistency across mainnet networks only
    const mainnetContractSets = mainnetDirs.map(dir => contractsByNetwork.get(dir)).filter(Boolean);

    if (mainnetContractSets.length > 1) {
      // Get the first mainnet network as reference
      const referenceContracts = mainnetContractSets[0]!;
      const referenceNetwork = mainnetDirs[0];

      // Check all other mainnet networks against the reference
      for (let i = 1; i < mainnetContractSets.length; i++) {
        const contracts = mainnetContractSets[i]!;
        const network = mainnetDirs[i];

        // Check for missing contracts in either direction
        for (const contract of referenceContracts) {
          if (!contracts.has(contract)) {
            throw new Error(
              `CRITICAL: Contract ${contract} exists on ${referenceNetwork} but is missing on ${network}. ` +
                `All mainnet deployments must be identical!`,
            );
          }
        }

        for (const contract of contracts) {
          if (!referenceContracts.has(contract)) {
            throw new Error(
              `CRITICAL: Contract ${contract} exists on ${network} but is missing on ${referenceNetwork}. ` +
                `All mainnet deployments must be identical!`,
            );
          }
        }
      }

      console.log(
        `✓ All mainnet networks have identical contracts (${referenceContracts.size} contracts)`,
      );
    }
  }

  // For Sepolia, just log warnings if it differs from mainnet
  if (sepoliaDir && mainnetDirs.length > 0) {
    const sepoliaContracts = contractsByNetwork.get(sepoliaDir);
    const mainnetContracts = contractsByNetwork.get(mainnetDirs[0]);

    if (sepoliaContracts && mainnetContracts) {
      for (const contract of mainnetContracts) {
        if (!sepoliaContracts.has(contract)) {
          console.log(
            `INFO: Contract ${contract} is on mainnet but not on Sepolia (this is OK for development)`,
          );
        }
      }

      for (const contract of sepoliaContracts) {
        if (!mainnetContracts.has(contract)) {
          console.log(
            `INFO: Contract ${contract} is on Sepolia but not on mainnet (this is OK for prereleases)`,
          );
        }
      }
    }
  }

  // Now populate the grouped structures dynamically
  for (const [fullKey, info] of allContracts.entries()) {
    const [category, contractName] = fullKey.split('#');

    // Initialize the category if it doesn't exist
    if (!groupedAddresses[category]) {
      groupedAddresses[category] = {};
      groupedAbis[category] = {};
      console.log(`  📁 Found new category: ${category}`);
    }

    // Add to the appropriate category
    groupedAddresses[category][contractName] = info.address;
    if (info.abi) {
      groupedAbis[category][contractName] = info.abi;
    }
  }

  return { abis: groupedAbis, addresses: groupedAddresses, networkIds };
}

// Write TypeScript files
function writeTypeScriptFiles(
  currentAbis: GroupedABIs,
  currentAddresses: GroupedAddresses,
  legacyAbis: ABIs,
  legacyAddresses: LegacyAddresses,
  chains: number[],
): void {
  const publishPath = path.join(__dirname, '..', 'publish');
  const legacyPath = path.join(publishPath, 'legacy');

  // Create directories
  fs.mkdirSync(publishPath, { recursive: true });
  fs.mkdirSync(legacyPath, { recursive: true });

  // Write current ABIs
  const currentAbisContent = `export default ${JSON.stringify(currentAbis, null, 2)} as const;`;
  fs.writeFileSync(path.join(publishPath, 'abis.ts'), currentAbisContent);

  // Write current addresses
  const currentAddressesContent = `export default ${JSON.stringify(currentAddresses, null, 2)} as const;`;
  fs.writeFileSync(path.join(publishPath, 'addresses.ts'), currentAddressesContent);

  // Write legacy ABIs
  const legacyAbisContent = `export default ${JSON.stringify(legacyAbis, null, 2)} as const;`;
  fs.writeFileSync(path.join(legacyPath, 'abis.ts'), legacyAbisContent);

  // Write legacy addresses
  const legacyAddressesContent = `export default ${JSON.stringify(legacyAddresses, null, 2)} as const;`;
  fs.writeFileSync(path.join(legacyPath, 'addresses.ts'), legacyAddressesContent);

  // Write legacy index
  const legacyIndexContent = `import abis from "./abis";
import addresses from "./addresses";
export { abis, addresses };
`;
  fs.writeFileSync(path.join(legacyPath, 'index.ts'), legacyIndexContent);

  // Write main index
  const mainIndexContent = `import abis from "./abis";
import addresses from "./addresses";
import * as legacy from "./legacy";

const chains = ${JSON.stringify(chains, null, 2)};

export { chains, abis, addresses, legacy };
`;
  fs.writeFileSync(path.join(publishPath, 'index.ts'), mainIndexContent);
}

// Main function
function main(): void {
  console.log('Processing deployments...');

  // Process legacy deployments
  const { abis: legacyAbis, addresses: legacyAddresses } = processLegacyDeployments();
  console.log(`Found ${Object.keys(legacyAbis).length} legacy contracts`);

  // Process ignition deployments
  const {
    abis: currentAbis,
    addresses: currentAddresses,
    networkIds,
  } = processIgnitionDeployments();
  const totalCurrentContracts = Object.values(currentAbis).reduce(
    (sum, categoryAbis) => sum + Object.keys(categoryAbis).length,
    0,
  );
  console.log(`Found ${totalCurrentContracts} current contracts`);

  // Write output files
  writeTypeScriptFiles(currentAbis, currentAddresses, legacyAbis, legacyAddresses, networkIds);

  console.log('Deployment processing complete!');
}

// Run the script
main();
