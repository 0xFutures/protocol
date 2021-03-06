import {
  cfdInstance,
  cfdLibraryInstance,
  cfdFactoryInstance,
  cfdRegistryInstance,
  cfdProxyInstance,
  daiTokenInstanceDeployed,
  dsProxyFactoryInstance,
  dsProxyFactoryInstanceDeployed,
  forwardFactoryInstance,
  kyberFacadeInstance,
  priceFeedsInstance,
  priceFeedsInstanceDeployed,
  priceFeedsKyberInstance,
  registryInstance,
  registryInstanceDeployed
} from './contracts'
import { isEthereumAddress } from './utils'

const dsProxyByteCode = () => {
  const proxyJSON = require('../../abi/DSProxy.json')
  return proxyJSON.deployedBytecode
}

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
    gas: config.gasDefault,
    gasPrice: config.gasPrice
  })
  logFn(`Registry: ${registry.options.address}`)

  logFn('Calling registry.setDAI ...')
  await registry.methods.setDAI(config.daiTokenAddr).send({
    gas: config.gasDefault,
    gasPrice: config.gasPrice
  })
  logFn('done\n')

  logFn('Calling registry.setKyberNetworkProxy ...')
  await registry.methods.setKyberNetworkProxy(
    config.feeds.kyber.kyberNetworkProxyAddr
  ).send({
    gas: config.gasDefault,
    gasPrice: config.gasPrice
  })
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
  const PriceFeedsKyber = priceFeedsKyberInstance(web3.currentProvider, config)

  const txOpts = {
    from: config.ownerAccountAddr,
    gas: config.gasDefault,
    gasPrice: config.gasPrice
  }

  logFn('Deploying PriceFeedsKyber ...')
  const priceFeedsKyber = await PriceFeedsKyber.deploy({
    arguments: [config.registryAddr]
  }).send(txOpts)
  logFn(`PriceFeedsKyber: ${priceFeedsKyber.options.address}`)

  logFn('done\n')

  logFn('Deploying PriceFeeds ...')
  const priceFeeds = await PriceFeeds.deploy({
    arguments: [priceFeedsKyber.options.address]
  }).send(txOpts)
  logFn(`PriceFeeds: ${priceFeeds.options.address}`)

  const updatedConfig = Object.assign({}, config, {
    priceFeedsContractAddr: priceFeeds.options.address,
    priceFeedsKyberContractAddr: priceFeedsKyber.options.address
  })

  return {
    priceFeeds,
    priceFeedsKyber,
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
  const KyberFacade = kyberFacadeInstance(web3.currentProvider, config)

  logFn('\nDeploying ForwardFactory ...')
  const ff = await ForwardFactory.deploy({}).send({
    from: config.ownerAccountAddr,
    gas: config.gasDefault,
    gasPrice: config.gasPrice
  })
  logFn(`ForwardFactory: ${ff.options.address}`)

  logFn('Deploying KyberFacade ...')
  const kyberFacade = await KyberFacade.deploy({
    arguments: [
      config.registryAddr,
      config.feeds.kyber.walletId,
    ]
  }).send({
    from: config.ownerAccountAddr,
    gas: 1000000,
    gasPrice: config.gasPrice
  })
  logFn(`KyberFacade: ${kyberFacade.options.address}`)

  logFn('Deploying ContractForDifferenceLibrary ...')
  const cfdLib = await CFDLibrary.deploy({}).send({
    from: config.ownerAccountAddr,
    gas: config.gasDefault,
    gasPrice: config.gasPrice
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
    gas: 7000000,
    gasPrice: config.gasPrice
  })
  logFn(`ContractForDifference: ${cfd.options.address}`)

  logFn('Deploying ContractForDifferenceRegistry ...')
  const cfdRegistry = await CFDRegistry.deploy({}).send({
    from: config.ownerAccountAddr,
    gas: config.gasDefault,
    gasPrice: config.gasPrice
  })
  logFn(`ContractForDifferenceRegistry: ${cfdRegistry.options.address}`)

  const priceFeeds = await priceFeedsInstanceDeployed(config, web3)

  logFn('Deploying ContractForDifferenceFactory ...')
  const cfdFactory = await CFDFactory.deploy({
    arguments: [
      registryAddr,
      cfd.options.address,
      ff.options.address,
      priceFeeds.options.address,
      kyberFacade.options.address
    ]
  }).send({
    from: config.ownerAccountAddr,
    gas: 3000000,
    gasPrice: config.gasPrice
  })
  logFn(`ContractForDifferenceFactory: ${cfdFactory.options.address}`)

  logFn('Deploying ContractForDifferenceProxy ...')
  const cfdProxy = await CFDProxy.deploy({}).send({
    from: config.ownerAccountAddr,
    gas: config.gasDefault,
    gasPrice: config.gasPrice
  })
  logFn(`ContractForDifferenceProxy: ${cfdProxy.options.address}`)

  const registry = await registryInstanceDeployed(config, web3)

  logFn('Setting up CFD Factory and Registry ...')
  // run in sequence (in parallel has a nonce issue with hdwaller provider)
  await cfdFactory.methods.setCFDRegistry(cfdRegistry.options.address).send({
    gas: config.gasDefault,
    gasPrice: config.gasPrice
  })
  await cfdRegistry.methods.setFactory(cfdFactory.options.address).send({
    gas: config.gasDefault,
    gasPrice: config.gasPrice
  })
  await registry.methods.setCFDFactoryLatest(cfdFactory.options.address).send({
    gas: config.gasDefault,
    gasPrice: config.gasPrice
  })
  logFn('done\n')

  const updatedConfig = Object.assign({}, config, {
    cfdFactoryContractAddr: cfdFactory.options.address,
    cfdRegistryContractAddr: cfdRegistry.options.address,
    cfdProxyContractAddr: cfdProxy.options.address,
    kyberFacadeContractAddr: kyberFacade.options.address,
  })

  return {
    cfd,
    cfdFactory,
    cfdRegistry,
    cfdProxy,
    kyberFacade,
    updatedConfig
  }
}

