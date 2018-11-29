import { assert } from 'chai'
import sha3 from 'web3/lib/utils/sha3'

import CFDAPI from '../src/cfd-api'
import { joinerFee } from '../src/calc'
import { EMPTY_ACCOUNT, STATUS } from '../src/utils'

import { assertEqualBN, assertStatus } from './helpers/assert'
import { deployAllForTest } from './helpers/deploy'
import { config as configBase, web3 } from './helpers/setup'

const marketStr = 'Poloniex_ETH_USD'
const marketId = sha3(marketStr)
const price = '67.00239'
const newPrice = '42.05832'

// TEST ACCOUNTS (indexes into web3.eth.accounts)
const ACCOUNT_BUYER = 5
const ACCOUNT_SELLER = 6
const ACCOUNT_PARTY = 7
const ACCOUNT_COUNTERPARTY = 8
const ACCOUNT_THIRDPARTY = 9

describe('cfd-api.js', function () {
  let feeds
  let cfdFactory
  let cfdRegistry

  let buyer, seller
  let party, counterparty, thirdParty
  let notionalAmountWei

  let cfdPartyIsBuyer
  let cfdPartyIsSeller
  let cfdTransferToThirdParty
  let cfdLiquidated

  let api

  const leverage = 1 // most tests using leverage 1

  const newCFDInitiated = async (party, counterparty, partyIsBuyer) => {
    const cfd = await api.newCFD(
      marketStr,
      price,
      notionalAmountWei,
      leverage,
      partyIsBuyer,
      party
    )
    const fee = await api.joinFee(cfd)
    await cfd.deposit({
      from: counterparty,
      value: notionalAmountWei.plus(fee),
      gas: 1000000
    })
    return cfd
  }

  before(done => {
    web3.eth.getAccounts(async (err, accounts) => {
      if (err) {
        console.log(err)
        process.exit(-1)
      }

      buyer = accounts[ACCOUNT_BUYER]
      seller = accounts[ACCOUNT_SELLER]
      party = accounts[ACCOUNT_PARTY]
      counterparty = accounts[ACCOUNT_COUNTERPARTY]
      thirdParty = accounts[ACCOUNT_THIRDPARTY]

      // eslint-disable-next-line no-extra-semi
      ; ({ cfdFactory, cfdRegistry, feeds } = await deployAllForTest(
        {
          web3,
          initialPrice: price
        }
      ))

      const config = Object.assign({}, configBase)
      config.feedContractAddr = feeds.address
      config.cfdFactoryContractAddr = cfdFactory.address
      config.cfdRegistryContractAddr = cfdRegistry.address

      notionalAmountWei = web3.toWei(web3.toBigNumber(10), 'finney')

      //
      // Create an instance of the cfd-api
      //
      api = await CFDAPI.newInstance(config, web3)

      //
      // Set accounts and create CFDs for query tests
      //
      cfdPartyIsBuyer = await newCFDInitiated(party, counterparty, true)
      cfdPartyIsSeller = await newCFDInitiated(party, counterparty, false)

      cfdTransferToThirdParty = await newCFDInitiated(party, counterparty, true)
      await api.transferPosition(
        cfdTransferToThirdParty.address,
        party,
        thirdParty
      )

      cfdLiquidated = await newCFDInitiated(party, counterparty, true)

      await cfdLiquidated.forceTerminate({
        from: party,
        gas: 150000
      })

      done()
    })
  })

  it('newCFD creates new contracts', async () => {
    const cfd = await api.newCFD(
      marketStr,
      price,
      notionalAmountWei,
      leverage,
      true,
      buyer
    )
    assert.equal(await cfd.buyer.call(), buyer)
    assert.equal(await cfd.seller.call(), EMPTY_ACCOUNT)
    assertEqualBN(
      await cfd.notionalAmountWei.call(),
      notionalAmountWei,
      'notional'
    )
    assert.equal(await cfd.market.call(), `0x${marketId}`)
  })

  it('change strike price', async () => {
    const cfd = await api.newCFD(
      marketStr,
      price,
      notionalAmountWei,
      leverage,
      true,
      buyer
    )

    await api.changeStrikePriceCFD(cfd.address, buyer, newPrice)

    assertEqualBN(
      web3.fromWei(await cfd.strikePrice.call()),
      web3.toBigNumber(42058320000000),
      'strike price'
    )
  })

  it('deposit joins new party and initiates the contract', async () => {
    const cfd = await api.newCFD(
      marketStr,
      price,
      notionalAmountWei,
      leverage,
      true,
      buyer
    )

    const txRsp = await api.deposit(
      cfd.address,
      counterparty,
      notionalAmountWei
    )

    const tx = await web3.eth.getTransactionAsync(txRsp.tx)
    assertEqualBN(
      tx.value,
      notionalAmountWei.plus(joinerFee(notionalAmountWei)),
      'value is collateral plus fees'
    )

    assert.equal(await cfd.buyer.call(), buyer, 'buyer')
    assert.equal(await cfd.seller.call(), counterparty, 'seller')
    assertEqualBN(
      await cfd.notionalAmountWei.call(),
      notionalAmountWei,
      'notional'
    )
    assert.equal(await cfd.market.call(), `0x${marketId}`)
  })

  it('getCFD gets contract details', async () => {
    const cfd = await api.newCFD(
      marketStr,
      price,
      notionalAmountWei,
      leverage,
      true,
      buyer
    )
    const cfdDetails = await api.getCFD(cfd.address)
    assert.equal(cfdDetails.buyer, buyer)
    assert.equal(cfdDetails.seller, EMPTY_ACCOUNT)
    assertEqualBN(
      await cfd.notionalAmountWei.call(),
      notionalAmountWei,
      'notional'
    )
    assert.equal(cfdDetails.market, marketStr) // translates to string
    assert.isFalse(cfdDetails.liquidated)
  })

  it('getCFD gets liquidated contract details', async () => {
    const cfdDetails = await api.getCFD(cfdLiquidated.address)

    assert.isTrue(cfdDetails.liquidated)
  })

  it('sale flow with sellCFD and buyCFD faciliates a sale', async () => {
    const cfd = await newCFDInitiated(buyer, seller, true)

    await api.sellCFD(cfd.address, buyer, price)
    assert.isTrue(await cfd.buyerSelling.call())
    await assertStatus(cfd, STATUS.SALE)

    await api.buyCFD(cfd.address, thirdParty, notionalAmountWei, true)
    assert.equal(await cfd.buyer.call(), thirdParty)
    await assertStatus(cfd, STATUS.INITIATED)
  })

  describe('contractsForParty', function () {
    const callAndAssert = (party, options, assertFn) =>
      api.contractsForParty(
        party,
        options,
        cfds => assertFn(cfds),
        error => assert.fail(`unexpected error [${error}]`)
      )

    it('returns only current open contracts when default options', done => {
      callAndAssert(party, {}, cfds => {
        assert.equal(cfds.length, 2)
        assert.equal(cfds[0].cfd.address, cfdPartyIsBuyer.address)
        assert.equal(cfds[1].cfd.address, cfdPartyIsSeller.address)
        done()
      })
    })

    it('includes transferred contracts if requested', done => {
      callAndAssert(party, { includeTransferred: true }, cfds => {
        assert.equal(cfds.length, 3)
        assert.equal(cfds[0].cfd.address, cfdPartyIsBuyer.address)
        assert.equal(cfds[1].cfd.address, cfdPartyIsSeller.address)
        assert.equal(cfds[2].cfd.address, cfdTransferToThirdParty.address)
        done()
      })
    })

    it('includes liquidated/closed contracts if requested', done => {
      callAndAssert(party, { includeLiquidated: true }, cfds => {
        assert.equal(cfds.length, 3)
        assert.equal(cfds[0].cfd.address, cfdPartyIsBuyer.address)
        assert.equal(cfds[1].cfd.address, cfdPartyIsSeller.address)
        assert.equal(cfds[2].cfd.address, cfdLiquidated.address)
        done()
      })
    })
  })

  describe('contractsWaitingCounterparty', function () {
    it('returns contracts awaiting a deposit', done => {
      api
        .newCFD(marketStr, price, notionalAmountWei, leverage, true, buyer)
        .then(newCFD =>
          api.contractsWaitingCounterparty(
            { fromBlock: web3.eth.blockNumber },
            cfds => {
              assert.equal(cfds.length, 1)
              assert.equal(cfds[0].cfd.address, newCFD.address)
              done()
            },
            error => assert.fail(`unexpected error [${error}]`)
          )
        )
    })
  })

  // NOTE: this test is writing out an error to STDERR when run from bin/test
  // but not when run from truffle develop (> test). The test still completes
  // properly however so this log message can be ignored for now ..
  // TODO: figure out why it's happening (maybe truffle internal issue)
  describe('contractsForSale', function () {
    it('returns contracts for sale', async () => {
      const cfd = await newCFDInitiated(party, counterparty, true)
      await cfd.sellPrepare(price, 0, {
        from: counterparty,
        value: web3.toWei(4, 'finney'),
        gas: 2100200
      })
      return new Promise((resolve, reject) => {
        api.contractsForSale(
          {},
          cfds => {
            assert.equal(cfds.length, 2) // additional one from the sellCFD test
            assert.equal(cfds[1].cfd.address, cfd.address)
            resolve()
          },
          error => reject(new Error(`unexpected error [${error}]`))
        )
      })
    })
  })
})
