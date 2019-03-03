import program from 'commander'
import {readFileSync} from 'fs'
import HDWalletProvider from 'truffle-hdwallet-provider'
import Web3 from 'web3'
import {deployAll} from '../src/infura/deploy'

const isInfura = addr => addr.indexOf('infura.io/') !== -1
const hdWalletProvider = config =>
  new HDWalletProvider(config.hdWalletMnemonic, config.rpcAddr, 0, 5)
const httpProvider = config => new Web3.providers.HttpProvider(config.rpcAddr)

const logProgress = true

const markets = ['Coinbase_BTC', 'Coinbase_ETH']

let configFile

program
  .arguments('<configFile>')
  .option(
    '-f, --first-time',
    'Defaults to false - if first time deploy new Registry'
  )
  .action(file => {
    configFile = file
  })
  .parse(process.argv)

const config = JSON.parse(readFileSync(configFile))
const web3 = new Web3(
  isInfura(config.rpcAddr) ? hdWalletProvider(config) : httpProvider(config)
)

const deploy = async () => {
  const deployment = await deployAll(
    web3,
    config,
    program.firstTime,
    logProgress
  )

  console.log(`Adding markets to Feeds ...`)
  // run in sequence (in parallel has a nonce issue with hdwaller provider)
  for (const market of markets) {
    await deployment.feeds.methods.addMarket(market).send()
  }
  console.log(`done\n`)

  console.log(
    `New config:\n${JSON.stringify(deployment.updatedConfig, null, 2)}\n`
  )
}

deploy()
