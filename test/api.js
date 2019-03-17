import {assert} from 'chai'
import BigNumber from 'bignumber.js'

import * as Utils from 'web3-utils'

import API from '../src/infura/api-infura'
import {toContractBigNumber, fromContractBigNumber} from '../src/infura/utils'

import {assertEqualBN} from './helpers/assert'
import {deployAllForTest} from './helpers/deploy'
import {config as configBase, web3} from './helpers/setup'

const marketStr = 'Poloniex_ETH_USD'
const marketId = Utils.sha3(marketStr)
const price = '77.00239'
const read = new BigNumber(price)
const ts = Date.now()
const marketStr2 = 'Poloniex_BTC_USD'
const marketId2 = Utils.sha3(marketStr2)

describe('api-infura.js', function () {
  let readBN
  let decimals
  let feeds

  let api

  before(done => {
    web3.eth.getAccounts().then(async (accounts) => {

      // eslint-disable-next-line no-extra-semi
      ; ({feeds, decimals} = await deployAllForTest(
        {
          web3,
          initialPrice: price,
          seedAccounts: accounts
        }
      ))

      const config = Object.assign({}, configBase)
      config.feedContractAddr = feeds.options.address

      api = await API.newInstance(config, web3, config.daemonPrivateKey)
      readBN = toContractBigNumber(read, decimals)

      done()
    }).catch((err) => {
    	console.log(err)
      process.exit(-1)
    })
  })

  it('push() handles number with up to 30 decimal places', async () => {
    const read = new BigNumber('19.40013238650340567447848975746')
    const receipt = await api.push(marketStr, read, ts)
    assert.equal(receipt.status, true, `transaction failed`)
  })

  it('regular push()', async () => {
    const receipt = await api.push(marketStr, read, ts)
    assert.equal(receipt.status, true, `transaction failed`)
  })

  it('read() converts response values back to useable formats', async () => {
    const res = await api.read(marketStr)
    assert.equal(fromContractBigNumber(res.value, decimals).toString(), read, `value should be return unchanged`)
    assert.equal(res.timestamp, ts, `timestamp should be return unchanged`)
  })

  it('getMarkets() fetchs ALL markets', done =>
    api.getMarkets(
      markets => {
        assert.equal(markets.length, 2, `Wrong number of markets`)
        assert.equal(markets[0].strId, marketStr, `Wrong market str`)
        assert.equal(markets[0].bytesId, marketId, `Wrong market ID`)
        assert.isTrue(markets[0].active, `Market should be active`)
        assert.equal(markets[1].strId, marketStr2, `Wrong market str`)
        assert.equal(markets[1].bytesId, marketId2, `Wrong market ID`)
        assert.isTrue(markets[1].active, `Market should be active`)
        done()
      },
      err => assert.fail(`unexpected error: ${err}`)
    ))

})
