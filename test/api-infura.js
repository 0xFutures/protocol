import {assert} from 'chai'
import BigNumber from 'bignumber.js'

import * as Utils from 'web3-utils'

import API from '../src/infura/api-infura'
import {toContractBigNumber, fromContractBigNumber} from '../src/infura/utils'

import {assertEqualBN} from './helpers/assert'
import {deployAllForTest} from './helpers/deploy'
import {config as configBase, web3} from './helpers/setup'

const marketStr = 'Poloniex_ETH_USD'
const marketId = '0x' + Utils.sha3(marketStr)
const price = '967.00239'
const read = new BigNumber(price)
const ts = Date.now()

describe('api-infura.js', function () {
  let readBN
  let decimals
  let feeds

  let api

  before(done => {

    web3.eth.getAccounts().then((err, accounts) => {
      console.log(accounts)
    })

    /*web3.eth.getAccounts().then(async (err, accounts) => {

      console.log(err)
      console.log(accounts)

      if (err) {
        console.log(err)
        process.exit(-1)
      }

      // eslint-disable-next-line no-extra-semi
      ; ({feeds, decimals} = await deployAllForTest(
        {
          web3,
          initialPrice: price
        }
      ))

      const config = Object.assign({}, configBase)
      config.feedContractAddr = feeds.address

      console.log(config)

      api = await API.newInstance(config, web3)
      readBN = toContractBigNumber(read, decimals)

      done()
    })*/
  })

  it('push() converts input values before sending to contract', async () => {
    // mock the contract push() call to resolve with it's inputs
    api.feeds.push = (idBytes, readBN, ts) => {
      return Promise.resolve([idBytes, readBN, ts])
    }
    const pushParams = await api.push(marketStr, read, ts)

    assert.equal(
      pushParams[0],
      marketId,
      `should have sent bytes32 sha3 of the market str`
    )
    // read value should be a BigNumber and adjusted a number of decimals places
    assertEqualBN(new BigNumber(pushParams[1]), readBN)
    assert.equal(pushParams[2], ts, `timestamp should be sent unchanged`)
  })

  it('push() handles number with up to 30 decimal places', async () => {
    const read = new BigNumber('19.40013238650340567447848975746')
    api.feeds.push = (idBytes, read, ts) => {
      return Promise.resolve([idBytes, read, ts])
    }
    const pushParams = await api.push(marketStr, read, ts)
    assertEqualBN(
      fromContractBigNumber(new BigNumber(pushParams[1]), decimals),
      read
    )
  })

  it('read() converts response values back to useable formats', async () => {
    // mock the contract read() call to resolve with some read data
    api.feeds.read = {
      call: () => Promise.resolve([readBN, web3.utils.toBigNumber(ts)])
    }

    const {read: rspRead, ts: rspTs} = await api.read(marketStr)

    // read response should have been converted back to original form
    assertEqualBN(rspRead, read)
    assert.equal(rspTs, ts, `timestamp should be return unchanged`)
  })

  it('getMarkets() fetchs ALL markets', done =>
    api.getMarkets(
      markets => {
        assert.equal(markets.length, 1)
        assert.equal(markets[0].strId, marketStr)
        assert.equal(markets[0].bytesId, marketId)
        assert.isTrue(markets[0].active)
        done()
      },
      err => assert.fail(`unexpected error: ${err}`)
    ))

  it('watchPushEvents() captures events and sends to callback')
})
