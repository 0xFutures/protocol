import {
  cfdInstance,
  cfdLibraryInstance,
  cfdFactoryInstance,
  cfdRegistryInstance,
  cfdProxyInstance,
  daiTokenInstanceDeployed,
  dsProxyFactoryInstance,
  forwardFactoryInstance,
  priceFeedsInstance,
  priceFeedsInstanceDeployed,
  priceFeedsInternalInstance,
  priceFeedsExternalInstance,
  registryInstance,
  registryInstanceDeployed,
} from './contracts'
import { isEthereumAddress } from './utils'

const linkBytecode = (bytecode, libraryName, libraryAddress) => {
  const regex = new RegExp('__' + libraryName + '_+', 'g')
  return bytecode.replace(regex, libraryAddress.replace('0x', ''))
}

/**
 * Deploy and configure Registry.
 * @param web3 Connected Web3 instance
 * @param config Config instance (see config.<env>.json)
 * @param logFn Log progress with this function
 * @return registry Registry contract instance
 * @return updatedConfig Config instance with updated registryAddr
 */
const deployRegistry = async (web3, config, logFn) => {
  web3.eth.defaultAccount = config.ownerAccountAddr // sometimes case is an issue: eg. truffle-hdwallet-provider

  const Registry = registryInstance(web3.currentProvider, config)

  logFn('Deploying Registry ...')
  const registry = await Registry.deploy({}).send({
    from: config.ownerAccountAddr,
    gas: config.gasDefault
  })
  logFn(`Registry: ${registry.options.address}`)

  logFn('Calling registry.setFees ...')
  await registry.methods.setFees(config.feesAccountAddr).send()
  logFn('done\n')

  logFn('Calling registry.setDAI ...')
  await registry.methods.setDAI(config.daiTokenAddr).send()
  logFn('done\n')

  const updatedConfig = Object.assign({}, config, {
    registryAddr: registry.options.address
  })

  return {
    registry,
    updatedConfig
  }
}

/**
 * Deploy and configure PriceFeeds contracts.
 * @param web3 Connected Web3 instance
 * @param config Config instance (see config.<env>.json)
 * @param logFn Log progress with this function
 * @return feeds Feeds contract instance
 * @return updatedConfig Config instance with updated priceFeeds addresses
 */
const deployPriceFeeds = async (web3, config, logFn) => {
  web3.eth.defaultAccount = config.ownerAccountAddr

  const PriceFeeds = priceFeedsInstance(web3.currentProvider, config)
  const PriceFeedsInternal = priceFeedsInternalInstance(web3.currentProvider, config)
  const PriceFeedsExternal = priceFeedsExternalInstance(web3.currentProvider, config)

  const txOpts = {
    from: config.ownerAccountAddr,
    gas: config.gasDefault
  }

  logFn('Deploying PriceFeedsInternal ...')
  const priceFeedsInternal = await PriceFeedsInternal.deploy({}).send(txOpts)
  logFn(`PriceFeedsInternal: ${priceFeedsInternal.options.address}`)

  logFn('Deploying PriceFeedsExternal ...')
  const priceFeedsExternal = await PriceFeedsExternal.deploy({}).send(txOpts)
  logFn(`PriceFeedsExternal: ${priceFeedsExternal.options.address}`)

  logFn('Calling priceFeedsInternal.setDaemonAccount ...')
  await priceFeedsInternal.methods.setDaemonAccount(config.daemonAccountAddr).send()
  logFn('done\n')

  logFn('Deploying PriceFeeds ...')
  const priceFeeds = await PriceFeeds.deploy({
    arguments: [
      priceFeedsInternal.options.address,
      priceFeedsExternal.options.address
    ]
  }).send(txOpts)
  logFn(`PriceFeeds: ${priceFeeds.options.address}`)

  const updatedConfig = Object.assign({}, config, {
    priceFeedsContractAddr: priceFeeds.options.address,
    priceFeedsInternalContractAddr: priceFeedsInternal.options.address,
    priceFeedsExternalContractAddr: priceFeedsExternal.options.address,
  })

  return {
    priceFeeds,
    priceFeedsInternal,
    priceFeedsExternal,
    updatedConfig
  }
}

/**
 * Deploy and configure CFD and related contracts.
 * @param web3 Connected Web3 instance
 * @param config Config instance (see config.<env>.json)
 * @param logFn Log progress with this function
 * @return cfd ContractForDifference contract instance
 * @return cfdFactory ContractForDifferenceFactory contract instance
 * @return cfdRegistry ContractForDifferenceRegistry contract instance
 * @return updatedConfig Config instance with addresses of newly deployed contracts added
 */
