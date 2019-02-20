[![npm version](https://badge.fury.io/js/%400xfutures%2Fprotocol.svg)](https://badge.fury.io/js/%400xfutures%2Fprotocol)

# 0xFutures protocol

[0xFutures](https://0xfutures.com) protocol implementation

## Setup

```
> npm i -g truffle@4.1.14
> npm i
```

## Test

```
npm run publish-abi
npm test
```

## Deploy Contracts (local node)

This deployment command will recompile contracts, update ABI, run tests and deploy contracts to the blockchain using a local synchronised Ethereum node.

```
// eg. kovan
> npm run deploy-kovan
```

NOTE: the very first time the contracts are deployed to a new network the deployer should run 'npm run deploy-&lt;network&gt;-first-time' instead of 'npm run deploy-&lt;network&gt;' as this will install the permanent Registry contract that all future deployments share. It contains a mapping of all CFDs ever created as well as the address of the most recent CFDFactory contract.

## Deploy Contracts (Infura)

Runs the same steps as the 'local node' deploy above but will deploy using a remote infura node.

See config.kovan.infura.json.template for an example configuration. Put your Infura apikey and HD wallet mnemonic phrase in the config file.

```
// eg. kovan with infura config
> npm run deploy-kovan-infura
```

See the note about 'first-time' deployment above. This applies to Infura deployment also.

## Publish NPM

```
// ensure repo has latest abi
> npm run publish-abi
> git add abi && git commit -m "updated ABI" abi

// ensure tests are passing
> npm test

// publish NPM
> npm version patch     # bumps the version number and tags the commit
> npm publish           # see package.json scripts prepare - this will run the tests before publishing
> git push --tags
```

## npm

The package is published with the contract ABI JSON files (abi/) and js libraries (lib/) to [@0xfutures/protocol](https://www.npmjs.com/package/@0xfutures/protocol).
