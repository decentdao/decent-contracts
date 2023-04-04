# Fractal Contracts

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
```
## NPM Package
The core contracts in this repository are published in an NPM package for easy use within other repositories.

To install the npm package, run:

```shell
npm i @fractal-framework/fractal-contracts
```

Including un-compiled contracts within typechain-types. Follow (these steps) hardhat plug-in [https://www.npmjs.com/package/hardhat-dependency-compiler]

## Publishing new versions of these core contracts to NPM
Update the version in package.json
```shell
npm install
```
to get those version updates into package-lock.json
```shell
npm run publish:prepare 
```
to fully clean the project, compile contracts, create typechain directory, and compile the typechain directory
```shell
npm publish 
```
to publish the compiled typechain files and solidity contracts to NPM
```shell
git commit
git push
```

## Versioning
Fractal follows a modified style of semantic versioning (https://semver.org/) specific to a smart contract use case.

There are three types of releases: 

- **MAJOR**: Rare, and correlates to a major overhaul to the core DAO governance contracts. These are changes incompatible with prior contract versions and would require an existing DAO's successful proposal to migrate to. A major version will have undergone a professional smart contract audit.
- **MINOR**: Adds backwards-compatible functionality and additional utility or optimizations to the core governance smart contracts. New functionality will not impact the existing core governance contracts, will be optional for a DAO to utilize, and will have undergone either a contract audit or community bug bounty.
- **PATCH**: Also rare, but adds bug and/or security fixes. No new functionality will be introduced and the code may or may not have a contract audit or bug bounty, depending on the context and severity of the issue. Also depending on the context of the issue, DAOs may be required to pass a proposal to migrate to this new version.