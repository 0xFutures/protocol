import sha3 from 'web3/lib/utils/sha3'

import configTest from '../../config.test.json'
import { deployAll } from '../../src/deploy'
import { nowSecs, toContractBigNumber } from '../../src/utils'

// default market for testing
const MARKET_STR = 'Poloniex_ETH_USD'
const MARKET_ID = '0x' + sha3(MARKET_STR)

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
  const deployment = await deployAll(web3, config, firstTime)

  const { daiToken, feeds } = deployment

  await feeds.addMarket(MARKET_STR)

  const decimals = await feeds.decimals.call()
  const initialPriceBN = toContractBigNumber(initialPrice, decimals)
  await feeds.push(MARKET_ID, initialPriceBN, nowSecs(), {
    from: config.daemonAccountAddr
  })

  if (firstTime === true && seedAccounts.length > 0) {
    const tenDAI = web3.toBigNumber('1e18').times(10)
    await Promise.all(
      seedAccounts.map(acc =>
        daiToken.transfer(acc, tenDAI, {
          from: config.ownerAccountAddr
        })
      )
    )
  }

  return Object.assign({}, deployment, {
    marketId: MARKET_ID,
    decimals
  })
}

export { deployAllForTest }
