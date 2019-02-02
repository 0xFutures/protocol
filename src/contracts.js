import Promise from 'bluebird'
import contract from 'truffle-contract'

import CFDJSON from '../abi/ContractForDifference.json'
import CFDLibraryJSON from '../abi/ContractForDifferenceLibrary.json'
import CFDFactoryJSON from '../abi/ContractForDifferenceFactory.json'
import CFDRegistryJSON from '../abi/ContractForDifferenceRegistry.json'
import FeedsJSON from '../abi/Feeds.json'
import ForwardFactoryJSON from '../abi/ForwardFactory.json'
import RegistryJSON from '../abi/Registry.json'

import MockDAITokenJSON from '../build/contracts/DAIToken.json'

/**
 * Create a handle to the deployed ContractForDifferenceFactory.
 */
const cfdFactoryInstanceDeployed = async (config, web3) =>
  deployedContractInstance(
    'ContractForDifferenceFactory',
    config.cfdFactoryContractAddr,
    CFDFactoryJSON,
    config.ownerAccountAddr,
    config.gasPrice,
    config.gasLimit,
    web3
  )

/**
 * Create a handle to the deployed ContractForDifferenceRegistry.
 */
const cfdRegistryInstanceDeployed = async (config, web3) =>
  deployedContractInstance(
    'ContractForDifferenceRegistry',
    config.cfdRegistryContractAddr,
    CFDRegistryJSON,
    config.ownerAccountAddr,
    config.gasPrice,
    config.gasLimit,
    web3
  )

/**
 * Create a handle to the deployed Feeds contract.
 */
const feedsInstanceDeployed = async (config, web3) =>
  deployedContractInstance(
    'Feeds',
    config.feedContractAddr,
    FeedsJSON,
    config.daemonAccountAddr,
    config.gasPrice,
    config.gasLimit,
    web3
  )

/**
 * Create a handle to the deployed Feeds contract.
 */
const registryInstanceDeployed = async (config, web3) =>
  deployedContractInstance(
    'Registry',
    config.registryAddr,
    RegistryJSON,
    config.daemonAccountAddr,
    config.gasPrice,
    config.gasLimit,
    web3
  )

/**
 * Basic contract handles not connected to a specific deployment address.
 */
const feedsInstance = (web3Provider, config) =>
  contractInstance(FeedsJSON, web3Provider, config)

const registryInstance = (web3Provider, config) =>
  contractInstance(RegistryJSON, web3Provider, config)

const forwardFactoryInstance = (web3Provider, config) =>
  contractInstance(ForwardFactoryJSON, web3Provider, config)

const cfdInstance = (web3Provider, config) =>
  contractInstance(CFDJSON, web3Provider, config)

const cfdLibraryInstance = (web3Provider, config) =>
  contractInstance(CFDLibraryJSON, web3Provider, config)

const cfdFactoryInstance = (web3Provider, config) =>
  contractInstance(CFDFactoryJSON, web3Provider, config)

const cfdRegistryInstance = (web3Provider, config) =>
  contractInstance(CFDRegistryJSON, web3Provider, config)

const mockDAITokenInstance = (web3Provider, config) =>
  contractInstance(MockDAITokenJSON, web3Provider, config)

/**
 * Create a handle to an instance of a contract already deployed on the
 * blockchain.
 * Uses truffle-contract to generate the instance and given ABI and address.
 */
const deployedContractInstance = async (
  name,
  addr,
  contractJSON,
  defaultFrom,
  defaultGasPrice,
  defaultGasLimit,
  web3
) => {
  if (!web3.eth.getCodeAsync) {
    web3.eth.getCodeAsync = Promise.promisify(web3.eth.getCode)
  }

  if (await web3.eth.getCodeAsync(addr) === '0x0') {
    throw new Error(
      `${name} contract NOT deployed at ${addr}.` +
      ` Check the address and network settings.`
    )
  }

  const Contract = contract(contractJSON)
  Contract.setProvider(web3.currentProvider)
  Contract.defaults({
    from: defaultFrom,
    gasPrice: defaultGasPrice,
    gas: defaultGasLimit
  })
  return Contract.at(addr)
}

/**
 * Create a handle to a contract given the JSON and a web3 provider instance.
 */
const contractInstance = (contractJSON, web3Provider, config) => {
  const Contract = contract(contractJSON)
  Contract.setProvider(web3Provider)
  if (config.ownerAccountAddr && config.gasDefault) {
    Contract.defaults({
      from: config.ownerAccountAddr,
      gas: config.gasDefault
    })
  }
  return Contract
}

module.exports = {
  cfdInstance,
  cfdLibraryInstance,
  cfdFactoryInstance,
  cfdFactoryInstanceDeployed,
  cfdRegistryInstance,
  cfdRegistryInstanceDeployed,
  feedsInstance,
  feedsInstanceDeployed,
  forwardFactoryInstance,
  mockDAITokenInstance,
  registryInstance,
  registryInstanceDeployed
}
