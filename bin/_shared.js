import {existsSync, readFileSync} from 'fs'
import Web3 from 'web3'

import {isEthereumAddress} from '../src/utils'

const parseScriptArgs = (configFile, newAddr, newAddrName) => {
  if (!configFile || !newAddr) {
    console.error(`configFile and ${newAddrName} mandatory`)
    process.exit(-1)
  }

  if (!existsSync(configFile)) {
    console.error(`can't open configFile`)
    process.exit(-1)
  }

  if (!isEthereumAddress(newAddr)) {
    console.error(`${newAddrName} is not a valid ethereum address`)
    process.exit(-1)
  }

  const config = JSON.parse(readFileSync(configFile))

  if (!config.rpcAddr) {
    console.error(`rpcAddr not defined in ${process.argv[2]}`)
    process.exit(-1)
  }

  const web3 = new Web3(new Web3.providers.HttpProvider(config.rpcAddr))

  return {config, web3}
}

export {parseScriptArgs}
