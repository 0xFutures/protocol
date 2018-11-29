import {existsSync, readFileSync} from 'fs'
import Web3 from 'web3'
import {isValidMarketId} from '../src/utils'
import API from '../src/api'

if (process.argv.length < 4 || !existsSync(process.argv[2])) {
  console.error(`Usage: ${process.argv[1]} <config file> <new market id>`)
  process.exit(-1)
}

const newMarketId = process.argv[3]
if (!isValidMarketId(newMarketId)) {
  console.error(
    `Market Id [${newMarketId}] is invalid.\n\n` +
      `Correct format: "SOURCE_CODE1_CODE2" (For example: "Poloniex_ETH_USD")\n\n` +
      `Usage: ${process.argv[1]} <config file> <new market id>`
  )
  process.exit(-1)
}

const config = JSON.parse(readFileSync(process.argv[2]))
const web3 = new Web3(new Web3.providers.HttpProvider(config.rpcAddr))

API.newInstance(config, web3)
  .then(api => api.addMarket(newMarketId))
  .then(txReceipt => {
    const id = txReceipt.logs[0].args.bytesId
    console.log(
      `Market Added:\n\nmarketId(bytes32): ${id}\ntx: ${txReceipt.tx}\n`
    )
  })
  .catch(err => console.log(err))
