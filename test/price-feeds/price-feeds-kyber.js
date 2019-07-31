import { assert } from 'chai'
import * as Utils from 'web3-utils'

import {
  priceFeedsKyberInstance
} from '../../src/infura/contracts'
import { deployRegistry } from '../../src/infura/deploy'
import { assertEqualBN } from '../helpers/assert'
import { deployMocks } from '../helpers/deploy'
import {
  EthDaiMarketStr,
  EthWbtcMarketStr,
  KyberNativeEthAddress,
  mockKyberPut,
} from '../helpers/kyber'
import { config, web3 } from '../helpers/setup'

// see PriceFeedsKyber.sol - is used to set the most significant bit
const BITMASK_EXCLUDE_PERMISSIONLESS = new web3.utils.BN(1).shln(255);

const ONE_ETH = web3.utils.toWei(web3.utils.toBN(1), 'ether')

const EthDaiMarket = {
  name: EthDaiMarketStr,
  id: Utils.sha3(EthDaiMarketStr),
  tokenAddress: undefined, // added on create in helper func
  tokenAddressTo: KyberNativeEthAddress
}

const EthWbtcMarket = {
  name: EthWbtcMarketStr,
  id: Utils.sha3(EthWbtcMarketStr),
  tokenAddress: Utils.randomHex(20),
  tokenAddressTo: KyberNativeEthAddress
}

const addMarket = (feedsContract, market) =>
  feedsContract.methods.addMarket(market.name, market.tokenAddress, market.tokenAddressTo).send()

describe('PriceFeedsKyber', function () {
  const PriceFeedsKyber = priceFeedsKyberInstance(web3.currentProvider, config)

  let pfContract
  let kyberNetworkProxy
  let registry

  beforeEach(async () => {
    const mocks = await deployMocks(web3, config)
    kyberNetworkProxy = mocks.kyberNetworkProxy
    EthDaiMarket.tokenAddress = mocks.daiToken.options.address

    const newConfig = Object.assign({}, config)
    newConfig.daiTokenAddr = EthDaiMarket.tokenAddress
    newConfig.feeds.kyber.kyberNetworkProxyAddr = kyberNetworkProxy.options.address

    const deployRsp = await deployRegistry(web3, newConfig, () => { })
    registry = deployRsp.registry
  })

  describe('read', () => {
    beforeEach(async () => {
      pfContract = await PriceFeedsKyber.deploy({
        arguments: [registry.options.address]
      }).send()
    })

    it('value ok', async () => {
      await addMarket(pfContract, EthDaiMarket)
      assertEqualBN(
        await pfContract.methods.read(EthDaiMarket.id).call(),
        await kyberNetworkProxy.methods.rates(EthDaiMarket.tokenAddress).call(),
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
      assertReadReverts(pfContract, EthDaiMarket.id))

    it('market zero value reverts', async () => {
      await mockKyberPut(kyberNetworkProxy, EthDaiMarket.tokenAddress, '0')
      assertReadReverts(pfContract, EthDaiMarket.id)
    })
  })

  it('supports adding and removing markets', async () => {
    const feeds = await PriceFeedsKyber.deploy({
      arguments: [registry.options.address]
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
      marketDaiDeets.tokenContract,
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
    kyberNetworkProxy.methods
      .getExpectedRate(
        KyberNativeEthAddress,
        tokenAddress,
        BITMASK_EXCLUDE_PERMISSIONLESS.or(ONE_ETH).toString()
      )
      .encodeABI()
})
