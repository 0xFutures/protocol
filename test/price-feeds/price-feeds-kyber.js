import { assert } from 'chai'
import * as Utils from 'web3-utils'

import {
  kyberNetworkInstance,
  priceFeedsKyberInstance
} from '../../src/infura/contracts'
import { toContractBigNumber } from '../../src/infura/utils'
import { assertEqualBN } from '../helpers/assert'
import {
  EthDaiMarketStr,
  EthWbtcMarketStr,
  KyberNativeEthAddress,
  mockKyberPut
} from '../helpers/kyber'
import { config, web3 } from '../helpers/setup'

const EthDaiMarket = {
  name: EthDaiMarketStr,
  id: Utils.sha3(EthDaiMarketStr),
  tokenAddress: Utils.randomHex(20) // stub fake address - KyberNetwork doesn't call through to token
}

const EthWbtcMarket = {
  name: EthWbtcMarketStr,
  id: Utils.sha3(EthWbtcMarketStr),
  tokenAddress: Utils.randomHex(20) // stub fake address - KyberNetwork doesn't call through to token
}

const addMarket = (feedsContract, market) =>
  feedsContract.methods.addMarket(market.name, market.tokenAddress).send()

describe('PriceFeedsKyber', function() {
  const PriceFeedsKyber = priceFeedsKyberInstance(web3.currentProvider, config)
  const KyberNetworkMock = kyberNetworkInstance(web3.currentProvider, config)

  const OWNER_ACCOUNT = config.ownerAccountAddr

  const marketValueStr = '164.625'
  const marketValueContract = toContractBigNumber(marketValueStr)

  const txOpts = { from: OWNER_ACCOUNT, gas: 2000000 }

  let feedContract
  let kyberNetworkContract

  beforeEach(async () => {
    // create the mock KyberNetwork contract
    kyberNetworkContract = await KyberNetworkMock.deploy({}).send(txOpts)
    // push a price on for ETH_DAI
    await mockKyberPut(
      kyberNetworkContract,
      EthDaiMarket.tokenAddress,
      marketValueStr
    )
  })

  describe('read', () => {
    beforeEach(async () => {
      feedContract = await PriceFeedsKyber.deploy({
        arguments: [kyberNetworkContract.options.address]
      }).send(txOpts)
    })

    it('value ok', async () => {
      await addMarket(feedContract, EthDaiMarket)
      await mockKyberPut(
        kyberNetworkContract,
        EthDaiMarket.tokenAddress,
        marketValueStr
      )
      assertEqualBN(
        await feedContract.methods.read(EthDaiMarket.id).call(),
        marketValueContract,
        'read() value wrong'
      )
    })

    const assertReadReverts = async (feedContract, marketId) => {
      const REVERT_MESSAGE =
        'Returned error: VM Exception while processing transaction: revert'
      try {
        await feedContract.methods.read(marketId).call(),
          assert.fail('expected reject')
      } catch (err) {
        assert.equal(err.message, `${REVERT_MESSAGE} Kyber price call failed`)
      }
    }

    it('market not active reverts (not in feeds contract)', () =>
      assertReadReverts(feedContract, EthDaiMarket.id))

    it('market zero value reverts', async () => {
      await mockKyberPut(kyberNetworkContract, EthDaiMarket.tokenAddress, '0')
      assertReadReverts(feedContract, EthDaiMarket.id)
    })
  })

  it('supports adding and removing markets', async () => {
    const feeds = await PriceFeedsKyber.deploy({
      arguments: [kyberNetworkContract.options.address]
    }).send()

    assert.isFalse(await feeds.methods.isMarketActive(EthDaiMarket.id).call())
    assert.isFalse(await feeds.methods.isMarketActive(EthWbtcMarket.id).call())

    const addTx1 = await addMarket(feeds, EthDaiMarket)
    const tx1BytesId = addTx1.events.LogPriceFeedsKyberMarketAdded.raw.topics[1]
    assert.equal(tx1BytesId, EthDaiMarket.id)
    assert.equal(
      await feeds.methods.marketNames(tx1BytesId).call(),
      EthDaiMarket.name
    )

    const marketDaiDeets = await feeds.methods.getMarket(EthDaiMarket.id).call()
    assert.equal(
      marketDaiDeets.tokenContract.toLowerCase(),
      EthDaiMarket.tokenAddress
    )
    assert.equal(
      marketDaiDeets.encodedCall,
      encodedCall(EthDaiMarket.tokenAddress)
    )

    const addTx2 = await addMarket(feeds, EthWbtcMarket)
    const tx2BytesId = addTx2.events.LogPriceFeedsKyberMarketAdded.raw.topics[1]
    assert.equal(tx2BytesId, EthWbtcMarket.id)
    assert.equal(
      await feeds.methods.marketNames(tx2BytesId).call(),
      EthWbtcMarket.name
    )

    const marketWbtcDeets = await feeds.methods
      .getMarket(EthWbtcMarket.id)
      .call()
    assert.equal(
      marketWbtcDeets.tokenContract.toLowerCase(),
      EthWbtcMarket.tokenAddress
    )
    assert.equal(
      marketWbtcDeets.encodedCall,
      encodedCall(EthWbtcMarket.tokenAddress)
    )

    assert.isTrue(await feeds.methods.isMarketActive(EthDaiMarket.id).call())
    assert.isTrue(await feeds.methods.isMarketActive(EthWbtcMarket.id).call())
  })

  const encodedCall = tokenAddress =>
    kyberNetworkContract.methods
      .getExpectedRateOnlyPermission(
        KyberNativeEthAddress,
        tokenAddress,
        web3.utils.toWei(web3.utils.toBN(1), 'ether').toString()
      )
      .encodeABI()
})
