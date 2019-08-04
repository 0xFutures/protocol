import { assert } from 'chai'
import * as Utils from 'web3-utils'

import {
  priceFeedsInstance,
  priceFeedsKyberInstance
} from '../../src/infura/contracts'
import { deployRegistry } from '../../src/infura/deploy'
import { assertEqualBN } from '../helpers/assert'
import { deployMocks } from '../helpers/deploy'
import { EthDaiMarketStr, KyberNativeEthAddress, DefaultERC20Decimals } from '../helpers/kyber'
import { config, web3 } from '../helpers/setup'

const EthDaiMarket = {
  name: EthDaiMarketStr,
  id: Utils.sha3(EthDaiMarketStr),
  tokenAddress: KyberNativeEthAddress,
  tokenAddressTo: undefined // added at create
}

describe('PriceFeeds', function () {
  const PriceFeeds = priceFeedsInstance(web3.currentProvider, config)
  const PriceFeedsKyber = priceFeedsKyberInstance(web3.currentProvider, config)

  let pfkContract
  let pfContract
  let kyberNetworkProxy

  beforeEach(async () => {
    const mocks = await deployMocks(web3, config)
    kyberNetworkProxy = mocks.kyberNetworkProxy
    EthDaiMarket.tokenAddressTo = mocks.daiToken.options.address

    const newConfig = Object.assign({}, config)
    newConfig.daiTokenAddr = EthDaiMarket.tokenAddressTo
    newConfig.feeds.kyber.kyberNetworkProxyAddr = kyberNetworkProxy.options.address
    const deployRsp = await deployRegistry(web3, newConfig, () => { })
    const registry = deployRsp.registry

    // PriceFeedsKyber contract
    pfkContract = await PriceFeedsKyber.deploy({
      arguments: [registry.options.address]
    }).send()
    await pfkContract.methods
      .addMarket(EthDaiMarket.name, EthDaiMarket.tokenAddress, EthDaiMarket.tokenAddressTo, DefaultERC20Decimals)
      .send()

    // PriceFeeds contract
    pfContract = await PriceFeeds.deploy({
      arguments: [pfkContract.options.address]
    }).send()
  })

  const REVERT_MESSAGE =
    `Returned error: ` + `VM Exception while processing transaction: revert`
  const INACTIVE_MARKET_MESSAGE = `Price requested for inactive or unknown market`
  const ZERO_VALUE_MESSAGE = `Market price is zero`

  const assertReverts = async (feedContract, fnName, marketId, expectedMsg) => {
    try {
      await feedContract.methods[fnName](marketId).call()
      assert.fail(`expected reject - ${expectedMsg}`)
    } catch (err) {
      assert.equal(
        err.message,
        `${REVERT_MESSAGE} ${expectedMsg}`,
        'revert message unexpected'
      )
    }
  }

  describe('read', () => {
    it('kyber ok', async () => {
      assertEqualBN(
        await pfContract.methods.read(EthDaiMarket.id).call(),
        await kyberNetworkProxy.methods.rates(EthDaiMarket.tokenAddressTo).call(),
        'read() value for kyber market wrong'
      )
    })

    it('market not active reverts', async () => {
      await assertReverts(
        pfContract,
        'read',
        Utils.sha3('not_an_active_market'),
        INACTIVE_MARKET_MESSAGE
      )
    })

    describe('market zero value reverts', () => {
      it('kyber', async () => {
        await kyberNetworkProxy.methods
          .put(EthDaiMarket.tokenAddressTo, '0x0')
          .send()
        await assertReverts(
          pfContract,
          'read',
          EthDaiMarket.id,
          ZERO_VALUE_MESSAGE
        )
      })
    })
  })

  describe('marketName', () => {
    it('kyber ok', async () => {
      assert.equal(
        await pfContract.methods.marketName(EthDaiMarket.id).call(),
        EthDaiMarket.name,
        'marketName() value for kyber ETH DAI market wrong'
      )
    })

    it('market not active reverts', async () => {
      await assertReverts(
        pfContract,
        'marketName',
        Utils.sha3('not_an_active_market'),
        INACTIVE_MARKET_MESSAGE
      )
    })
  })

  describe('isMarketActive', () => {
    it('kyber active', async () => {
      assert(
        await pfContract.methods.isMarketActive(EthDaiMarket.id).call(),
        'isMarketActive() should return true for kyber market'
      )
    })

    it('market not active', async () => {
      assert.isFalse(
        await pfContract.methods
          .isMarketActive(Utils.sha3('not_an_active_market'))
          .call(),
        'isMarketActive() should return false'
      )
    })
  })
})
