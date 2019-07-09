import * as Utils from 'web3-utils'
import BigNumber from 'bignumber.js'

import configTest from '../../config.test.json'
import {
  daiTokenInstance,
  daiTokenInstanceDeployed,
  kyberNetworkInstance,
  kyberNetworkInstanceDeployed
} from '../../src/infura/contracts'
import { deployAll } from '../../src/infura/deploy'
import {
  EthDaiMarketStr,
  EthWbtcMarketStr,
  addMarketKyber,
  mockKyberPut
} from './kyber'

// test testing
const MARKET_NAMES = {
  kyberEthDai: EthDaiMarketStr,
  kyberEthWbtc: EthWbtcMarketStr
}

const MARKETS = {
  [MARKET_NAMES.kyberEthDai]: Utils.sha3(MARKET_NAMES.kyberEthDai),
  [MARKET_NAMES.kyberEthWbtc]: Utils.sha3(MARKET_NAMES.kyberEthWbtc)
}

/**
 * Deploy mock contracts given the instance handle function
 * and configuration.
 * @param web3 Connected Web3 instance
 * @param config Config instance (see config.<env>.json)
 * @return contract instance
 */
const deployMock = async (web3, config, instanceFn) => {
  web3.eth.defaultAccount = config.ownerAccountAddr
  const contractHandle = instanceFn(web3.currentProvider, config)
  const deployedInstance = await contractHandle.deploy({}).send({
    from: config.ownerAccountAddr,
    gas: config.gasDefault
  })
  return deployedInstance
}

/**
 * Deploy mock tokens for testing.
 * @param web3 Connected Web3 instance
 * @param config Config instance (see config.<env>.json)
 * @return contract instance
 */
const deployMocks = async (web3, config) => {
  return {
    daiToken: await deployMock(web3, config, daiTokenInstance),
    kyberNetwork: await deployMock(web3, config, kyberNetworkInstance)
  }
}

/**
 * Deploy full set of contracts for testing.
 * Add 1 market and an initial price for that market.
 */
const deployAllForTest = async ({
  web3,
  config = configTest,
  firstTime = true,
  initialPriceKyberDAI, // push this price for kyber DAI market
  seedAccounts = [] // array of accounts to seed with DAI
}) => {
  // console.log(`TOP`)
  // console.log(new Error().stack)

  let daiToken
  let kyberNetwork

  // Mock contracts
  if (firstTime) {
    const mocks = await deployMocks(web3, config)
    daiToken = mocks.daiToken
    kyberNetwork = mocks.kyberNetwork
  } else {
    daiToken = await daiTokenInstanceDeployed(config, web3)
    kyberNetwork = await kyberNetworkInstanceDeployed(config, web3)
  }

  if (initialPriceKyberDAI) {
    // console.log(`pushing price ${initialPriceKyberDAI}`)
    await mockKyberPut(
      kyberNetwork,
      daiToken.options.address,
      initialPriceKyberDAI
    )
  }

  // Deploy ALL
  const configUpdated = Object.assign({}, config)
  configUpdated.daiTokenAddr = daiToken.options.address
  configUpdated.feeds.kyber.kyberNetworkAddr = kyberNetwork.options.address

  const deployment = await deployAll(web3, configUpdated, firstTime)
  const { priceFeedsKyber } = deployment

  // add DAI market for testing
  // console.log(`creating market kyber dai`)
  await addMarketKyber(
    priceFeedsKyber,
    daiToken.options.address,
    MARKET_NAMES.kyberEthDai
  )

  if (firstTime === true && seedAccounts.length > 0) {
    const tenDAI = new BigNumber('1e18').times(10)
    await Promise.all(
      seedAccounts.map(acc =>
        daiToken.methods.transfer(acc, tenDAI.toFixed()).send({
          from: configUpdated.ownerAccountAddr
        })
      )
    )
  }

  return Object.assign({}, deployment, {
    // deployed test market details
    markets: MARKETS,
    marketNames: MARKET_NAMES,
    // add kyberNetwork as it's not in 'deployment' from deployAll
    // only a test env mock contract
    kyberNetwork
  })
}

export { deployAllForTest, deployMocks }
