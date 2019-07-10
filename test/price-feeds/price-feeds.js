import { assert } from 'chai'
import * as Utils from 'web3-utils'

import {
  kyberNetworkProxyInstance,
  priceFeedsInstance,
  priceFeedsKyberInstance
} from '../../src/infura/contracts'
import { toContractBigNumber } from '../../src/infura/utils'
import { assertEqualBN } from '../helpers/assert'
import { mockKyberPut } from '../helpers/kyber'
import { config, web3 } from '../helpers/setup'

const EthDaiMarketStr = 'Kyber_ETH_DAI'
const EthWbtcMarketStr = 'Kyber_ETH_WBTC'

const EthDaiMarket = {
  name: EthDaiMarketStr,
  id: Utils.sha3(EthDaiMarketStr),
  tokenAddress: Utils.randomHex(20) // stub fake address - KyberNetworkProxy doesn't call through to token
}

const EthWbtcMarket = {
  name: EthWbtcMarketStr,
  id: Utils.sha3(EthWbtcMarketStr),
  tokenAddress: undefined
}

describe('PriceFeeds', function() {
  const PriceFeeds = priceFeedsInstance(web3.currentProvider, config)
  const PriceFeedsKyber = priceFeedsKyberInstance(web3.currentProvider, config)
  const KyberNetworkProxyMock = kyberNetworkProxyInstance(web3.currentProvider, config)

  const OWNER_ACCOUNT = config.ownerAccountAddr

  const marketValueStr = '164.625'

  const txOpts = { from: OWNER_ACCOUNT, gas: 2000000 }

  let pfkContract
  let pfContract
  let kyberNetworkProxyContract

  beforeEach(async () => {
    kyberNetworkProxyContract = await KyberNetworkProxyMock.deploy({}).send(txOpts)

    // PriceFeedsKyber contract
    pfkContract = await PriceFeedsKyber.deploy({
      arguments: [kyberNetworkProxyContract.options.address]
    }).send(txOpts)

    await pfkContract.methods
      .addMarket(EthDaiMarket.name, EthDaiMarket.tokenAddress)
      .send()

    await mockKyberPut(
      kyberNetworkProxyContract,
      EthDaiMarket.tokenAddress,
      marketValueStr
    )

    // PriceFeeds contract
    pfContract = await PriceFeeds.deploy({
      arguments: [pfkContract.options.address]
    }).send(txOpts)
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
        toContractBigNumber(marketValueStr),
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
        await kyberNetworkProxyContract.methods
          .put(EthDaiMarket.tokenAddress, '0x0')
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
