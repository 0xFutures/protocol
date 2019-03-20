import {assert} from 'chai'
import BigNumber from 'bignumber.js'

import * as Utils from 'web3-utils'

import CFDAPI from '../src/infura/cfd-api-infura'
import {EMPTY_ACCOUNT, STATUS} from '../src/infura/utils'

import {assertEqualBN, assertStatus} from './helpers/assert'
import {deployAllForTest} from './helpers/deploy'
import {config as configBase, web3} from './helpers/setup'

const marketStr = 'Poloniex_ETH_USD'
const marketId = Utils.sha3(marketStr)
const price = '67.00239'
const newPrice = '42.05832'
const liquidationPercentage = 95     // Liquidation price is 95% of the strike price

// TEST ACCOUNTS (indexes into web3.eth.accounts)
const ACCOUNT_BUYER = 5
const ACCOUNT_SELLER = 6
const ACCOUNT_PARTY = 7
const ACCOUNT_COUNTERPARTY = 8
const ACCOUNT_THIRDPARTY = 9

describe('cfd-api-infura.js', function () {
  let feeds
  let cfdFactory
  let cfdRegistry
  let daiToken

  let buyer, seller
  let party, counterparty, thirdParty
  let notionalAmountDai
  let decimals

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
      notionalAmountDai,
      leverage,
      partyIsBuyer,
      party
    )
    await api.deposit(cfd.options.address, counterparty, notionalAmountDai)
    return cfd
  }

  before(done => {
    web3.eth.getAccounts().then(async (accounts) => {

      buyer = accounts[ACCOUNT_BUYER]
      seller = accounts[ACCOUNT_SELLER]
      party = accounts[ACCOUNT_PARTY]
      counterparty = accounts[ACCOUNT_COUNTERPARTY]
      thirdParty = accounts[ACCOUNT_THIRDPARTY]

      // eslint-disable-next-line no-extra-semi
      ;({cfdFactory, cfdRegistry, feeds, daiToken} = await deployAllForTest({
        web3,
        initialPrice: price,
        seedAccounts: [buyer, seller, party, counterparty, thirdParty]
      }))

      const config = Object.assign({}, configBase)
      config.feedContractAddr = feeds.options.address
      config.cfdFactoryContractAddr = cfdFactory.options.address
      config.cfdRegistryContractAddr = cfdRegistry.options.address
      config.daiTokenAddr = daiToken.options.address

      notionalAmountDai = new BigNumber('1e18') // 1 DAI
      decimals = await feeds.methods.decimals.call()

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
        cfdTransferToThirdParty.options.address,
        party,
        thirdParty
      )

      cfdLiquidated = await newCFDInitiated(party, counterparty, true)
      await api.forceTerminate(cfdLiquidated.options.address, party)

      done()
    }).catch((err) => {
      console.log(err)
      process.exit(-1)
    })
  })

  
  it('newCFD creates new contracts', async () => {
    const cfd = await api.newCFD(
      marketStr,
      price,
      notionalAmountDai,
      leverage,
      true,
      buyer
    )

    assert.equal(await cfd.methods.buyer().call(), buyer, 'Wrong buyer account')
    assert.equal(await cfd.methods.seller().call(), EMPTY_ACCOUNT, 'Wrong seller account')
    assert.equal(await cfd.methods.notionalAmountDai().call(), notionalAmountDai, 'Wrong notional')
    assert.equal(await cfd.methods.market().call(), `${marketId}`, 'Wrong market ID')

    api.cancelNew(cfd.options.address, buyer)
  })

  it('check cfdPartyIsBuyer contract details', async () => {
    const cfd = await api.getCFD(cfdPartyIsBuyer.options.address);
    const daiUsed = 1;
    const stkPrice = parseFloat(price);
    const buyerLiquidationPrice = new BigNumber(stkPrice - ((stkPrice * liquidationPercentage) / 100)).toFixed(7);

    assert.equal(cfd.details.address, cfdPartyIsBuyer.options.address.toLowerCase(), 'Wrong address value')
    assert.equal(cfd.details.closed, false, 'Wrong closed value')
    assert.equal(cfd.details.status, 1, 'Wrong status value')
    assert.equal(cfd.details.liquidated, false, 'Wrong liquidated value')
    assert.equal(cfd.details.buyer, party.toLowerCase(), 'Wrong buyer value')
    assert.equal(cfd.details.buyerIsSelling, false, 'Wrong buyerIsSelling value')
    assert.equal(cfd.details.market, marketStr, 'Wrong market value')
    assert.equal(cfd.details.notionalAmountDai, daiUsed, 'Wrong notionalAmountDai value')
    assert.equal(cfd.details.buyerInitialNotional, daiUsed, 'Wrong buyerInitialNotional value')
    assert.equal(cfd.details.strikePrice, price, 'Wrong strikePrice value')
    assert.equal(cfd.details.buyerDepositBalance.toFixed(), daiUsed, 'Wrong buyerDepositBalance value')
    assert.equal(cfd.details.buyerInitialStrikePrice, price, 'Wrong buyerInitialStrikePrice value')
    assert.equal(cfd.details.buyerLiquidationPrice.toFixed(), buyerLiquidationPrice, 'Wrong buyerLiquidationPrice value')

  })
  it('check cfdPartyIsSeller contract details', async () => {
    const cfd = await api.getCFD(cfdPartyIsSeller.options.address);
    const daiUsed = 1;
    const stkPrice = parseFloat(price);
    const sellerLiquidationPrice = new BigNumber(stkPrice + ((stkPrice * liquidationPercentage) / 100)).toFixed(7);

    assert.equal(cfd.details.address, cfdPartyIsSeller.options.address.toLowerCase(), 'Wrong address value')
    assert.equal(cfd.details.closed, false, 'Wrong closed value')
    assert.equal(cfd.details.status, 1, 'Wrong status value')
    assert.equal(cfd.details.liquidated, false, 'Wrong liquidated value')
    assert.equal(cfd.details.seller, party.toLowerCase(), 'Wrong seller value')
    assert.equal(cfd.details.sellerIsSelling, false, 'Wrong sellerIsSelling value')
    assert.equal(cfd.details.market, marketStr, 'Wrong market value')
    assert.equal(cfd.details.notionalAmountDai, daiUsed, 'Wrong notionalAmountDai value')
    assert.equal(cfd.details.sellerInitialNotional, daiUsed, 'Wrong sellerInitialNotional value')
    assert.equal(cfd.details.strikePrice, price, 'Wrong strikePrice value')
    assert.equal(cfd.details.sellerDepositBalance.toFixed(), daiUsed, 'Wrong sellerDepositBalance value')
    assert.equal(cfd.details.sellerInitialStrikePrice, price, 'Wrong sellerInitialStrikePrice value')
    assert.equal(cfd.details.sellerLiquidationPrice.toFixed(), sellerLiquidationPrice, 'Wrong sellerLiquidationPrice value')

  })

  it('change strike price', async () => {
    const cfd = await api.newCFD(
      marketStr,
      price,
      notionalAmountDai,
      leverage,
      true,
      buyer
    )

    await api.changeStrikePriceCFD(cfd.options.address, buyer, newPrice)

    const updatedCfd = await api.getCFD(cfd.options.address);

    assert.equal(
      updatedCfd.details.strikePrice,
      newPrice,
      'Wrong strike price'
    )

    api.cancelNew(cfd.options.address, buyer)
  })


  it('deposit joins new party and initiates the contract', async () => {
    const cfd = await api.newCFD(
      marketStr,
      price,
      notionalAmountDai,
      leverage,
      true,
      buyer
    )

    await api.deposit(cfd.options.address, counterparty, notionalAmountDai)

    assert.equal(
      await daiToken.methods.balanceOf(cfd.options.address).call(),
      notionalAmountDai.times(2),
      'Value is combined collateral'
    )
    assert.equal(await cfd.methods.buyer().call(), buyer, 'Wrong buyer account')
    assert.equal(await cfd.methods.seller().call(), counterparty, 'Wrong seller account')
    assert.equal(
      await cfd.methods.notionalAmountDai().call(),
      notionalAmountDai,
      'Wrong notional'
    )
    assert.equal(await cfd.methods.market().call(), `${marketId}`, 'Wrong market ID')

    api.forceTerminate(cfd.options.address, buyer)
  })

  it('getCFD gets contract details', async () => {
    const cfd = await api.newCFD(
      marketStr,
      price,
      notionalAmountDai,
      leverage,
      true,
      buyer
    )

    const cfdDetailed = await api.getCFD(cfd.options.address)

    assert.equal(cfdDetailed.details.buyer, buyer.toLowerCase(), 'Wrong buyer account')
    assert.equal(cfdDetailed.details.seller, EMPTY_ACCOUNT.toLowerCase(), 'Wrong seller account')
    assert.equal(
      await cfd.methods.notionalAmountDai().call(),
      notionalAmountDai,
      'notional'
    )
    assert.equal(cfdDetailed.details.market, marketStr, 'Wrong market string') // translates to string
    assert.isFalse(cfdDetailed.details.liquidated)

    api.cancelNew(cfd.options.address, buyer)
  })

  it('getCFD gets liquidated contract details', async () => {
    const cfdDetailed = await api.getCFD(cfdLiquidated.options.address)

    assert.isTrue(cfdDetailed.details.liquidated)
  })

  it('sale flow with sellCFD and buyCFD faciliates a sale', async () => {
    const cfd = await newCFDInitiated(buyer, seller, true)

    await api.sellCFD(cfd.options.address, buyer, price)
    assert.isTrue(await cfd.methods.buyerSelling().call())
    await assertStatus(cfd, STATUS.SALE)

    await api.buyCFD(cfd.options.address, thirdParty, notionalAmountDai, true)
    assert.equal(await cfd.methods.buyer().call(), thirdParty)
    await assertStatus(cfd, STATUS.INITIATED)
  })


  describe('contractsForParty', function () {
    const callAndAssert = (party, options, assertFn) =>
      api.contractsForParty(party, options)
        .then((cfds) => assertFn(cfds))
        .catch((error) => assert.fail(`unexpected error [${error}]`))

    it('returns only current open contracts when default options', done => {
      callAndAssert(party, {}, cfds => {
        assert.equal(cfds.length, 2)
        assert.equal(cfds[0].details.address.toLowerCase(), cfdPartyIsBuyer.options.address.toLowerCase())
        assert.equal(cfds[1].details.address.toLowerCase(), cfdPartyIsSeller.options.address.toLowerCase())
        done()
      })
    })

    it('includes liquidated/closed contracts if requested', done => {
      callAndAssert(party, {includeLiquidated: true}, cfds => {
        assert.equal(cfds.length, 3)
        assert.equal(cfds[0].details.address.toLowerCase(), cfdPartyIsBuyer.options.address.toLowerCase())
        assert.equal(cfds[1].details.address.toLowerCase(), cfdPartyIsSeller.options.address.toLowerCase())
        assert.equal(cfds[2].details.address.toLowerCase(), cfdLiquidated.options.address.toLowerCase())
        done()
      })
    })
  })

  
  describe('contractsWaitingCounterparty', function () {
    it('returns contracts awaiting a deposit', done => {
      api
        .newCFD(marketStr, price, notionalAmountDai, leverage, true, buyer)
        .then(newCFD => {
          api.contractsWaitingCounterparty({}).then((cfds) => {
            assert.equal(cfds.length, 1)
            assert.equal(cfds[0].details.address.toLowerCase(), newCFD.options.address.toLowerCase())
            done()
          }).catch((error) => assert.fail(`unexpected error [${error}]`))
        })
    })
  })

  // NOTE: this test is writing out an error to STDERR when run from bin/test
  // but not when run from truffle develop (> test). The test still completes
  // properly however so this log message can be ignored for now ..
  // TODO: figure out why it's happening (maybe truffle internal issue)
  describe('contractsForSale', function () {
    it('returns contracts for sale', async () => {
      const cfd = await newCFDInitiated(party, counterparty, true)
      await api.sellCFD(cfd.options.address, counterparty, price)
      return new Promise((resolve, reject) => {
        api.contractsForSale({}).then((cfds) => {
          assert.equal(cfds.length, 1)
          assert.equal(cfds[0].details.address.toLowerCase(), cfd.options.address.toLowerCase())
          resolve()
        }).catch((error) => reject(new Error(`unexpected error [${error}]`)))
      })
    })
  })


  describe('changeSaleCFD', function () {
    it('change sale price for a CFD for sale', async () => {
      const cfd = await newCFDInitiated(buyer, seller, true)

      await api.sellCFD(cfd.options.address, buyer, price)
      assert.isTrue(await cfd.methods.buyerSelling().call())
      await assertStatus(cfd, STATUS.SALE)

      await api.changeSaleCFD(cfd.options.address, buyer, parseFloat(price) * 2)  // Set the sale strike price as double
      const updatedCfd = await api.getCFD(cfd.options.address)

      assert.equal(updatedCfd.details.buyerSaleStrikePrice.toFixed(5), parseFloat(price) * 2, 'Wrong buyerSaleStrikePrice value')
    })
  })

  describe('cancelSale', function () {
    it('cancel a sale for a CFD', async () => {
      const cfd = await newCFDInitiated(buyer, seller, true)

      await api.sellCFD(cfd.options.address, buyer, price)
      assert.isTrue(await cfd.methods.buyerSelling().call())
      await assertStatus(cfd, STATUS.SALE)

      await api.cancelSale(cfd.options.address, buyer)
      assert.isFalse(await cfd.methods.buyerSelling().call())
      await assertStatus(cfd, STATUS.INITIATED)
      
    })
  })


  describe('topup & withdraw', function () {

    let cfd
    const valueAdd = new BigNumber('2e18') // 2 DAI

    before(async () => {
      cfd = await newCFDInitiated(buyer, seller, true)
    })

    it('topup a CFD', async () => {
      const currentCfd = await api.getCFD(cfd.options.address)
      assert.equal(currentCfd.details.buyerDepositBalance.toNumber(), 1, 'Initial buyerDepositBalance is wrong')
      
      await api.topup(cfd.options.address, buyer, valueAdd)

      const newCfd = await api.getCFD(cfd.options.address)
      assert.equal(newCfd.details.buyerDepositBalance.toNumber(), 3, 'Initial buyerDepositBalance is wrong')
    })

    it('withdraw a CFD', async () => {
      const currentCfd = await api.getCFD(cfd.options.address)
      assert.equal(currentCfd.details.buyerDepositBalance.toNumber(), 3, 'Initial buyerDepositBalance is wrong')
      
      await api.withdraw(cfd.options.address, buyer, valueAdd)

      const newCfd = await api.getCFD(cfd.options.address)
      assert.equal(newCfd.details.buyerDepositBalance.toNumber(), 1, 'Initial buyerDepositBalance is wrong')
    })

  })

})