const deployCFD = async (web3, config, logFn) => {
  const { registryAddr } = config

  web3.eth.defaultAccount = config.ownerAccountAddr

  const ForwardFactory = forwardFactoryInstance(web3.currentProvider, config)
  const CFD = cfdInstance(web3.currentProvider, config)
  const CFDLibrary = cfdLibraryInstance(web3.currentProvider, config)
  const CFDFactory = cfdFactoryInstance(web3.currentProvider, config)
  const CFDRegistry = cfdRegistryInstance(web3.currentProvider, config)
  const CFDProxy = cfdProxyInstance(web3.currentProvider, config)

  logFn('\nDeploying ForwardFactory ...')
  const ff = await ForwardFactory.deploy({}).send({
    from: config.ownerAccountAddr,
    gas: config.gasDefault
  })
  logFn(`ForwardFactory: ${ff.options.address}`)

  logFn('Deploying ContractForDifferenceLibrary ...')
  const cfdLib = await CFDLibrary.deploy({}).send({
    from: config.ownerAccountAddr,
    gas: config.gasDefault
  })
  logFn(`ContractForDifferenceLibrary: ${cfdLib.options.address}`)

  logFn('Deploying ContractForDifference ...')
  CFD.options.data = linkBytecode(
    CFD.options.data,
    'ContractForDifferenceLibrary',
    cfdLib.options.address
  )
  const cfd = await CFD.deploy({}).send({
    from: config.ownerAccountAddr,
    gas: 7000000
  })
  logFn(`ContractForDifference: ${cfd.options.address}`)

  logFn('Deploying ContractForDifferenceRegistry ...')
  const cfdRegistry = await CFDRegistry.deploy({}).send({
    from: config.ownerAccountAddr,
    gas: config.gasDefault
  })
  logFn(`ContractForDifferenceRegistry: ${cfdRegistry.options.address}`)

  const priceFeeds = await priceFeedsInstanceDeployed(config, web3)

  logFn('Deploying ContractForDifferenceFactory ...')
  const cfdFactory = await CFDFactory.deploy({
    arguments: [
      registryAddr,
      cfd.options.address,
      ff.options.address,
      priceFeeds.options.address
    ]
  }).send({
    from: config.ownerAccountAddr,
    gas: 3000000
  })
  logFn(`ContractForDifferenceFactory: ${cfdFactory.options.address}`)

  logFn('Deploying ContractForDifferenceProxy ...')
  const cfdProxy = await CFDProxy.deploy({}).send({
    from: config.ownerAccountAddr,
    gas: config.gasDefault
  })
  logFn(`ContractForDifferenceProxy: ${cfdProxy.options.address}`)

  const registry = await registryInstanceDeployed(config, web3)

  logFn('Setting up CFD Factory and Registry ...')
  // run in sequence (in parallel has a nonce issue with hdwaller provider)
  await cfdFactory.methods.setCFDRegistry(cfdRegistry.options.address).send()
  await cfdRegistry.methods.setFactory(cfdFactory.options.address).send()
  await registry.methods.setCFDFactoryLatest(cfdFactory.options.address).send()
  logFn('done\n')

  const updatedConfig = Object.assign({}, config, {
    cfdFactoryContractAddr: cfdFactory.options.address,
    cfdRegistryContractAddr: cfdRegistry.options.address,
    cfdProxyContractAddr: cfdProxy.options.address
  })

  return {
    cfd,
    cfdFactory,
    cfdRegistry,
    cfdProxy,
    updatedConfig
  }
}


/**
 * Deploy and configure Proxy.
 * @param web3 Connected Web3 instance
 * @param config Config instance (see config.<env>.json)
 * @param logFn Log progress with this function
 * @return proxy Proxy contract instance
 * @return updatedConfig Config instance with updated proxyAddr
 */
const deployProxy = async (web3, config, logFn) => {
  web3.eth.defaultAccount = config.ownerAccountAddr // sometimes case is an issue: eg. truffle-hdwallet-provider

  const DSProxyFactory = dsProxyFactoryInstance(web3.currentProvider, config)

  logFn('Deploying Proxy ...')
  const dsProxyFactory = await DSProxyFactory.deploy({}).send({
    from: config.ownerAccountAddr,
    gas: config.gasDefault
  })
  logFn(`DSProxyFactory: ${dsProxyFactory.options.address}`)

  const updatedConfig = Object.assign({}, config, {
    dsProxyFactoryAddr: dsProxyFactory.options.address
  })

  return {
    dsProxyFactory,
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
    const { registry: registryInstance, updatedConfig } = await deployRegistry(
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

  const {
    updatedConfig: configAfterFeeds,
    priceFeeds,
    priceFeedsInternal,
    priceFeedsExternal
  } = await deployPriceFeeds(
    web3,
    config,
    log
  )
  config = configAfterFeeds

  const {
    updatedConfig: configAfterCFD,
    cfdFactory,
    cfdRegistry,
    cfdProxy,
  } = await deployCFD(web3, config, log)
  config = configAfterCFD

  const {
    updatedConfig: configAfterProxy,
    dsProxyFactory
  } = await deployProxy(web3, config, log)
  config = configAfterProxy

  return {
    cfdFactory,
    cfdRegistry,
    cfdProxy,
    daiToken,
    dsProxyFactory,
    priceFeeds,
    priceFeedsInternal,
    priceFeedsExternal,
    registry,
    updatedConfig: config
  }
}

export { deployAll }
