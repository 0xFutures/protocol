import program from 'commander'
import { readFileSync } from 'fs'
import HDWalletProvider from 'truffle-hdwallet-provider'
import Web3 from 'web3'

import { deployAll } from '../src/infura/deploy'
import { getFunctionSignature, isEthereumAddress } from '../src/infura/utils'

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

    console.log(`Adding markets to PriceFeedsInternal ...`)
    // run in sequence (in parallel has a nonce issue with hdwaller provider)
    for (const market of config.markets.internal) {
      console.log(market)
      await deployment.priceFeedsInternal.methods.addMarket(market).send({
        gasPrice: 8000000000
      })
    }
    console.log(`done\n`)

    console.log(`Adding markets to PriceFeedsExternal ...`)
    // run in sequence (in parallel has a nonce issue with hdwaller provider)
    for (const marketKey of Object.keys(config.markets.external)) {
      console.log(marketKey)
      const market = config.markets.external[marketKey]

      const abi = require(`../build/contracts/${market.interface}.json`).abi
      const contractHandle = new web3.eth.Contract(abi)
      const callSignature = getFunctionSignature(contractHandle, market.priceFn)

      await deployment.priceFeedsExternal.methods.addMarket(
        marketKey,
        market.address,
        callSignature
      ).send({
        gasPrice: 8000000000
      })
    }
    console.log(`done\n`)

    const newConfig = deployment.updatedConfig
    for (const key in Object.keys(newConfig)) {
      if (isEthereumAddress(newConfig[key])) {
        newConfig[key] = newConfig[key].toLowerCase()
      }
    }
    console.log(
      `New config:\n${JSON.stringify(newConfig, null, 2)}\n`
    )

  } catch (error) {
    console.log(error)
    process.exit()
  }
  
}

deploy()
