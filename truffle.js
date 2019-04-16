require('babel-register')
require('babel-polyfill')

const HDWalletProvider = require('truffle-hdwallet-provider')

const configDevelop = require('./config.develop.json')
const configTest = require('./config.test.json')
const configKovan = require('./config.kovan.json')

const defaultGasLimit = 4000000 // overridden in deployment scripts where needed

module.exports = {
  solc: {
    optimizer: {
      // enable the optimizer - ContractForDifference too big
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
    },
  }
}
