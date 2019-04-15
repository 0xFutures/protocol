import * as Utils from 'web3-utils'
import BigNumber from 'bignumber.js'

import configTest from '../../config.test.json'
import {
  daiTokenInstance,
  daiTokenInstanceDeployed,
  ethUsdMakerInstance,
  ethUsdMakerInstanceDeployed
} from '../../src/infura/contracts'
import { deployAll } from '../../src/infura/deploy'
import { getFunctionSignature, nowSecs, toContractBigNumber } from '../../src/infura/utils'

// test testing
const MARKET_NAMES = {
  poloniexEthUsd: 'Poloniex_ETH_USD',
  poloniexBtcUsd: 'Poloniex_BTC_USD',
  makerEthUsd: 'Maker_ETH_USD'
}

const MARKETS = {
  [MARKET_NAMES.poloniexEthUsd]: Utils.sha3(MARKET_NAMES.poloniexEthUsd),
  [MARKET_NAMES.poloniexBtcUsd]: Utils.sha3(MARKET_NAMES.poloniexBtcUsd),
  [MARKET_NAMES.makerEthUsd]: Utils.sha3(MARKET_NAMES.makerEthUsd)
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
 * Deploy mock DAIToken.
 * @param web3 Connected Web3 instance
 * @param config Config instance (see config.<env>.json)
 * @return contract instance
 */
const deployMocks = async (web3, config) => {
  return {
    daiToken: await deployMock(web3, config, daiTokenInstance),
    ethUsdMaker: await deployMock(web3, config, ethUsdMakerInstance)
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
  initialPriceInternal, // push this is as feed value for internal test market
  initialPriceExternal, // push this is as feed value for external test market
  seedAccounts = [] // array of accounts to seed with DAI
}) => {
  let daiToken
  let ethUsdMaker

  // Mock contracts
  if (firstTime) {
    const mocks = await deployMocks(web3, config)
    daiToken = mocks.daiToken
    ethUsdMaker = mocks.ethUsdMaker
  } else {
    daiToken = await daiTokenInstanceDeployed(config, web3)
    ethUsdMaker = await ethUsdMakerInstanceDeployed(config, web3)
  }

  if (initialPriceExternal) {
    await mockMakerPut(ethUsdMaker, initialPriceExternal)
  }

  // Deploy ALL
  const configUpdated = Object.assign({}, config, {
    daiTokenAddr: daiToken.options.address,
    ethUsdMakerAddr: ethUsdMaker.options.address
  })
  const deployment = await deployAll(web3, configUpdated, firstTime)

  // Internal PriceFeeds - add markets
  const { priceFeedsInternal, priceFeedsExternal } = deployment
  await priceFeedsInternal.methods.addMarket(MARKET_NAMES.poloniexEthUsd).send()
  await priceFeedsInternal.methods.addMarket(MARKET_NAMES.poloniexBtcUsd).send()

  if (initialPriceInternal) {
    const initialPriceBN = toContractBigNumber(initialPriceInternal)
    await priceFeedsInternal.methods.push(
      MARKETS[MARKET_NAMES.poloniexEthUsd],
      initialPriceBN.toFixed(),
      nowSecs()
    ).send({
      from: configUpdated.daemonAccountAddr
    })
  }

  // External PriceFeeds - add maker mock market
  await addMarketExternal(priceFeedsExternal, ethUsdMaker, 'read', MARKET_NAMES.makerEthUsd)

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
    // add ethUsdMaker as it's not in 'deployment' from deployAll
    // only a test env mock contract
    ethUsdMaker
  })
}

/**
 * Add market to PriceFeedsExternal contract.
 * @param {Web3.eth.Contract} priceFeedsExternal PriceFeedsExternal contract handle
 * @param {Web3.eth.Contract} externalContract External contract handle (eg. MakerEthUsd) 
 * @param {string} fnName Name of function on external contract that returns the price
 * @param {string} marketStr String id of market
 */
const addMarketExternal = (priceFeedsExternal, externalContract, fnName, marketStr) => {
  const callSig = getFunctionSignature(externalContract, fnName)
  return priceFeedsExternal.methods.addMarket(
    marketStr,
    externalContract.options.address,
    callSig
  ).send()
}

/**
 * Push a given price into the maker mock contract.
 * @param {Web3.eth.Contract} makerMock EthUsdMaker contract handle
 * @param {BigNumber|string} price value in raw form (eg. '160.5' for 160.60 USD)
 */
const mockMakerPut = async (makerMock, price) => {
  const valueAdjusted = toContractBigNumber(price)
  const valueAsBytes32 = Utils.padLeft(Utils.numberToHex(valueAdjusted), 64)
  await makerMock.methods.put(valueAsBytes32).send()
}

export { deployAllForTest, deployMocks, addMarketExternal, mockMakerPut }
