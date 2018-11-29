import {assert} from 'chai'
import {feedsInstance} from '../src/contracts'
import {fromContractBigNumber, toContractBigNumber} from '../src/utils'
import {assertEqualBN} from './helpers/assert'
import {config, web3} from './helpers/setup'

describe('Feeds', function () {
  const Feeds = feedsInstance(web3.currentProvider, config)

  const MARKET1_STR = 'Poloniex_USD_ETH'
  const MARKET1_ID = web3.sha3(MARKET1_STR)

  const MARKET2_STR = 'Poloniex_BTC_ETH'
  const MARKET2_ID = web3.sha3(MARKET2_STR)

  const OWNER_ACCOUNT = config.ownerAccountAddr
  const DAEMON_ACCOUNT = config.daemonAccountAddr

  const FEED_VALUE = 11.8209

  let feedValueAdjusted
  let decimals // num of decimal places for values as fixed in the contract

  let feedContract

  beforeEach(async () => {
    // setup instance of contracts before each test
    feedContract = await Feeds.new({from: OWNER_ACCOUNT, gas: 2000000})
    await feedContract.setDaemonAccount(DAEMON_ACCOUNT)
    await feedContract.addMarket(MARKET1_STR)

    // set decimals and value adjusted firstime only
    if (!decimals) {
      decimals = await feedContract.decimals.call()
      feedValueAdjusted = toContractBigNumber(FEED_VALUE, decimals)
    }
  })

  it('supports adding and removing markets', async () => {
    const feeds = await Feeds.new()

    assert.isFalse(await feeds.isMarketActive.call(MARKET1_ID))
    assert.isFalse(await feeds.isMarketActive.call(MARKET2_ID))

    const addTx1 = await feeds.addMarket(MARKET1_STR)
    assert.equal(addTx1.logs[0].args.bytesId, MARKET1_ID)
    assert.equal(addTx1.logs[0].args.strId, MARKET1_STR)

    const addTx2 = await feeds.addMarket(MARKET2_STR)
    assert.equal(addTx2.logs[0].args.bytesId, MARKET2_ID)
    assert.equal(addTx2.logs[0].args.strId, MARKET2_STR)

    assert.equal(await feeds.marketNames.call(MARKET1_ID), MARKET1_STR)
    assert.equal(await feeds.marketNames.call(MARKET2_ID), MARKET2_STR)

    assert.isTrue(await feeds.isMarketActive.call(MARKET1_ID))
    assert.isTrue(await feeds.isMarketActive.call(MARKET2_ID))
  })

  it('push() should save pushed values to the contract', async () => {
    const timestamp = Date.now()
    await feedContract.push(MARKET1_ID, feedValueAdjusted, timestamp, {
      from: DAEMON_ACCOUNT
    })
    // console.log(`gasused: ${txGas(txRec)}`)
    const rsp = await feedContract.read.call(MARKET1_ID, {
      from: DAEMON_ACCOUNT
    })
    assertEqualBN(rsp[0], feedValueAdjusted, "value doesn't match")
    assertEqualBN(rsp[1], timestamp, "timestamp doesn't match")
    assert.equal(
      fromContractBigNumber(rsp[0], decimals),
      FEED_VALUE,
      "value adjusted back to float doesn't match"
    )
  })
})
