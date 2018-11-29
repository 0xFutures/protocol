import sha3 from 'web3/lib/utils/sha3'

if (process.argv.length < 3) {
  console.error(`Usage: ${process.argv[1]} <market id>`)
  process.exit(-1)
}

console.log('0x' + sha3(process.argv[2]))
