require('babel-register')
require('babel-polyfill')

const fs = require('fs')

const HDWalletProvider = require('truffle-hdwallet-provider')

const configDevelop = require('./config.develop.json')
const configTest = require('./config.test.json')

const defaultGasLimit = 4000000 // overridden in deployment scripts where needed

const networks = {
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
  }
}

// add kovan network if config file has been created
const configFileKovan = './config.kovan.json'
if (fs.existsSync(configFileKovan)) {
  const configKovan = require(configFileKovan)
  networks.kovan = {
    provider: function () {
      return new HDWalletProvider(
        configKovan.hdWalletMnemonic,
        configKovan.rpcAddr,
        0,
        5
      )
    },
    network_id: 42,
    from: configKovan.ownerAccountAddr,
    gas: defaultGasLimit,
    gasPrice: configKovan.gasPrice
  }
}

module.exports = {
  solc: {
    optimizer: {
      // enable the optimizer - ContractForDifference too big
      enabled: true,
      runs: 200
    }
  },
  networks
}
