import program from 'commander'
import {readFileSync} from 'fs'
import Web3 from 'web3'
import {deployAll} from '../src/deploy'

const logProgress = true

const markets = [
  'Coinbase_BTC',
  'Coinbase_ETH'
]

let configFile

program
  .arguments('<configFile>')
  .option('-f, --first-time', 'Defaults to false - if first time deploy new Registry')
  .action((file) => {
    configFile = file
  })
  .parse(process.argv)

const config = JSON.parse(readFileSync(configFile))
const web3 = new Web3(new Web3.providers.HttpProvider(config.rpcAddr))

const deploy = async () => {
  const deployment = await deployAll(web3, config, program.firstTime, logProgress)

  console.log(`Adding markets to Feeds ...`)
  await Promise.all(markets.map(market => deployment.feeds.addMarket(market)))
  console.log(`done\n`)

  console.log(`New config:\n${JSON.stringify(deployment.updatedConfig, null, 2)}\n`)
}

deploy()
