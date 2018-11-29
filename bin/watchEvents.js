import {existsSync, readFileSync} from 'fs'
import Web3 from 'web3'
import API from '../src/api'

if (process.argv.length < 3 || !existsSync(process.argv[2])) {
  console.error(`Usage: ${process.argv[1]} <config file>`)
  process.exit(-1)
}

const config = JSON.parse(readFileSync(process.argv[2]))
const web3 = new Web3(new Web3.providers.HttpProvider(config.rpcAddr))

API.newInstance(config, web3).then(api =>
  api.watchPushEvents((error, result) => {
    if (error) console.error(`watchEvents error: ${error}`)
    console.info(`watchEvents res: ${JSON.stringify(result)}`)
  })
)
