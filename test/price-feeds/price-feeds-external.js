import { assert } from 'chai'
import * as Utils from 'web3-utils'

import { ethUsdMakerInstance, priceFeedsExternalInstance } from '../../src/infura/contracts'
import { getFunctionSignature, toContractBigNumber } from '../../src/infura/utils'
import { assertEqualBN } from '../helpers/assert'
import { mockMakerPut } from '../helpers/deploy'
import { config, web3 } from '../helpers/setup'

const EthUsdMakerABI = require('../../build/contracts/EthUsdMakerInterface.json').abi
const EthUsdMakerContract = new web3.eth.Contract(EthUsdMakerABI)

const MakerMarketStr = 'MakerDAO_USD_ETH'
const EtherexMarketStr = 'Etherex_BTC_ETH'

const MakerMarket = {
  name: MakerMarketStr,
  id: Utils.sha3(MakerMarketStr),
  address: undefined, // added when deployed below
  callSig: getFunctionSignature(EthUsdMakerContract, 'read')
}

const EtherexMarket = {
  name: EtherexMarketStr,
  id: Utils.sha3(EtherexMarketStr),
  address: Utils.randomHex(20), // stub fake address - tests don't call this one
  callSig: Utils.randomHex(4) // stub call sig - tests don't call it
}

const addMarket = (feedsContract, market) =>
  feedsContract.methods.addMarket(
    market.name,
    market.address,
    market.callSig
  ).send();

describe('PriceFeedsExternal', function () {
  const PriceFeedsExternal = priceFeedsExternalInstance(web3.currentProvider, config)
  const EthUsdMakerMock = ethUsdMakerInstance(web3.currentProvider, config)

  const OWNER_ACCOUNT = config.ownerAccountAddr

  const makerValueStr = '164.625'
  const makerValueContract = toContractBigNumber(makerValueStr)

  const txOpts = { from: OWNER_ACCOUNT, gas: 2000000 }

  let feedContract
  let ethUsdMakerContract

  beforeEach(async () => {
    // create the mock Maker price contract
    ethUsdMakerContract = await EthUsdMakerMock.deploy({}).send(txOpts)
    MakerMarket.address = ethUsdMakerContract.options.address
    // push a price on
    await mockMakerPut(ethUsdMakerContract, makerValueStr)
  })

  describe('read', () => {
    beforeEach(async () => {
      feedContract = await PriceFeedsExternal.deploy({}).send(txOpts)
    })

    it('value ok', async () => {
      await addMarket(feedContract, MakerMarket)
      assertEqualBN(
        await feedContract.methods.read(MakerMarket.id).call(),
        makerValueContract,
        'read() value wrong'
      )
    })

    const assertReadReverts = async (feedContract, marketId) => {
      const REVERT_MESSAGE = 'Returned error: VM Exception while processing transaction: revert'
      try {
        await feedContract.methods.read(marketId).call(),
          assert.fail('expected reject')
      } catch (err) {
        assert.equal(REVERT_MESSAGE, err.message)
      }
    }

    it('market not active reverts (not in feeds contract)', () =>
      assertReadReverts(feedContract, MakerMarket.id))

    it('market zero value reverts', async () => {
      await mockMakerPut(ethUsdMakerContract, '0')
      assertReadReverts(feedContract, MakerMarket.id)
    })
  })

  it('supports adding and removing markets', async () => {
    const feeds = await PriceFeedsExternal.deploy({}).send();

    assert.isFalse(await feeds.methods.isMarketActive(MakerMarket.id).call())
    assert.isFalse(await feeds.methods.isMarketActive(EtherexMarket.id).call())

    const addTx1 = await addMarket(feeds, MakerMarket)
    const tx1BytesId = addTx1.events.LogPriceFeedsExternalMarketAdded.raw.topics[1];
    assert.equal(tx1BytesId, MakerMarket.id)
    assert.equal(await feeds.methods.marketNames(tx1BytesId).call(), MakerMarket.name)

    const addTx2 = await addMarket(feeds, EtherexMarket)
    const tx2BytesId = addTx2.events.LogPriceFeedsExternalMarketAdded.raw.topics[1];
    assert.equal(tx2BytesId, EtherexMarket.id)
    assert.equal(await feeds.methods.marketNames(tx2BytesId).call(), EtherexMarket.name)

    assert.isTrue(await feeds.methods.isMarketActive(MakerMarket.id).call())
    assert.isTrue(await feeds.methods.isMarketActive(EtherexMarket.id).call())
  })

})
