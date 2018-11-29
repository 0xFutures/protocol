import {existsSync, readFileSync} from 'fs'
import Web3 from 'web3'
import API from '../src/api'

if (process.argv.length < 5 || !existsSync(process.argv[2])) {
  console.error(`Usage: ${process.argv[1]} <config file> <market id> <value>`)
  process.exit(-1)
}

const config = JSON.parse(readFileSync(process.argv[2]))
const web3 = new Web3(new Web3.providers.HttpProvider(config.rpcAddr))

const marketId = process.argv[3]
const read = process.argv[4]
const ts = Date.now()

API.newInstance(config, web3)
  .then(api => api.push(marketId, read, ts))
  .then(txReceipt => console.log(`done tx: ${txReceipt.tx}`))
  .catch(err => console.log(err))
