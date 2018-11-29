import program from 'commander'
import AdminAPI from '../src/admin-api'
import {parseScriptArgs} from './_shared'

let configFile
let newAddr

program
  .arguments('<configFile> <newOwnerAddr>')
  .option('-r, --registry-only', 'Transfer on Registry contract ONLY (eg. prepare for new deploy)')
  .action((file, addr) => {
    configFile = file
    newAddr = addr
  })
  .parse(process.argv)

const {config, web3} = parseScriptArgs(configFile, newAddr, 'newOwnerAddr')

AdminAPI.newInstance(config, web3)
  .then(async api => {
    console.log('Current owner: ' + config.ownerAccountAddr)
    console.log('Transfering owner...\n')
    await api.changeOwnerAccount(newAddr, {registryOnly: program.registryOnly})
  }).catch(err => console.error(`${err}`))
