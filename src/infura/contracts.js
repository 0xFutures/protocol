import Web3 from 'web3'

import CFDJSON from '../../abi/ContractForDifference.json'
import CFDLibraryJSON from '../../abi/ContractForDifferenceLibrary.json'
import CFDFactoryJSON from '../../abi/ContractForDifferenceFactory.json'
import CFDRegistryJSON from '../../abi/ContractForDifferenceRegistry.json'
import CFDProxyJSON from '../../abi/ContractForDifferenceProxy.json'
import DSProxyFactoryJSON from '../../abi/DSProxyFactory.json'
import DSProxyJSON from '../../abi/DSProxy.json'
import KyberFacadeJSON from '../../abi/KyberFacade.json'
import PriceFeedsJSON from '../../abi/PriceFeeds.json'
import PriceFeedsKyberJSON from '../../abi/PriceFeedsKyber.json'
import ForwardFactoryJSON from '../../abi/ForwardFactory.json'
import RegistryJSON from '../../abi/Registry.json'

import MockDAITokenJSON from '../../abi/DAIToken.json'
import MockKyberNetworkProxyJSON from '../../abi/KyberNetworkProxy.json'

/**********************************************************
 *  Contract handles for deployed contracts.
 *********************************************************/

const cfdFactoryInstanceDeployed = async (config, web3) =>
  deployedInstance(config, web3, config.cfdFactoryContractAddr, CFDFactoryJSON)

const cfdRegistryInstanceDeployed = async (config, web3) =>
  deployedInstance(config, web3, config.cfdRegistryContractAddr, CFDRegistryJSON)

const cfdProxyInstanceDeployed = async (config, web3) =>
  deployedInstance(config, web3, config.cfdProxyContractAddr, CFDProxyJSON)

const kyberFacadeInstanceDeployed = async (config, web3) =>
  deployedInstance(config, web3, config.kyberFacadeContractAddr, KyberFacadeJSON)

const priceFeedsInstanceDeployed = async (config, web3) =>
  deployedInstance(
    config,
    web3,
    config.priceFeedsContractAddr,
    PriceFeedsJSON
  )

const priceFeedsKyberInstanceDeployed = async (config, web3) =>
  deployedInstance(
    config,
    web3,
    config.priceFeedsKyberContractAddr,
    PriceFeedsKyberJSON
  )

const registryInstanceDeployed = async (config, web3) =>
  deployedInstance(config, web3, config.registryAddr, RegistryJSON)

const dsProxyFactoryInstanceDeployed = async (config, web3) =>
  deployedInstance(
    config,
    web3,
    config.dsProxyFactoryContractAddr,
    DSProxyFactoryJSON
  )

const dsProxyInstanceDeployed = async (
  config,
  web3,
  proxyAddr,
  defaultFromAddr
) =>
  deployedContractInstance(
    proxyAddr,
    DSProxyJSON,
    defaultFromAddr,
    config.gasPrice,
    config.gasLimit,
    web3
  )

/**********************************************************
 *  Contract handles to instances not connected to a
 *  specific deployment address.
 *********************************************************/

const registryInstance = (web3Provider, config) =>
  contractInstance(RegistryJSON, web3Provider, config)

const forwardFactoryInstance = (web3Provider, config) =>
  contractInstance(ForwardFactoryJSON, web3Provider, config)

const priceFeedsInstance = (web3Provider, config) =>
  contractInstance(PriceFeedsJSON, web3Provider, config)

const priceFeedsKyberInstance = (web3Provider, config) =>
  contractInstance(PriceFeedsKyberJSON, web3Provider, config)

const cfdInstance = (web3Provider, config) =>
  contractInstance(CFDJSON, web3Provider, config)

const cfdLibraryInstance = (web3Provider, config) =>
  contractInstance(CFDLibraryJSON, web3Provider, config)

const cfdFactoryInstance = (web3Provider, config) =>
  contractInstance(CFDFactoryJSON, web3Provider, config)

const cfdRegistryInstance = (web3Provider, config) =>
  contractInstance(CFDRegistryJSON, web3Provider, config)

