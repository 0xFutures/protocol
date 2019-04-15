import program from 'commander'
import { readFileSync } from 'fs'
import HDWalletProvider from 'truffle-hdwallet-provider'
import Web3 from 'web3'
import { deployMockDAIToken } from '../test/helpers/deploy'

const isInfura = addr => addr.indexOf('infura.io/') !== -1
const hdWalletProvider = config =>
  new HDWalletProvider(config.hdWalletMnemonic, config.rpcAddr, 0, 5)
const httpProvider = config => new Web3.providers.HttpProvider(config.rpcAddr)

let configFile

program
  .arguments('<configFile>')
  .action(file => {
    configFile = file
  })
  .parse(process.argv)

if (!configFile) {
  program.help()
  process.exit(-1)
}

const config = JSON.parse(readFileSync(configFile))
const web3 = new Web3(
  isInfura(config.rpcAddr) ? hdWalletProvider(config) : httpProvider(config)
)

const deploy = async () => {
  console.log(`Deploying mock DAIToken ...`)
  const daiToken = await deployMockDAIToken(web3, config)
  console.log(`DAIToken: ${daiToken.address}\ndone\n`)
}

deploy()
