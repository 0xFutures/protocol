import program from 'commander'
import { readFileSync } from 'fs'
import HDWalletProvider from 'truffle-hdwallet-provider'
import Web3 from 'web3'

import { deployAll } from '../src/infura/deploy'
import { isEthereumAddress } from '../src/infura/utils'

const isInfura = addr => addr.indexOf('infura.io/') !== -1
const hdWalletProvider = config =>
  new HDWalletProvider(config.hdWalletMnemonic, config.rpcAddr, 0, 5)
const httpProvider = config => new Web3.providers.HttpProvider(config.rpcAddr)

const logProgress = true

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
  try {
    const deployment = await deployAll(
      web3,
      config,
      program.firstTime,
      logProgress
    )

    console.log(`Adding markets to PriceFeedsKyber ...`)
    // run in sequence (in parallel has a nonce issue with hdwallet provider)
    const kyberMarkets = config.feeds.kyber.markets
    for (const marketKey in kyberMarkets) {
      // Find the market decimal
      const decimals = kyberMarkets[marketKey].decimals || 18
      console.log(marketKey + " (decimals: " + decimals + ")")
      // Deploy the contract
      await deployment.priceFeedsKyber.methods
        .addMarket(marketKey, kyberMarkets[marketKey].from , kyberMarkets[marketKey].to, decimals)
        .send({
          gasPrice: 8000000000
        })
    }
    console.log(`done\n`)

    const newConfig = deployment.updatedConfig
    for (const key in newConfig) {
      if (isEthereumAddress(newConfig[key])) {
        newConfig[key] = newConfig[key].toLowerCase()
      }
    }
    console.log(`New config:\n${JSON.stringify(newConfig, null, 2)}\n`)
  } catch (error) {
    console.log(error)
    process.exit()
  }
}

deploy()
