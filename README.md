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
