import { assert } from 'chai'
import * as Utils from 'web3-utils'

import API from '../src/infura/api-infura'

import { deployAllForTest } from './helpers/deploy'
import { config as configBase, web3 } from './helpers/setup'
import { KyberNativeEthAddress } from './helpers/kyber'

const priceKyberDAI = '456.99'

describe('api.js', function() {
  let priceFeeds
  let priceFeedsKyber

  let markets
  let marketNames
  let api

  before(done => {
    web3.eth
      .getAccounts()
      .then(async accounts => {
        // eslint-disable-next-line no-extra-semi
        ;({
          markets,
          marketNames,
          priceFeeds,
          priceFeedsKyber
        } = await deployAllForTest({
          web3,
          initialPriceKyberDAI: priceKyberDAI,
          seedAccounts: accounts
        }))

        const config = Object.assign({}, configBase)
        config.priceFeedsContractAddr = priceFeeds.options.address
        config.priceFeedsKyberContractAddr = priceFeedsKyber.options.address
        api = await API.newInstance(config, web3, config.daemonPrivateKey)

        done()
      })
      .catch(err => {
        console.log(err)
        process.exit(-1)
      })
  })

  it('read() kyber market', async () => {
    // price pushed on in deployAllForTest setup above
    const price = await api.read(marketNames.kyberEthDai)
    assert.equal(
      price,
      priceKyberDAI.toString(),
      `kyber read value doesn't match`
    )
  })

  it('getMarketsKyber() fetchs all kyber markets', done => {
    api.getMarketsKyber(marketsArr => {
      assert.equal(marketsArr.length, 1, `Wrong number of markets`)

      assert.equal(
        marketsArr[0].strId,
        marketNames.kyberEthDai,
        `Wrong market str`
      )
      assert.equal(
        marketsArr[0].bytesId,
        markets[marketNames.kyberEthDai],
        `Wrong market ID`
      )
      assert.isTrue(marketsArr[0].active, `Market should be active`)

      done()
    })
  })

  it('addMarketKyber()', async () => {
    const newMarketStr = 'ETH/MKR'
    const tokenAddr = Utils.randomHex(20)
    const txRsp = await api.addMarketKyber(newMarketStr, KyberNativeEthAddress, tokenAddr)
    assert(txRsp.events.hasOwnProperty('LogPriceFeedsKyberMarketAdded'))
  })
})
