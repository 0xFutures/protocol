import Promise from 'bluebird'
import {
  cfdInstance,
  cfdLibraryInstance,
  cfdFactoryInstance,
  cfdRegistryInstance,
  daiTokenInstanceDeployed,
  feedsInstance,
  forwardFactoryInstance,
  registryInstance,
  registryInstanceDeployed
} from './contracts'
import {isEthereumAddress} from './utils'

const linkBytecode = (bytecode, libraryName, libraryAddress) => {
  const regex = new RegExp('__' + libraryName + '_+', 'g')
  return bytecode.replace(regex, libraryAddress.replace('0x', ''))
}

/**
 * Deploy and configure Registry.
 * @param web3 Connected Web3 instance
 * @param config Config instance (see config.<env>.json)
 * @param logFn Log progress with this function
 * @return registry Registry truffle-contract instance
 * @return updatedConfig Config instance with updated registryAddr
 */
const deployRegistry = async (web3, config, logFn) => {
  web3.eth.defaultAccount = config.ownerAccountAddr.toLowerCase() // sometimes case is an issue: eg. truffle-hdwallet-provider

  const Registry = registryInstance(web3.currentProvider, config)

  logFn('Deploying Registry ...')
  const registry = await Registry.new()
  logFn(`Registry: ${registry.address}`)

  logFn('Calling registry.setFees ...')
  await registry.setFees(config.feesAccountAddr)
  logFn('done\n')

  logFn('Calling registry.setDAI ...')
  await registry.setDAI(config.daiTokenAddr)
  logFn('done\n')

  const updatedConfig = Object.assign({}, config, {
    registryAddr: registry.address
  })

  return {
    registry,
    updatedConfig
  }
}

/**
 * Deploy and configure Feeds.
 * @param web3 Connected Web3 instance
 * @param config Config instance (see config.<env>.json)
 * @param logFn Log progress with this function
 * @return feeds Feeds truffle-contract instance
 * @return updatedConfig Config instance with updated feedContractAddr
 */
const deployFeeds = async (web3, config, logFn) => {
  web3.eth.defaultAccount = config.ownerAccountAddr

  const Feeds = feedsInstance(web3.currentProvider, config)
  logFn('Deploying Feeds ...')
  const feeds = await Feeds.new()
  logFn(`Feeds: ${feeds.address}`)

  logFn('Calling feeds.setDaemonAccount ...')
  await feeds.setDaemonAccount(config.daemonAccountAddr)
  logFn('done\n')

  const updatedConfig = Object.assign({}, config, {
    feedContractAddr: feeds.address
  })

  return {
    feeds,
    updatedConfig
  }
}

/**
 * Deploy and configure CFD and related contracts.
 * @param web3 Connected Web3 instance
 * @param config Config instance (see config.<env>.json)
 * @param logFn Log progress with this function
 * @return cfd ContractForDifference truffle-contract instance
 * @return cfdFactory ContractForDifferenceFactory truffle-contract instance
 * @return cfdRegistry ContractForDifferenceRegistry truffle-contract instance
 * @return updatedConfig Config instance with addresses of newly deployed contracts added
 */
const deployCFD = async (web3, config, logFn) => {
  const {registryAddr} = config

  web3.eth.defaultAccount = config.ownerAccountAddr

  web3.version.getNetworkAsync = Promise.promisify(web3.version.getNetwork)
  const networkId = await web3.version.getNetworkAsync()

  const ForwardFactory = forwardFactoryInstance(web3.currentProvider, config)
  const CFD = cfdInstance(web3.currentProvider, config)
  const CFDLibrary = cfdLibraryInstance(web3.currentProvider, config)
  const CFDFactory = cfdFactoryInstance(web3.currentProvider, config)
  const CFDRegistry = cfdRegistryInstance(web3.currentProvider, config)
  const Feeds = feedsInstance(web3.currentProvider, config)

  logFn('Deploying ForwardFactory ...')
  const ff = await ForwardFactory.new()
  logFn(`ForwardFactory: ${ff.address}`)

  CFD.setNetwork(networkId)
  CFDLibrary.setNetwork(networkId)

  logFn('Deploying ContractForDifferenceLibrary ...')
  const cfdLib = await CFDLibrary.new()
  logFn(`ContractForDifferenceLibrary: ${cfdLib.address}`)

  logFn('Deploying ContractForDifference ...')
  CFD.bytecode = linkBytecode(
    CFD.bytecode,
    'ContractForDifferenceLibrary',
    cfdLib.address
  )
  const cfd = await CFD.new({gas: 7000000})
  logFn(`ContractForDifference: ${cfd.address}`)

  logFn('Deploying ContractForDifferenceRegistry ...')
  const cfdRegistry = await CFDRegistry.new()
  logFn(`ContractForDifferenceRegistry: ${cfdRegistry.address}`)

  const feeds = await Feeds.at(config.feedContractAddr)

  logFn('Deploying ContractForDifferenceFactory ...')
  const cfdFactory = await CFDFactory.new(
    registryAddr,
    cfd.address,
    ff.address,
    feeds.address,
    {gas: 3000000}
  )
  logFn(`ContractForDifferenceFactory: ${cfdFactory.address}`)

  const Registry = registryInstance(web3.currentProvider, config)
  const registry = await Registry.at(registryAddr)

  logFn('Setting up CFD Factory and Registry ...')
  // run in sequence (in parallel has a nonce issue with hdwaller provider)
  await cfdFactory.setCFDRegistry(cfdRegistry.address)
  await cfdRegistry.setFactory(cfdFactory.address)
  await registry.setCFDFactoryLatest(cfdFactory.address)
  logFn('done\n')

  const updatedConfig = Object.assign({}, config, {
    cfdFactoryContractAddr: cfdFactory.address,
    cfdRegistryContractAddr: cfdRegistry.address
  })

  return {
    cfd,
    cfdFactory,
    cfdRegistry,
    updatedConfig
  }
}

const deployAll = async (
  web3,
  initialConfig,
  firstTime = false,
  logProgress = false
) => {
  const log = logMsg => {
    if (logProgress === true) console.log(logMsg)
  }

  let config = initialConfig
  let registry
  if (firstTime === true) {
    // create registry
    const {registry: registryInstance, updatedConfig} = await deployRegistry(
      web3,
      config,
      log
    )
    config = updatedConfig
    registry = registryInstance
  } else {
    //
    // Not first deploy - so just get handle to existing Registry contract
    //
    if (!isEthereumAddress(config.registryAddr)) {
      throw new Error(
        `Deploy firstTime = false however registryAddr is NOT set in config ...`
      )
    }
    registry = await registryInstanceDeployed(config, web3)
  }

  // DAIToken handle
  if (!isEthereumAddress(config.daiTokenAddr)) {
    throw new Error(
      `DAI token address not set - it should be set in the config file ` +
        `OR if this is a dev env a mock version should have been deployed`
    )
  }
  const daiToken = await daiTokenInstanceDeployed(config, web3)

  const {updatedConfig: configAfterFeeds, feeds} = await deployFeeds(
    web3,
    config,
    log
  )
  config = configAfterFeeds

  const {
    updatedConfig: configAfterCFD,
    cfdFactory,
    cfdRegistry
  } = await deployCFD(web3, config, log)
  config = configAfterCFD

  return {
    cfdFactory,
    cfdRegistry,
    daiToken,
    feeds,
    registry,
    updatedConfig: config
  }
}

export {deployAll}
