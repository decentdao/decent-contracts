# Fractal - GnosisWrapper

## Architecture
### GnosisWrapper.sol

The Gnosis Wrapper Module utilizes serves as a link between the Fractal ecosystem and a Gnosis Safe. This contract inherits from ModuleBase so that the Fractal Access Control scheme can be used if necessary.

### GnosisWrapperFactory.sol

The Gnosis Wrapper Factory Contract contains the methods needed to deploy a proxy that is pointed to an implementation on chain. This contract inherits from the ModuleBaseFactory interface so that is compatible with the metaFactory contract in the MVD.

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

To deploy the base Fractal contracts open a terminal and run:
```shell
npx hardhat node
```
This will deploy the following contracts and log the addresses they were deployed to:
 - GnosisWrapperFactory
 - GnosisWrapper Implementation
