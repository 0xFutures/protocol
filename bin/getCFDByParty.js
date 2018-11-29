import {existsSync, readFileSync} from 'fs'
import Web3 from 'web3'
import CFDAPI from '../src/cfd-api'

if (process.argv.length < 4 || !existsSync(process.argv[2])) {
  console.error(`Usage: ${process.argv[1]} <config file> <party address>`)
  process.exit(-1)
}

const config = JSON.parse(readFileSync(process.argv[2]))
const partyAddr = process.argv[3]

const web3 = new Web3(new Web3.providers.HttpProvider("http://localhost:8545"))

CFDAPI.newInstance(config, web3)
  .then(api =>
    api.contractsForParty(
      partyAddr,
      {'includeLiquidated': true, 'includeTransferred': true},
      events => console.log(events),
      err => console.error(err)
    )
  )
  .catch(err => console.error(`Failure: ${err}`))
