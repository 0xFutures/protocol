import {existsSync, readFileSync} from 'fs'
import Web3 from 'web3'
import API from '../src/infura/api-infura'

if (process.argv.length < 4 || !existsSync(process.argv[2])) {
  console.error(`Usage: ${process.argv[1]} <config file> <market id>`)
  process.exit(-1)
}

const config = JSON.parse(readFileSync(process.argv[2]))
const web3 = new Web3(new Web3.providers.HttpProvider(config.rpcAddr))
const marketId = process.argv[3]

API.newInstance(config, web3)
  .then(api => api.read(marketId))
  .then((res) => {
    console.log(res.toNumber())
  })
