import Promise from 'bluebird'
import contract from 'truffle-contract'
import Web3 from 'web3'

import CFDJSON from '../../abi/ContractForDifference.json'
import CFDLibraryJSON from '../../abi/ContractForDifferenceLibrary.json'
import CFDFactoryJSON from '../../abi/ContractForDifferenceFactory.json'
import CFDRegistryJSON from '../../abi/ContractForDifferenceRegistry.json'
import ERC20JSON from '../../abi/ERC20.json'
import FeedsJSON from '../../abi/Feeds.json'
import ForwardFactoryJSON from '../../abi/ForwardFactory.json'
import RegistryJSON from '../../abi/Registry.json'

/*
 * Create handles to deployed contracts.
 */

const getContract = (cfdAdd, web3) =>
  new web3.eth.Contract(CFDJSON.abi, cfdAdd);

const cfdFactoryInstanceDeployed = async (config, web3) =>
  deployedInstance(config, web3, 'cfdFactoryContractAddr', CFDFactoryJSON)

const cfdRegistryInstanceDeployed = async (config, web3) =>
  deployedInstance(config, web3, 'cfdRegistryContractAddr', CFDRegistryJSON)

const feedsInstanceDeployed = async (config, web3) =>
  deployedInstance(
    config,
    web3,
    'feedContractAddr',
    FeedsJSON,
    config.daemonAccountAddr
  )

const registryInstanceDeployed = async (config, web3) =>
  deployedInstance(config, web3, 'registryAddr', RegistryJSON)

const daiTokenInstanceDeployed = async (config, web3) =>
  deployedInstance(config, web3, 'daiTokenAddr', ERC20JSON)

const deployedInstance = (
  config,
  web3,
  addrKey,
  abiJSON,
  defaultFrom = config.ownerAccountAddr
) =>
  deployedContractInstance(
    config[addrKey],
    abiJSON.abi,
    defaultFrom,
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

/**
 * Create a handle to an instance of a contract already deployed on the
 * blockchain.
 * Uses truffle-contract to generate the instance and given ABI and address.
 */
const deployedContractInstance = async (
  addr,
  contractJSON,
  defaultFrom,
  defaultGasPrice,
  defaultGasLimit,
  web3
) => {
  let code = await web3.eth.getCode(addr);

  if (code === '0x0' || code === '0x') {
    throw new Error(
      `${contractJSON.contractName} contract NOT deployed at ${addr}.` +
        ` Check the address and network settings.`
    )
  }
  return new web3.eth.Contract(contractJSON, addr, {
    from: defaultFrom,
    gasPrice: defaultGasPrice,
    gas: defaultGasLimit
  })
}

/**
 * Create a handle to a contract given the JSON and a web3 provider instance.
 */
const contractInstance = (contractJSON, web3Provider, config) => {
  const web3 = new Web3(web3Provider);
  var contractInstance = new web3.eth.Contract(contractJSON.abi)
  if (config.ownerAccountAddr)
    contractInstance.options.from = config.ownerAccountAddr;
  if (config.gasDefault)
    contractInstance.options.gas = config.gasDefault;
  if (contractJSON.bytecode)
    contractInstance.options.data = contractJSON.bytecode;
  return contractInstance;
}

module.exports = {
  getContract,
  cfdInstance,
  cfdLibraryInstance,
  cfdFactoryInstance,
  cfdFactoryInstanceDeployed,
  cfdRegistryInstance,
  cfdRegistryInstanceDeployed,
  contractInstance,
  daiTokenInstanceDeployed,
  feedsInstance,
  feedsInstanceDeployed,
  forwardFactoryInstance,
  registryInstance,
  registryInstanceDeployed
}
