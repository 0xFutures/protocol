import {readFileSync} from 'fs'
import Web3 from 'web3'
import CFDAPI from '../src/infura/cfd-api-infura'

if (process.argv.length < 3) {
  console.error(`Usage: ${process.argv[1]} <config file>`)
  process.exit(-1)
}

const config = JSON.parse(readFileSync(process.argv[2]))

const web3 = new Web3(new Web3.providers.HttpProvider("http://localhost:8545"))

CFDAPI.newInstance(config, web3)
  .then(api =>
    api.contractsForMarket('WBTC/DAI', {},
      res => {
      	console.error(res)
      }
    )
  )
  .catch(err => console.error(`Failure: ${err}`))
