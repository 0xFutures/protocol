import { assert } from 'chai'

const { creatorFee } = require('../../src/calc')
const {
  cfdInstance,
  cfdFactoryInstance,
  cfdRegistryInstance,
  forwardFactoryInstance
} = require('../../src/contracts')
const { EMPTY_ACCOUNT } = require('../../src/utils')

const { assertEqualBN } = require('../helpers/assert')
const { deployAllForTest } = require('../helpers/deploy')
const { config, web3 } = require('../helpers/setup')

describe('ContractForDifferenceFactory', function () {
  const ContractForDifference = cfdInstance(web3.currentProvider, config)
  const ContractForDifferenceFactory = cfdFactoryInstance(web3.currentProvider, config)
  const ContractForDifferenceRegistry = cfdRegistryInstance(web3.currentProvider, config)
  const ForwardFactory = forwardFactoryInstance(web3.currentProvider, config)

  const OWNER_ACCOUNT = config.ownerAccountAddr

  const MARKET_STR = 'Poloniex_ETH_USD'
  const MARKET_ID = web3.sha3(MARKET_STR)

  let cfdFactory
  let registry
  let strikePrice

  before(async () => {
    strikePrice = web3.toBigNumber('800.0')

    let feeds
      // eslint-disable-next-line no-extra-semi
      ; ({ feeds, registry } = await deployAllForTest({ web3, initialPrice: strikePrice }))

    // create the CFD Factory
    const cfdRegistry = await ContractForDifferenceRegistry.new()

    const cfd = await ContractForDifference.new({ gas: 7000000 })
    const ff = await ForwardFactory.new()
    cfdFactory = await ContractForDifferenceFactory.new(
      registry.address,
      cfd.address,
      ff.address,
      feeds.address,
      { gas: 3000000 }
    )
    await Promise.all([
      cfdFactory.setCFDRegistry(cfdRegistry.address),
      cfdRegistry.setFactory(cfdFactory.address),
      registry.setCFDFactoryLatest(cfdFactory.address)
    ])
  })

  it('creates a new CFD given valid terms and value', async () => {
    const notionalAmount = web3.toWei(web3.toBigNumber(10), 'finney')
    const initialValue = notionalAmount.plus(creatorFee(notionalAmount))
    const txReceipt = await cfdFactory.createContract(
      MARKET_ID,
      strikePrice,
      notionalAmount,
      true,
      {
        gas: 2500000,
        from: OWNER_ACCOUNT,
        value: initialValue
      }
    )

    const cfdAddr = txReceipt.logs[0].args.newCFDAddr
    const cfd = ContractForDifference.at(cfdAddr)

    assert.equal(await cfd.market.call(), MARKET_ID, 'market incorrect')
    assert.equal(await cfd.buyer.call(), OWNER_ACCOUNT, 'buyer incorrect')
    assert.equal(await cfd.seller.call(), EMPTY_ACCOUNT, 'seller incorrect')
    assertEqualBN(
      await cfd.strikePrice.call(),
      strikePrice,
      'strike price incorrect'
    )
    assertEqualBN(
      await cfd.notionalAmountWei.call(),
      notionalAmount,
      'notionalAmountWei incorrect'
    )
    assertEqualBN(
      web3.eth.getBalance(cfd.address),
      notionalAmount.plus(creatorFee(notionalAmount)),
      'cfd balance incorrect'
    )
    assert.isFalse(await cfd.initiated.call(), 'should not be initiated')

    assert.equal(
      await cfd.registry.call(),
      await cfdFactory.registry.call(),
      'registry address incorrect'
    )
    assert.equal(
      await cfd.feedsAddr.call(),
      await cfdFactory.feeds.call(),
      'feed address incorrect'
    )
    assert.equal(
      await cfd.cfdRegistryAddr.call(),
      await cfdFactory.cfdRegistry.call(),
      'cfd registry address incorrect'
    )
    assert.equal(
      cfdFactory.address,
      await registry.allCFDs.call(cfd.address),
      'registry cfd address does not match the factory'
    )
  })
})
