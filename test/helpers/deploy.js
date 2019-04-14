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
import { nowSecs, toContractBigNumber } from '../../src/infura/utils'

// default market for testing
const MARKET_STR = 'Poloniex_ETH_USD'
const MARKET_ID = Utils.sha3(MARKET_STR)

const MARKET_STR_2 = 'Poloniex_BTC_USD'

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
const deployMockDAIToken = async (web3, config) =>
  deployMock(web3, config, daiTokenInstance)

/**
 * Deploy full set of contracts for testing.
 * Add 1 market and an initial price for that market.
 */
const deployAllForTest = async ({
  web3,
  config = configTest,
  firstTime = true,
  initialPrice, // push this is as feed value for test market
  seedAccounts = [] // array of accounts to seed with DAI
}) => {
  // DAIToken
  const daiToken = firstTime
    ? await deployMock(web3, config, daiTokenInstance)
    : await daiTokenInstanceDeployed(config, web3)

  // External PriceFeeds
  const ethUsdMaker = firstTime ?
    await deployMock(web3, config, ethUsdMakerInstance)
    : await ethUsdMakerInstanceDeployed(config, web3)

  const configUpdated = Object.assign({}, config, {
    daiTokenAddr: daiToken.options.address,
    ethUsdMakerAddr: ethUsdMaker.options.address
  })

  const deployment = await deployAll(web3, configUpdated, firstTime)

  // Internal PriceFeeds - add markets
  const { priceFeedsInternal } = deployment
  await priceFeedsInternal.methods.addMarket(MARKET_STR).send()
  await priceFeedsInternal.methods.addMarket(MARKET_STR_2).send()

  const decimals = await priceFeedsInternal.methods.decimals().call()
  const initialPriceBN = toContractBigNumber(initialPrice, decimals)
  await priceFeedsInternal.methods.push(MARKET_ID, initialPriceBN.toFixed(), nowSecs()).send({
    from: configUpdated.daemonAccountAddr
  })

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
    marketId: MARKET_ID,
    decimals,
    ethUsdMaker // not in deployment as it's a test only contract so add it here
  })
}

export { deployAllForTest, deployMockDAIToken }
