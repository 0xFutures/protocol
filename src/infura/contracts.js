import Web3 from 'web3'

import CFDJSON from '../../abi/ContractForDifference.json'
import CFDLibraryJSON from '../../abi/ContractForDifferenceLibrary.json'
import CFDFactoryJSON from '../../abi/ContractForDifferenceFactory.json'
import CFDRegistryJSON from '../../abi/ContractForDifferenceRegistry.json'
import PriceFeedsJSON from '../../abi/PriceFeeds.json'
import PriceFeedsInternalJSON from '../../abi/PriceFeedsInternal.json'
import PriceFeedsExternalJSON from '../../abi/PriceFeedsExternal.json'
import ForwardFactoryJSON from '../../abi/ForwardFactory.json'
import RegistryJSON from '../../abi/Registry.json'

import MockDAITokenJSON from '../../abi/DAIToken.json'
import MockEthUsdMakerJSON from '../../abi/EthUsdMaker.json'

/**********************************************************
 *  Contract handles for deployed contracts.
 *********************************************************/

const cfdFactoryInstanceDeployed = async (config, web3) =>
  deployedInstance(config, web3, 'cfdFactoryContractAddr', CFDFactoryJSON)

const cfdRegistryInstanceDeployed = async (config, web3) =>
  deployedInstance(config, web3, 'cfdRegistryContractAddr', CFDRegistryJSON)

const priceFeedsInstanceDeployed = async (config, web3) =>
  deployedInstance(
    config,
    web3,
    'priceFeedsContractAddr',
    PriceFeedsJSON,
    config.priceFeedsInternalContractAddr,
    config.priceFeedsExternalContractAddr
  )

const priceFeedsInternalInstanceDeployed = async (config, web3) =>
  deployedInstance(
    config,
    web3,
    'priceFeedsInternalContractAddr',
    PriceFeedsInternalJSON,
    config.daemonAccountAddr
  )

const priceFeedsExternalInstanceDeployed = async (config, web3) =>
  deployedInstance(
    config,
    web3,
    'priceFeedsExternalContractAddr',
    PriceFeedsExternalJSON
  )

const registryInstanceDeployed = async (config, web3) =>
  deployedInstance(config, web3, 'registryAddr', RegistryJSON)


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

const priceFeedsInternalInstance = (web3Provider, config) =>
  contractInstance(PriceFeedsInternalJSON, web3Provider, config)

const priceFeedsExternalInstance = (web3Provider, config) =>
  contractInstance(PriceFeedsExternalJSON, web3Provider, config)

const cfdInstance = (web3Provider, config) =>
  contractInstance(CFDJSON, web3Provider, config)

const cfdLibraryInstance = (web3Provider, config) =>
  contractInstance(CFDLibraryJSON, web3Provider, config)

const cfdFactoryInstance = (web3Provider, config) =>
  contractInstance(CFDFactoryJSON, web3Provider, config)

const cfdRegistryInstance = (web3Provider, config) =>
  contractInstance(CFDRegistryJSON, web3Provider, config)

/**********************************************************
*  Contract handles to mock and test only contracts. 
*********************************************************/

const daiTokenInstanceDeployed = async (config, web3) =>
  deployedInstance(config, web3, 'daiTokenAddr', MockDAITokenJSON)

const daiTokenInstance = (web3Provider, config) =>
  contractInstance(MockDAITokenJSON, web3Provider, config)

const ethUsdMakerInstanceDeployed = async (config, web3) =>
  deployedInstance(config, web3, 'ethUsdMakerAddr', MockEthUsdMakerJSON)

const ethUsdMakerInstance = (web3Provider, config) =>
  contractInstance(MockEthUsdMakerJSON, web3Provider, config)


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

  if (addr == undefined)
    return undefined;

  let code = await web3.eth.getCode(addr);

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
  addrKey,
  abiJSON,
  defaultFrom = config.ownerAccountAddr
) =>
  deployedContractInstance(
    config[addrKey],
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

/**
 * Get contract handle
 */
const getContract = (cfdAdd, web3) =>
  new web3.eth.Contract(CFDJSON.abi, cfdAdd);

module.exports = {
  getContract,
  cfdInstance,
  cfdLibraryInstance,
  cfdFactoryInstance,
  cfdFactoryInstanceDeployed,
  cfdRegistryInstance,
  cfdRegistryInstanceDeployed,
  contractInstance,
  daiTokenInstance,
  daiTokenInstanceDeployed,
  ethUsdMakerInstance,
  ethUsdMakerInstanceDeployed,
  forwardFactoryInstance,
  priceFeedsInstance,
  priceFeedsInstanceDeployed,
  priceFeedsInternalInstance,
  priceFeedsInternalInstanceDeployed,
  priceFeedsExternalInstance,
  priceFeedsExternalInstanceDeployed,
  registryInstance,
  registryInstanceDeployed
}
