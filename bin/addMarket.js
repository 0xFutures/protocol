import {existsSync, readFileSync} from 'fs'
import Web3 from 'web3'
import {isValidMarketId, isValidContractAddr} from '../src/infura/utils'
import API from '../src/infura/api'

if (process.argv.length < 6 || !existsSync(process.argv[2])) {
  console.error(`Usage: ${process.argv[1]} <config file> <new market id> <token contract addr from> <token contract addr to>`)
  process.exit(-1)
}

const newMarketId = process.argv[3]
if (!isValidMarketId(newMarketId)) {
  console.error(
    `Market Id [${newMarketId}] is invalid.\n\n` +
      `Correct format: "FROM/TO" (For example: "ETH/USD")\n\n` +
      `Usage: ${process.argv[1]} <config file> <new market id> <token contract addr from> <token contract addr to>`
  )
  process.exit(-1)
}

const tokenContractAddrFrom = process.argv[4]
if (!isValidContractAddr(tokenContractAddrFrom)) {
  console.error(
    `tokenContractAddrFrom [${tokenContractAddrFrom}] is invalid.\n\n` +
      `Correct format: "0x..." (For example: "0x1234567890123456789012345678901234567890")\n\n` +
      `Usage: ${process.argv[1]} <config file> <new market id> <token contract addr from> <token contract addr to>`
  )
  process.exit(-1)
}

const tokenContractAddrto = process.argv[5]
if (!isValidContractAddr(tokenContractAddrto)) {
  console.error(
    `tokenContractAddrto [${tokenContractAddrto}] is invalid.\n\n` +
      `Correct format: "0x..." (For example: "0x1234567890123456789012345678901234567890")\n\n` +
      `Usage: ${process.argv[1]} <config file> <new market id> <token contract addr from> <token contract addr to>`
  )
  process.exit(-1)
}

const config = JSON.parse(readFileSync(process.argv[2]))
const web3 = new Web3(new Web3.providers.HttpProvider(config.rpcAddr))

API.newInstance(config, web3)
  .then(api => api.addMarket(newMarketId, tokenContractAddrFrom, tokenContractAddrto))
  .then(txReceipt => {
    const id = txReceipt.logs[0].args.bytesId
    console.log(
      `Market Added:\n\nmarketId(bytes32): ${id}\ntx: ${txReceipt.tx}\n`
    )
  })
  .catch(err => console.log(err))