/**
 * Deploy and configure Proxy.
 * @param web3 Connected Web3 instance
 * @param config Config instance (see config.<env>.json)
 * @param logFn Log progress with this function
 * @param registry Registry contract instance
 * @return proxy Proxy contract instance
 * @return updatedConfig Config instance with updated proxyAddr
 */
const deployProxy = async (web3, config, logFn, registry) => {
  web3.eth.defaultAccount = config.ownerAccountAddr // sometimes case is an issue: eg. truffle-hdwallet-provider

  const DSProxyFactory = dsProxyFactoryInstance(web3.currentProvider, config)

  logFn('Deploying Proxy ...')
  const dsProxyFactory = await DSProxyFactory.deploy({}).send({
    from: config.ownerAccountAddr,
    gas: config.gasDefault,
    gasPrice: config.gasPrice
  })
  logFn(`DSProxyFactory: ${dsProxyFactory.options.address}`)

  logFn('setProxyCodeHash ...')
  const codeHash = web3.utils.keccak256(dsProxyByteCode())
  await registry.methods.setProxyCodeHash(codeHash).send({
    gasPrice: 8000000000
  })
  logFn(`done`)

  const updatedConfig = Object.assign({}, config, {
    dsProxyFactoryContractAddr: dsProxyFactory.options.address
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
  let dsProxyFactory

  if (firstTime === true) {
    // create registry
    const { registry: registryInstance, updatedConfig: configAfterRegistry } = await deployRegistry(
      web3,
      config,
      log
    )
    registry = registryInstance
    config = configAfterRegistry

    // create proxy
    const { updatedConfig: configAfterProxy, dsProxyFactory: dsProxyFactoryInstance } = await deployProxy(
      web3,
      config,
      log,
      registry
    )
    dsProxyFactory = dsProxyFactoryInstance
    config = configAfterProxy
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
    dsProxyFactory = await dsProxyFactoryInstanceDeployed(config, web3)
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
    priceFeedsKyber
  } = await deployPriceFeeds(web3, config, log)
  config = configAfterFeeds

  const {
    updatedConfig: configAfterCFD,
    cfdFactory,
    cfdRegistry,
    cfdProxy
  } = await deployCFD(web3, config, log)
  config = configAfterCFD

  return {
    cfdFactory,
    cfdRegistry,
    cfdProxy,
    daiToken,
    dsProxyFactory,
    priceFeeds,
    priceFeedsKyber,
    registry,
    updatedConfig: config
  }
}

export { deployAll, deployRegistry }
