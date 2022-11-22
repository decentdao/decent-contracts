# Fractal Contracts

## Architecture
### VetoGuard.sol

The VetoGuard is a Gnosis Guard contract that enables a Fractal parent DAO to block or "veto" transactions on a child DAO from being executed. This also supports a child DAO being "frozen" by a parent DAO, which prevents the child DAO from executing any transaction until the freeze period has ended.

### VetoERC20Voting.sol

The VetoERC20Voting contract enables token holders of a parent DAO governance ERC-20 token to vote on vetoing child DAO transactions, and vote on freezing a child DAO. This implements a "one-token-one-vote" vote counting schema.

### FractalNameRegistry.sol

The FractalNameRegistry is a global contract for all Fractal DAOs which enables DAOs to configure a human-readable string that represents their DAO's name. These name strings are non-unique, and not used for identifying a DAO. They are purely utilized for UX purposes.

### FractalModule.sol

The FractalModule is a Gnosis Module contract that may be "installed" on a Fractal Gnosis Safe. This module enables other Fractal DAOs, typically a "parent" DAO, to execute transactions through the child DAO's Gnosis Safe. This may be utilized for functionality such as a "clawback", when a parent DAO claims back some or all of a child DAO's treasury.

## Local Setup & Testing

Clone the repository:
```shell
git clone ...
```

Lookup the recommended Node version to use in the .nvmrc file and install and use the correct version:
```shell
nvm install 
nvm use
```

Install necessary dependencies:
```shell
npm install
```

Add `.env` values replacing the private key and provider values for desired networks
```shell
cp .env.example .env
```

Compile contracts to create typechain files:
```shell
npm run compile
```

Run the tests
```shell
npm run test
```

## Deploy Contract to <network>
```shell
npx hardhat deploy --network <network>
```

## Local Hardhat deployment

To deploy the Fractal contracts open a terminal and run:
```shell
npx hardhat node
