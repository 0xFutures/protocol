import { assert } from 'chai'
import * as Utils from 'web3-utils'

import API from '../src/infura/api-infura'

import { deployAllForTest } from './helpers/deploy'
import { config as configBase, web3 } from './helpers/setup'

const priceInternal = '77.00239'
const priceExternal = '456.99'

describe.only('api-infura.js', function () {
  let priceFeeds
  let priceFeedsInternal
  let priceFeedsExternal

  let markets
  let marketNames
  let api

  before(done => {
    web3.eth.getAccounts().then(async (accounts) => {

      // eslint-disable-next-line no-extra-semi
      ; ({
        markets,
        marketNames,
        priceFeeds,
        priceFeedsInternal,
        priceFeedsExternal
      } = await deployAllForTest(
        {
          web3,
          initialPriceInternal: priceInternal,
          initialPriceExternal: priceExternal,
          seedAccounts: accounts
        }
      ))

      const config = Object.assign({}, configBase)
      config.priceFeedsContractAddr = priceFeeds.options.address
      config.priceFeedsInternalContractAddr = priceFeedsInternal.options.address
      config.priceFeedsExternalContractAddr = priceFeedsExternal.options.address
      api = await API.newInstance(config, web3, config.daemonPrivateKey)

      done()
    }).catch((err) => {
      console.log(err)
      process.exit(-1)
    })
  })

  it('read() external market', async () => {
    // price pushed on in deployAllForTest setup above
    const price = await api.read(marketNames.makerEthUsd)
    assert.equal(price, priceExternal.toString(), `external read value doesn't match`)
  })

  it('read() internal market', async () => {
    // price pushed on in deployAllForTest setup above
    const price = await api.read(marketNames.poloniexEthUsd)
    assert.equal(price, priceInternal.toString(), `internal read value doesn't match`)
  })

  it('push()', async () => {
    const newPrice = '20000.5'
    const readTs = Date.now()

    const receipt = await api.push(marketNames.poloniexBtcUsd, newPrice, readTs)
    assert.equal(receipt.status, true, `transaction failed`)

    const priceRsp = await api.read(marketNames.poloniexBtcUsd)
    assert.equal(priceRsp.toString(), newPrice, `new price on chain`)
  })

  it('getMarketsInternal() fetchs all internal markets', done => {
    api.getMarketsInternal(marketsArr => {
      assert.equal(marketsArr.length, 2, `Wrong number of markets`)

      assert.equal(marketsArr[0].strId, marketNames.poloniexEthUsd, `Wrong market str`)
      assert.equal(marketsArr[0].bytesId, markets[marketNames.poloniexEthUsd], `Wrong market ID`)
      assert.isTrue(marketsArr[0].active, `Market should be active`)

      assert.equal(marketsArr[1].strId, marketNames.poloniexBtcUsd, `Wrong market str`)
      assert.equal(marketsArr[1].bytesId, markets[marketNames.poloniexBtcUsd], `Wrong market ID`)
      assert.isTrue(marketsArr[1].active, `Market should be active`)

      done()
    })
  })

  it('getMarketsExternal() fetchs all external markets', done => {
    api.getMarketsExternal(marketsArr => {
      assert.equal(marketsArr.length, 1, `Wrong number of markets`)

      assert.equal(marketsArr[0].strId, marketNames.makerEthUsd, `Wrong market str`)
      assert.equal(marketsArr[0].bytesId, markets[marketNames.makerEthUsd], `Wrong market ID`)
      assert.isTrue(marketsArr[0].active, `Market should be active`)

      done()
    })
  })

  it('addMarketInternal()', async () => {
    const newMarket = 'Binance_XLM_ETH'
    const txRsp = await api.addMarketInternal(newMarket)
    assert(txRsp.events.hasOwnProperty('LogPriceFeedsInternalMarketAdded'))
  })

  it('addMarketExternal()', async () => {
    const newMarketStr = 'Etherex_XLM_ETH'
    const newMarketAddr = Utils.randomHex(20)
    const newMarketCallSig = Utils.randomHex(4)
    const txRsp = await api.addMarketExternal(newMarketStr, newMarketAddr, newMarketCallSig)
    assert(txRsp.events.hasOwnProperty('LogPriceFeedsExternalMarketAdded'))
  })

})
