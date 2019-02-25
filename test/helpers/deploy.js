import * as Utils from 'web3-utils'

import configTest from '../../config.test.json'
import {contractInstance} from '../../src/contracts'
import {deployAll} from '../../src/deploy'
import {nowSecs, toContractBigNumber} from '../../src/utils'
import MockDAITokenJSON from '../../build/contracts/DAIToken.json'

// default market for testing
const MARKET_STR = 'Poloniex_ETH_USD'
const MARKET_ID = '0x' + Utils.sha3(MARKET_STR)

const mockDAITokenInstance = (web3Provider, config) =>
  contractInstance(MockDAITokenJSON, web3Provider, config)

/**
 * Deploy a mock DAI token for test and develop.
 * @param web3 Connected Web3 instance
 * @param config Config instance (see config.<env>.json)
 * @return daiToken DAIToken truffle-contract instance
 */
const deployMockDAIToken = async (web3, config) => {
  web3.eth.defaultAccount = config.ownerAccountAddr
  const DAIToken = mockDAITokenInstance(web3.currentProvider, config)

  // console.log('Deploying mock DAIToken ...')
  const daiToken = await DAIToken.new()
  // console.log(`DAIToken: ${daiToken.address}`)
  // console.log('done\n')

  return daiToken
}

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
  const daiToken = firstTime
    ? await deployMockDAIToken(web3, config)
    : mockDAITokenInstance(web3.currentProvider, config).at(config.daiTokenAddr)
  const configUpdated = Object.assign({}, config, {
    daiTokenAddr: daiToken.address
  })

  const deployment = await deployAll(web3, configUpdated, firstTime)

  const {feeds} = deployment
  await feeds.addMarket(MARKET_STR)

  const decimals = await feeds.decimals.call()
  const initialPriceBN = toContractBigNumber(initialPrice, decimals)
  await feeds.push(MARKET_ID, initialPriceBN, nowSecs(), {
    from: configUpdated.daemonAccountAddr
  })

  if (firstTime === true && seedAccounts.length > 0) {
    const tenDAI = web3.toBigNumber('1e18').times(10)
    await Promise.all(
      seedAccounts.map(acc =>
        daiToken.transfer(acc, tenDAI, {
          from: configUpdated.ownerAccountAddr
        })
      )
    )
  }

  return Object.assign({}, deployment, {
    marketId: MARKET_ID,
    decimals
  })
}

export {deployAllForTest, deployMockDAIToken}
