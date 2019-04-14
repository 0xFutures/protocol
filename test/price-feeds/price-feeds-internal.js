import { assert } from 'chai'
import * as Utils from 'web3-utils'
import { priceFeedsInternalInstance } from '../../src/infura/contracts'
import { fromContractBigNumber, toContractBigNumber } from '../../src/infura/utils'
import { config, web3 } from '../helpers/setup'

describe('PriceFeedsInternal', function () {
  const PriceFeedsInternal = priceFeedsInternalInstance(web3.currentProvider, config)

  const MARKET1_STR = 'Poloniex_USD_ETH'
  const MARKET1_ID = Utils.sha3(MARKET1_STR)

  const MARKET2_STR = 'Poloniex_BTC_ETH'
  const MARKET2_ID = Utils.sha3(MARKET2_STR)

  const OWNER_ACCOUNT = config.ownerAccountAddr
  const DAEMON_ACCOUNT = config.daemonAccountAddr

  const FEED_VALUE = 11.8209

  let feedValueAdjusted

  let feedContract

  beforeEach(async () => {
    // setup instance of contracts before each test
    feedContract = await PriceFeedsInternal.deploy({}).send({
      from: OWNER_ACCOUNT,
      gas: 2000000
    })
    await feedContract.methods.setDaemonAccount(DAEMON_ACCOUNT).send();
    await feedContract.methods.addMarket(MARKET1_STR).send();
    feedValueAdjusted = toContractBigNumber(FEED_VALUE)
  })

  it('supports adding and removing markets', async () => {
    const feeds = await PriceFeedsInternal.deploy({}).send();

    assert.isFalse(await feeds.methods.isMarketActive(MARKET1_ID).call())
    assert.isFalse(await feeds.methods.isMarketActive(MARKET2_ID).call())

    const addTx1 = await feeds.methods.addMarket(MARKET1_STR).send();
    const tx1BytesId = addTx1.events.LogPriceFeedsInternalMarketAdded.raw.topics[1];
    assert.equal(tx1BytesId, MARKET1_ID)
    assert.equal(await feeds.methods.marketNames(tx1BytesId).call(), MARKET1_STR)

    const addTx2 = await feeds.methods.addMarket(MARKET2_STR).send()
    const tx2BytesId = addTx2.events.LogPriceFeedsInternalMarketAdded.raw.topics[1];
    assert.equal(tx2BytesId, MARKET2_ID)
    assert.equal(await feeds.methods.marketNames(tx2BytesId).call(), MARKET2_STR)

    assert.equal(await feeds.methods.marketNames(MARKET1_ID).call(), MARKET1_STR)
    assert.equal(await feeds.methods.marketNames(MARKET2_ID).call(), MARKET2_STR)

    assert.isTrue(await feeds.methods.isMarketActive(MARKET1_ID).call())
    assert.isTrue(await feeds.methods.isMarketActive(MARKET2_ID).call())
  })

  it('push() should save pushed values to the contract', async () => {
    const timestamp = Date.now()
    await feedContract.methods.push(MARKET1_ID, feedValueAdjusted.toFixed(), timestamp).send({
      from: DAEMON_ACCOUNT
    })
    // console.log(`gasused: ${txGas(txRec)}`)
    const rsp = await feedContract.methods.read(MARKET1_ID).call({
      from: DAEMON_ACCOUNT
    })
    assert.equal(rsp[0], feedValueAdjusted.toFixed(), "value doesn't match")
    assert.equal(rsp[1], timestamp, "timestamp doesn't match")
    assert.equal(
      fromContractBigNumber(rsp[0]),
      FEED_VALUE,
      "value adjusted back to float doesn't match"
    )
  })
})
