require('babel-register')
require('babel-polyfill')

const HDWalletProvider = require('truffle-hdwallet-provider')

const configDevelop = require('./config.develop.json')
const configTest = require('./config.test.json')
const configLive = require('./config.live.json')
const configKovan = require('./config.kovan.json')

const defaultGasLimit = 4000000 // overridden in migration scripts where needed

// change infura here to pull in a different setup, hd wallets, etc.
// const infura = require('./infura.json')
const infura = require('./infura.example.json')

module.exports = {
  solc: {
    optimizer: { // enable the optimizer - ContractForDifference too big
      enabled: true,
      runs: 200
    }
  },
  networks: {
    develop: {
      host: 'localhost',
      port: 9545,
      network_id: '*',
      from: configDevelop.ownerAccountAddr,
      gasLimit: 7000000
    },
    test: {
      host: 'localhost',
      port: 7545,
      network_id: '*',
      from: configTest.ownerAccountAddr,
      gasLimit: 7000000
    },
    kovan: {
      host: '0.0.0.0', // Local Parity Docker container
      port: 8545,
      network_id: 42,
      from: configKovan.ownerAccountAddr,
      gas: defaultGasLimit,
      gasPrice: configKovan.gasPrice
    },
    kovaninfura: {
      provider: function () {
        return new HDWalletProvider(
          infura.mnemonics.kovan,
          `https://kovan.infura.io/${infura.apikey}`,
          0,
          5
        )
      },
      network_id: 42,
      from: configKovan.ownerAccountAddr,
      gas: defaultGasLimit,
      gasPrice: configKovan.gasPrice
    },
    ropsteninfura: {
      provider: function () {
        return new HDWalletProvider(
          infura.mnemonics.kovan,
          `https://ropsten.infura.io/${infura.apikey}`
        )
      },
      network_id: 42,
      gas: defaultGasLimit,
      gasPrice: configKovan.gasPrice
    },
    live: {
      host: '0.0.0.0', // Local Parity Docker container
      port: 8545,
      network_id: 1,
      from: configLive.ownerAccountAddr,
      gas: defaultGasLimit,
      gasPrice: configLive.gasPrice
    }
  }
}
