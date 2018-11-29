import program from 'commander'
import {parseScriptArgs} from './_shared'
import AdminAPI from '../src/admin-api'

let configFile
let newAddr

program
  .arguments('<configFile> <newDaemonAddr>')
  .action((file, addr) => {
    configFile = file
    newAddr = addr
  })
  .parse(process.argv)

const {config, web3} = parseScriptArgs(configFile, newAddr, 'newDaemonAddr')

AdminAPI.newInstance(config, web3)
  .then(async api => {
    console.log('Current daemon: ' + config.daemonAccountAddr)
    console.log('Transfering daemon...\n')
    await api.changeDaemonAccount(newAddr)
  }).catch(err => console.error(`${err}`))
