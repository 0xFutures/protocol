import { assert } from 'chai'
import BigNumber from 'bignumber.js'

import CFDAPI from '../src/infura/cfd-api-infura'
import EVENTAPI from '../src/infura/event-api'
import ProxyAPI from '../src/infura/proxy'

import { deployAllForTest } from './helpers/deploy'
import { web3 } from './helpers/setup'

const marketStr = 'Kyber_ETH_DAI'
const price = '67.00239'

// TEST ACCOUNTS (indexes into web3.eth.accounts)
const ACCOUNT_BUYER = 5
const ACCOUNT_SELLER = 6
const ACCOUNT_PARTY = 7
const ACCOUNT_COUNTERPARTY = 8
const ACCOUNT_THIRDPARTY = 9

describe('event-api.js', function() {
  let buyer, seller
  let party, counterparty, thirdParty
  let partyProxy, counterpartyProxy, thirdPartyProxy
  let notionalAmountDai

  let cfdPartyIsBuyer
  let cfdPartyIsSeller
  let cfdTransferToThirdParty
  let cfdLiquidated

  let cfdApi
  let eventApi
  let proxyApi

  const leverage = 1 // most tests using leverage 1

  const newCFDInitiated = async (partyProxy, counterparty, partyIsBuyer) => {
    const cfd = await cfdApi.newCFD(
      marketStr,
      price,
      notionalAmountDai,
      leverage,
      partyIsBuyer,
      partyProxy
    )
    await cfdApi.deposit(cfd.options.address, counterparty, notionalAmountDai)
    return cfd
  }

  before(done => {
    web3.eth
      .getAccounts()
      .then(async accounts => {
        buyer = accounts[ACCOUNT_BUYER]
        seller = accounts[ACCOUNT_SELLER]
        party = accounts[ACCOUNT_PARTY]
        counterparty = accounts[ACCOUNT_COUNTERPARTY]
        thirdParty = accounts[ACCOUNT_THIRDPARTY]

        // eslint-disable-next-line no-extra-semi
        let updatedConfig
        ;({ updatedConfig } = await deployAllForTest({
          web3,
          initialPriceKyberDAI: price,
          seedAccounts: [buyer, seller, party, counterparty, thirdParty]
        }))

        const config = updatedConfig

        notionalAmountDai = new BigNumber('1e18') // 1 DAI

        //
        // Create an instance of apis
        //
        cfdApi = await CFDAPI.newInstance(config, web3)
        eventApi = await EVENTAPI.newInstance(config, web3)
        proxyApi = await ProxyAPI.newInstance(config, web3)

        //
        // Setup accounts, proxies and create CFDs for query tests
        //
        partyProxy = await proxyApi.proxyNew(party)
        counterpartyProxy = await proxyApi.proxyNew(counterparty)
        thirdPartyProxy = await proxyApi.proxyNew(thirdParty)

        cfdPartyIsBuyer = await newCFDInitiated(
          partyProxy,
          counterpartyProxy,
          true
        )
        cfdPartyIsSeller = await newCFDInitiated(
          partyProxy,
          counterpartyProxy,
          false
        )

        cfdTransferToThirdParty = await newCFDInitiated(
          partyProxy,
          counterpartyProxy,
          true
        )
        await proxyApi.proxyTransferPosition(
          partyProxy,
          cfdTransferToThirdParty,
          thirdPartyProxy.options.address
        )

        cfdLiquidated = await newCFDInitiated(
          partyProxy,
          counterpartyProxy,
          true
        )
        await proxyApi.proxyForceTerminate(partyProxy, cfdLiquidated)

        done()
      })
      .catch(err => {
        console.log(err)
        process.exit(-1)
      })
  })

  it('cfdPartyIsBuyer contracts events', async () => {
    const cfd = await cfdApi.getCFD(cfdPartyIsBuyer.options.address)
    const events = await eventApi.getAllEvents([cfd])
    assert.isTrue(
      events != undefined && events.length == 2,
      'Wrong cfdPartyIsBuyer contracts events'
    )
  })

  it('cfdPartyIsSeller contracts events', async () => {
    const cfd = await cfdApi.getCFD(cfdPartyIsSeller.options.address)
    const events = await eventApi.getAllEvents([cfd])
    assert.isTrue(
      events != undefined && events.length == 2,
      'Wrong cfdPartyIsSeller contracts events'
    )
  })

  it('cfdTransferToThirdParty contracts events', async () => {
    const cfd = await cfdApi.getCFD(cfdTransferToThirdParty.options.address)
    const events = await eventApi.getAllEvents([cfd])
    assert.isTrue(
      events != undefined && events.length == 3,
      'Wrong cfdTransferToThirdParty contracts events'
    )
  })

  it('cfdLiquidated contracts events', async () => {
    const cfd = await cfdApi.getCFD(cfdLiquidated.options.address)
    const events = await eventApi.getAllEvents([cfd])
    assert.isTrue(
      events != undefined && events.length == 5,
      'Wrong cfdLiquidated contracts events'
    )
  })

  it('all contracts events', async () => {
    const cfd1 = await cfdApi.getCFD(cfdPartyIsBuyer.options.address)
    const cfd2 = await cfdApi.getCFD(cfdPartyIsSeller.options.address)
    const cfd3 = await cfdApi.getCFD(cfdTransferToThirdParty.options.address)
    const cfd4 = await cfdApi.getCFD(cfdLiquidated.options.address)
    const events = await eventApi.getAllEvents([cfd1, cfd2, cfd3, cfd4])
    assert.isTrue(
      events != undefined && events.length == 12,
      'Wrong all contracts events'
    )
  })
})
