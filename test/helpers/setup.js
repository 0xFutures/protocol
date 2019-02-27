const Promise = require('bluebird')
const Web3 = require('web3')

const config = Object.freeze(require('../../config.test.json'))

console.log(config.rpcAddr)
const web3 = new Web3(new Web3.providers.HttpProvider(config.rpcAddr))
web3.eth.getBlockAsync = Promise.promisify(web3.eth.getBlock)
web3.eth.getCodeAsync = Promise.promisify(web3.eth.getCode)
web3.eth.getTransactionAsync = Promise.promisify(web3.eth.getTransaction)

export { config, web3 }
