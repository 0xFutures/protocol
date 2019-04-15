import { assert } from 'chai'
import BigNumber from 'bignumber.js'

import CFDAPI from '../src/infura/cfd-api-infura'
import EVENTAPI from '../src/infura/event-api'

import { deployAllForTest } from './helpers/deploy'
import { config as configBase, web3 } from './helpers/setup'

const marketStr = 'Poloniex_ETH_USD'
const price = '67.00239'

// TEST ACCOUNTS (indexes into web3.eth.accounts)
const ACCOUNT_BUYER = 5
const ACCOUNT_SELLER = 6
const ACCOUNT_PARTY = 7
const ACCOUNT_COUNTERPARTY = 8
const ACCOUNT_THIRDPARTY = 9

describe('event-api.js', function () {

  let priceFeeds
  let cfdFactory
  let cfdRegistry
  let daiToken

  let buyer, seller
  let party, counterparty, thirdParty
  let notionalAmountDai

  let cfdPartyIsBuyer
  let cfdPartyIsSeller
  let cfdTransferToThirdParty
  let cfdLiquidated

  let cfdApi
  let eventApi

  const leverage = 1 // most tests using leverage 1

  const newCFDInitiated = async (party, counterparty, partyIsBuyer) => {
    const cfd = await cfdApi.newCFD(
      marketStr,
      price,
      notionalAmountDai,
      leverage,
      partyIsBuyer,
      party
    )
    await cfdApi.deposit(cfd.options.address, counterparty, notionalAmountDai)
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
        ; ({ cfdFactory, cfdRegistry, priceFeeds, daiToken } = await deployAllForTest({
          web3,
          initialPriceInternal: price,
          seedAccounts: [buyer, seller, party, counterparty, thirdParty]
        }))

      const config = Object.assign({}, configBase)
      config.priceFeedsContractAddr = priceFeeds.options.address
      config.cfdFactoryContractAddr = cfdFactory.options.address
      config.cfdRegistryContractAddr = cfdRegistry.options.address
      config.daiTokenAddr = daiToken.options.address

      notionalAmountDai = new BigNumber('1e18') // 1 DAI

      //
      // Create an instance of the cfd-api and event-api
      //
      cfdApi = await CFDAPI.newInstance(config, web3)
      eventApi = await EVENTAPI.newInstance(config, web3)

      //
      // Set accounts and create CFDs for query tests
      //
      cfdPartyIsBuyer = await newCFDInitiated(party, counterparty, true)
      cfdPartyIsSeller = await newCFDInitiated(party, counterparty, false)

      cfdTransferToThirdParty = await newCFDInitiated(party, counterparty, true)
      await cfdApi.transferPosition(
        cfdTransferToThirdParty.options.address,
        party,
        thirdParty
      )

      cfdLiquidated = await newCFDInitiated(party, counterparty, true)
      await cfdApi.forceTerminate(cfdLiquidated.options.address, party)

      done()
    }).catch((err) => {
      console.log(err)
      process.exit(-1)
    })
  })

  it('cfdPartyIsBuyer contracts events', async () => {
    const cfd = await cfdApi.getCFD(cfdPartyIsBuyer.options.address);
    const events = await eventApi.getAllEvents([cfd]);
    assert.isTrue(events != undefined && events.length == 2, 'Wrong cfdPartyIsBuyer contracts events');
  })

  it('cfdPartyIsSeller contracts events', async () => {
    const cfd = await cfdApi.getCFD(cfdPartyIsSeller.options.address);
    const events = await eventApi.getAllEvents([cfd]);
    assert.isTrue(events != undefined && events.length == 2, 'Wrong cfdPartyIsSeller contracts events');
  })

  it('cfdTransferToThirdParty contracts events', async () => {
    const cfd = await cfdApi.getCFD(cfdTransferToThirdParty.options.address);
    const events = await eventApi.getAllEvents([cfd]);
    assert.isTrue(events != undefined && events.length == 3, 'Wrong cfdTransferToThirdParty contracts events');
  })

  it('cfdLiquidated contracts events', async () => {
    const cfd = await cfdApi.getCFD(cfdLiquidated.options.address);
    const events = await eventApi.getAllEvents([cfd]);
    assert.isTrue(events != undefined && events.length == 5, 'Wrong cfdLiquidated contracts events');
  })

  it('all contracts events', async () => {
    const cfd1 = await cfdApi.getCFD(cfdPartyIsBuyer.options.address);
    const cfd2 = await cfdApi.getCFD(cfdPartyIsSeller.options.address);
    const cfd3 = await cfdApi.getCFD(cfdTransferToThirdParty.options.address);
    const cfd4 = await cfdApi.getCFD(cfdLiquidated.options.address);
    const events = await eventApi.getAllEvents([cfd1, cfd2, cfd3, cfd4]);
    assert.isTrue(events != undefined && events.length == 12, 'Wrong all contracts events');
  })

})