const cfdProxyInstance = (web3Provider, config) =>
  contractInstance(CFDProxyJSON, web3Provider, config)

const dsProxyFactoryInstance = (web3Provider, config) =>
  contractInstance(DSProxyFactoryJSON, web3Provider, config)

const dsProxyInstance = (web3Provider, config) =>
  contractInstance(DSProxyJSON, web3Provider, config)

const kyberFacadeInstance = (web3Provider, config) =>
  contractInstance(KyberFacadeJSON, web3Provider, config)

/**********************************************************
 *  Contract handles to mock and test only contracts.
 *********************************************************/

const daiTokenInstanceDeployed = async (config, web3) =>
  deployedInstance(config, web3, config.daiTokenAddr, MockDAITokenJSON)

const daiTokenInstance = (web3Provider, config) =>
  contractInstance(MockDAITokenJSON, web3Provider, config)

const kyberNetworkProxyInstanceDeployed = async (config, web3) =>
  deployedInstance(config, web3, config.feeds.kyber.kyberNetworkProxyAddr, MockKyberNetworkProxyJSON)

const kyberNetworkProxyInstance = (web3Provider, config) =>
  contractInstance(MockKyberNetworkProxyJSON, web3Provider, config)

/**
 * Create a handle to an instance of a contract already deployed on the
 * blockchain.
 * Uses Web3.eth.Contract to generate the instance and given ABI and address.
 */
const deployedContractInstance = async (
  addr,
  contractJSON,
  defaultFrom,
  defaultGasPrice,
  defaultGasLimit,
  web3
) => {
  if (addr == undefined) return undefined

  let code = await web3.eth.getCode(addr)

  if (code === '0x0' || code === '0x') {
    throw new Error(
      `${contractJSON.contractName} contract NOT deployed at ${addr}.` +
      ` Check the address and network settings.`
    )
  }
  return new web3.eth.Contract(contractJSON.abi, addr, {
    from: defaultFrom,
    gasPrice: defaultGasPrice,
    gas: defaultGasLimit
  })
}

const deployedInstance = (
  config,
  web3,
  instanceAddr,
  abiJSON,
  defaultFrom = config.ownerAccountAddr
) =>
  deployedContractInstance(
    instanceAddr,
    abiJSON,
    defaultFrom,
    config.gasPrice,
    config.gasLimit,
    web3
  )

/**
 * Create a handle to a contract given the JSON and a web3 provider instance.
 */
const contractInstance = (contractJSON, web3Provider, config) => {
  const web3 = new Web3(web3Provider)
  var contractInstance = new web3.eth.Contract(contractJSON.abi)
  if (config.ownerAccountAddr) {
    contractInstance.options.from = config.ownerAccountAddr
  }
  if (config.gasDefault) contractInstance.options.gas = config.gasDefault
  if (contractJSON.bytecode) {
    contractInstance.options.data = contractJSON.bytecode
  }
  return contractInstance
}

/**
 * Get contract handle
 */
const getContract = (cfdAdd, web3) => new web3.eth.Contract(CFDJSON.abi, cfdAdd)

module.exports = {
  getContract,
  cfdInstance,
  cfdLibraryInstance,
  cfdFactoryInstance,
  cfdFactoryInstanceDeployed,
  cfdRegistryInstance,
  cfdRegistryInstanceDeployed,
  cfdProxyInstance,
  cfdProxyInstanceDeployed,
  contractInstance,
  daiTokenInstance,
  daiTokenInstanceDeployed,
  dsProxyInstance,
  dsProxyInstanceDeployed,
  dsProxyFactoryInstance,
  dsProxyFactoryInstanceDeployed,
  kyberFacadeInstance,
  kyberFacadeInstanceDeployed,
  kyberNetworkProxyInstance,
  kyberNetworkProxyInstanceDeployed,
  forwardFactoryInstance,
  priceFeedsInstance,
  priceFeedsInstanceDeployed,
  priceFeedsKyberInstance,
  priceFeedsKyberInstanceDeployed,
  registryInstance,
  registryInstanceDeployed
}
