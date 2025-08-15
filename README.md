# Decent Contracts

## Project Overview

Decent Contracts is a Hardhat-based Ethereum smart contract project implementing the Azorius Protocol - a Safe Zodiac Module framework for composable governance in DAOs. The project enables modular voting strategies with support for multiple token standards (ERC20, ERC721, Hats Protocol) integrated with Gnosis Safe.

## Azorius Protocol

A Safe module which allows for composable governance.

Azorius conforms to the [Zodiac](https://github.com/gnosis/zodiac) pattern for Safe modules.

The Azorius contract acts as a central manager of DAO Proposals, maintaining the specifications of the transactions that comprise a Proposal.

All voting details are delegated to `BaseStrategy` implementations, of which an Azorius DAO can have any number.

Azorius was forked from and heavily based on the [Usul](https://github.com/SekerDAO/Usul) module, by [SekerDAO](https://github.com/SekerDAO).

## Architecture Overview

The system implements a modular governance framework using the Zodiac pattern:

### Core Components

1. **ModuleAzoriusV1** (`contracts/deployables/module/Azorius.sol`)

   - Central governance module that manages proposals
   - Integrates with Gnosis Safe as a Zodiac module
   - Handles proposal submission, state management, and execution
   - Delegates voting logic to Strategy contracts

2. **ModuleFractalV1** (`contracts/deployables/module/Fractal.sol`)

   - Enables parent-child DAO relationships
   - Allows parent DAOs to execute transactions directly on child DAOs
   - Installed on child DAO's Safe, owned by parent DAO
   - Critical for emergency interventions when used with freeze mechanism

3. **StrategyV1** (`contracts/deployables/strategies/`)

   - Manages voting logic and rules
   - Supports multiple voting adapters for different token types
   - Implements quorum thresholds and voting periods
   - Integrates with Light Accounts for gasless voting

4. **Voting Adapters** (`contracts/deployables/voting-adapter/`)

   - VotingAdapterERC20V1: ERC20 token-based voting
   - VotingAdapterERC721V1: NFT-based voting
   - Handle voting weight calculation and vote recording

5. **Proposer Adapters** (`contracts/deployables/proposer-adapter/`)
   - Control who can create proposals
   - Support various mechanisms (token holdings, NFT ownership, Hats roles)

### Key Workflows

**Proposal Lifecycle:**

1. Submit proposal through Azorius with transactions and metadata
2. Strategy initializes voting period
3. Users cast votes through strategy using voting adapters
4. After voting + timelock, execute passed proposals through Safe

**Parent-Child DAO Freeze Mechanism:**

1. **Setup**: Child DAO has FreezeGuard attached and ModuleFractalV1 enabled (owned by parent)
2. **Freeze Vote**: Parent DAO token holders vote to freeze child (via FreezeVoting contracts)
3. **Activation**: When threshold reached, child DAO is frozen - cannot execute any transactions
4. **Intervention**: Parent DAO executes necessary actions on child via ModuleFractalV1
5. **Unfreeze**: Parent DAO can unfreeze child, or freeze expires after set period

### Integration Points

- **Safe Integration**: Azorius acts as a Safe module, executing transactions through `execTransactionFromModule()`
- **Freeze Mechanism**: FreezeGuard blocks all transactions when DAO is frozen (separate from normal proposals)
- **Account Abstraction**: Supports gasless voting via Light Accounts and paymasters
- **Parent-Child Relations**: ModuleFractalV1 enables hierarchical DAO structures with emergency controls

## Contract Categories

The codebase is organized into four distinct contract categories based on deployment patterns and usage:

### 1. Deployables (`contracts/deployables/`)

- **Deployment**: One instance per DAO
- **Characteristics**: Hold state, long-lived, owned by DAOs
- **Examples**:
  - ModuleAzoriusV1: Central governance module
  - StrategyV1: Voting strategy implementation
  - VotingAdapters: Token-based voting mechanisms
  - ProposerAdapters: Proposal creation controls
  - DecentPaymasterV1: Account abstraction paymaster

### 2. Singletons (`contracts/singletons/`)

- **Deployment**: One instance per chain
- **Characteristics**: No DAO contracts hold references to these, used by client applications
- **Examples**:
  - SystemDeployerV1: Orchestrates contract deployments (called via delegatecall from Safe setup)
  - KeyValuePairsV1: On-chain key-value storage

### 3. Utilities (`contracts/utilities/`)

- **Deployment**: One instance per chain
- **Characteristics**: Called via delegatecall from Safe during proposal execution
- **Purpose**: Handle dynamic logic based on blockchain state at execution time, don't hold any state
- **Examples**:
  - UtilityRolesManagementV1: Creates and manages organizational roles (Hats Protocol + Sablier streams)

### 4. Services (`contracts/services/`)

- **Deployment**: One instance per chain
- **Characteristics**: Referenced by multiple DAO deployable contracts
- **Examples**:
  - StrategyV1ValidatorV1: Validates strategy voting for account abstraction
  - VerifierV1: Provides buyer verification services for Countersign and TokenSale contracts

## Local Setup & Testing

### Development Setup

Clone the repository:

```shell
git clone https://github.com/decentdao/decent-contracts.git
```

Look up the recommended Node version to use in the `.nvmrc` file and install and use the correct version:

```shell
nvm install
nvm use
```

Install necessary dependencies:

```shell
npm install
```

Copy the example `.env` and replace the values for the desired networks

```shell
cp .env.example .env
```

### Build & Compile

Compile contracts to create typechain files:

```shell
npm run compile
```

Clean build artifacts:

```shell
npm run clean
```

### Testing

Run all tests:

```shell
npm run test
```

Run specific test file:

```shell
npx hardhat test test/deployables/module/Azorius.test.ts
```

### Code Quality

#### Linting

Lint TypeScript files with ESLint:

```shell
npm run lint
```

Check ESLint issues without fixing:

```shell
npm run lint:check
```

Lint and fix Solidity contracts with Solhint:

```shell
npm run solhint
```

Check Solhint issues without fixing:

```shell
npm run solhint:check
```

#### Formatting

Format all code (TypeScript and Solidity) with Prettier:

```shell
npm run pretty
```

Check code formatting without fixing:

```shell
npm run pretty:check
```

## Contract Deployment

Before deploying, set your unique CREATE2 salt to ensure deterministic addresses:

```shell
npx hardhat vars set DECENT_CREATE2_SALT 0xUniqueSalt
```

Replace `0xUniqueSalt` with your own unique salt value. This salt determines the final contract addresses when using CREATE2.

To deploy all contracts to a specific network using Hardhat Ignition:

```shell
npx hardhat ignition deploy ignition/modules/DeployAll.ts --network <network> --strategy create2 --verify
```

For example, to deploy to Sepolia:

```shell
npx hardhat ignition deploy ignition/modules/DeployAll.ts --network sepolia --strategy create2 --verify
```

This command will:

- Deploy all contracts using CREATE2 for deterministic addresses
- Automatically verify contracts on Etherscan (or the appropriate block explorer)
- Store deployment artifacts in `ignition/deployments/chain-<chainId>/`

The `--strategy create2` flag ensures contracts are deployed to the same addresses across all networks when using the same salt.

Individual modules can also be deployed separately if needed:

```shell
npx hardhat ignition deploy ignition/modules/Deployables.ts --network <network> --strategy create2 --verify
npx hardhat ignition deploy ignition/modules/Services.ts --network <network> --strategy create2 --verify
npx hardhat ignition deploy ignition/modules/Singletons.ts --network <network> --strategy create2 --verify
npx hardhat ignition deploy ignition/modules/Utilities.ts --network <network> --strategy create2 --verify
```

## Local Hardhat deployment

To deploy the Decent contracts to a local node:

```shell
npx hardhat node
```

## NPM Package

The core contracts in this repository are published in an NPM package for easy use within other repositories.

To install the npm package in your project, run:

```shell
npm i @decentdao/decent-contracts
```

## Publishing new versions to NPM

1. Increment the version in `package.json`, then `npm install` to get those version updates into `package-lock.json`.
1. Get those changes into the main branch through a PR.
1. Tag the merge commit with that version number you just bumped.
1. Create a Release on GitHub.

## Versioning

Decent follows a modified style of semantic versioning (https://semver.org/) specific to a smart contract use case.

There are three types of releases:

- **MAJOR**: Rare, and correlates to a major overhaul to the core DAO governance contracts. These are changes incompatible with prior contract versions and would require an existing DAO's successful proposal to migrate to. A major version will have undergone a professional smart contract audit.
- **MINOR**: Adds backwards-compatible functionality and additional utility or optimizations to the core governance smart contracts. New functionality will not impact the existing core governance contracts, will be optional for a DAO to utilize, and will have undergone either a contract audit or community bug bounty.
- **PATCH**: Also rare, but adds bug and/or security fixes. No new functionality will be introduced and the code may or may not have a contract audit or bug bounty, depending on the context and severity of the issue. Also depending on the context of the issue, DAOs may be required to pass a proposal to migrate to this new version.

## Important Patterns

- Some contracts use UUPS proxy pattern for upgradability
- Contracts follow OpenZeppelin's upgradeable patterns
- SystemDeployerV1 must be called via delegatecall from Safe setup (direct calls will revert)
- Test files mirror contract structure in `/test` directory
- Integration tests in `/test/integration` demonstrate full workflows
- Solidity version 0.8.30 with optimizer enabled (200 runs)
