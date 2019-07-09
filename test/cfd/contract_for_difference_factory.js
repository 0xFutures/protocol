import { assert } from 'chai'
import { BigNumber } from 'bignumber.js'

const {
  getContract,
  cfdInstance,
  cfdFactoryInstance,
  cfdRegistryInstance,
  forwardFactoryInstance
} = require('../../src/infura/contracts')
const { EMPTY_ACCOUNT, logGas } = require('../../src/infura/utils')

const { assertEqualBN } = require('../helpers/assert')
const { deployAllForTest } = require('../helpers/deploy')
const { config, web3 } = require('../helpers/setup')

describe('ContractForDifferenceFactory', function() {
  const ContractForDifference = cfdInstance(web3.currentProvider, config)
  const ContractForDifferenceFactory = cfdFactoryInstance(
    web3.currentProvider,
    config
  )
  const ContractForDifferenceRegistry = cfdRegistryInstance(
    web3.currentProvider,
    config
  )
  const ForwardFactory = forwardFactoryInstance(web3.currentProvider, config)

  const OWNER_ACCOUNT = config.ownerAccountAddr

  const MARKET_STR = 'Kyber_ETH_DAI'
  const MARKET_ID = web3.utils.sha3(MARKET_STR)

  let cfdFactory
  let daiToken
  let registry
  let strikePrice

  before(async () => {
    strikePrice = new BigNumber('800.0')

    let priceFeeds
      // eslint-disable-next-line no-extra-semi
    ;({ priceFeeds, registry, daiToken } = await deployAllForTest({
      web3,
      initialPriceKyberDAI: strikePrice
    }))

    // create the CFD Factory
    const cfdRegistry = await ContractForDifferenceRegistry.deploy({}).send()

    const cfd = await ContractForDifference.deploy({}).send({ gas: 7000000 })
    const ff = await ForwardFactory.deploy({}).send()
    cfdFactory = await ContractForDifferenceFactory.deploy({
      arguments: [
        registry.options.address,
        cfd.options.address,
        ff.options.address,
        priceFeeds.options.address
      ]
    }).send({ gas: 3000000 })

    await Promise.all([
      cfdFactory.methods.setCFDRegistry(cfdRegistry.options.address).send(),
      cfdRegistry.methods.setFactory(cfdFactory.options.address).send(),
      registry.methods.setCFDFactoryLatest(cfdFactory.options.address).send()
    ])
  })

  it('creates a new CFD given valid terms and value', async () => {
    const notionalAmount = new BigNumber('1e18') // 1 DAI
    const initialValue = notionalAmount
    await daiToken.methods
      .approve(cfdFactory.options.address, initialValue.toFixed())
      .send({
        from: OWNER_ACCOUNT
      })

    const txReceipt = await cfdFactory.methods
      .createContract(
        MARKET_ID,
        strikePrice.toFixed(),
        notionalAmount.toFixed(),
        true,
        initialValue.toFixed()
      )
      .send({
        gas: 2500000,
        from: OWNER_ACCOUNT
      })
    logGas(`CFDFactory.createContract`, txReceipt)

    const cfdAddrStr = txReceipt.events.LogCFDFactoryNew.raw.data
    const cfdAddr = '0x' + cfdAddrStr.substr(cfdAddrStr.length - 40)
    const cfd = getContract(cfdAddr, web3)

    assert.equal(
      (await cfd.methods.market().call()).toLowerCase(),
      MARKET_ID.toLowerCase(),
      'market incorrect'
    )
    assert.equal(
      (await cfd.methods.buyer().call()).toLowerCase(),
      OWNER_ACCOUNT.toLowerCase(),
      'buyer incorrect'
    )
    assert.equal(
      (await cfd.methods.seller().call()).toLowerCase(),
      EMPTY_ACCOUNT.toLowerCase(),
      'seller incorrect'
    )
    assertEqualBN(
      await cfd.methods.strikePrice().call(),
      strikePrice,
      'strike price incorrect'
    )
    assertEqualBN(
      await cfd.methods.notionalAmountDai().call(),
      notionalAmount,
      'notionalAmountDai incorrect'
    )
    assertEqualBN(
      await daiToken.methods.balanceOf(cfd.options.address).call(),
      notionalAmount,
      'cfd balance incorrect'
    )
    assert.isFalse(
      await cfd.methods.initiated().call(),
      'should not be initiated'
    )

    assert.equal(
      await cfd.methods.registry().call(),
      await cfdFactory.methods.registry().call(),
      'registry address incorrect'
    )
    assert.equal(
      await cfd.methods.feedsAddr().call(),
      await cfdFactory.methods.feeds().call(),
      'feed address incorrect'
    )
    assert.equal(
      await cfd.methods.cfdRegistryAddr().call(),
      await cfdFactory.methods.cfdRegistry().call(),
      'cfd registry address incorrect'
    )
    assert.equal(
      cfdFactory.options.address,
      await registry.methods.allCFDs(cfd.options.address).call(),
      'registry cfd address does not match the factory'
    )
  })
})
