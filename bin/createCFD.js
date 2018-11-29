import {existsSync, readFileSync} from 'fs'
import Web3 from 'web3'
import CFDAPI from '../src/cfd-api'

if (
  process.argv.length < 4 ||
  !existsSync(process.argv[2]) ||
  !existsSync(process.argv[3])
) {
  console.error(`Usage: ${process.argv[1]} <config file> <cfd details file>`)
  process.exit(-1)
}

const config = JSON.parse(readFileSync(process.argv[2]))
const cfd = JSON.parse(readFileSync(process.argv[3]))
console.log(cfd)

const web3 = new Web3(new Web3.providers.HttpProvider(config.rpcAddr))

CFDAPI.newInstance(config, web3)
  .then(
    api =>
      api.newCFD(
        cfd.marketId,
        cfd.strikePrice,
        cfd.amountWei,
        cfd.isBuyer,
        cfd.creatorAccount
      ),
    {gas: 3000000}
  )
  .then(txReceipt =>
    console.log(
      `tx receipt: ${JSON.stringify(txReceipt)}\n\nNew CFD address: ${
        txReceipt.logs[0].args.newCFDAddr
      }`
    )
  )
  .catch(err => console.error(`Failure: ${err}`))
