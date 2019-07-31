import { assert } from 'chai'
import BigNumber from 'bignumber.js'

import ProxyAPI from '../../src/infura/proxy'
import {
  fromContractBigNumber,
  toContractBigNumber,
  unpackAddress,
  STATUS
} from '../../src/infura/utils'

import {
  assertEqualAddress,
  assertEqualBN,
  assertStatus
} from '../helpers/assert'
import { deployAllForTest } from '../helpers/deploy'
import { mockKyberPut } from '../helpers/kyber'
import { config, web3 } from '../helpers/setup'

// TEST ACCOUNTS (indexes into web3.eth.accounts)
const ACCOUNT_DAEMON = 3
const ACCOUNT_BUYER = 5
const ACCOUNT_SELLER = 6
const ACCOUNT_THIRD_PARTY = 7

const MAX_UINT256 = new BigNumber(2).exponentiatedBy(256).minus(1)

const marketId = web3.utils.sha3('ETH/DAI')
const ethDaiPrice = '275.20'
const ethDaiPriceAdjusted = toContractBigNumber(ethDaiPrice)
const notionalAmountDai = new BigNumber('1e18') // 1 DAI

describe('ContractForDifferenceProxy', function () {
  let deployment
  let proxyApi

  let daemon
  let buyer
  let seller
  let thirdParty

  /*
   *  Helpers
   */

  // get DAI balance for address
  const getBalance = async (daiToken, addr) =>
    new BigNumber(await daiToken.methods.balanceOf(addr).call())

  // create a proxy for each user and create a new CFD and deposit
  const createCFD = async () => {
    const buyerProxy = await proxyApi.proxyNew(buyer)
    const sellerProxy = await proxyApi.proxyNew(seller)

    const cfd = await proxyApi.proxyCreateCFD({
      proxy: buyerProxy,
      marketId,
      strikePrice: ethDaiPriceAdjusted,
      notional: notionalAmountDai,
      value: notionalAmountDai,
      isBuyer: true
    })
    await proxyApi.proxyDeposit(sellerProxy, cfd, notionalAmountDai)

    return { cfd, buyerProxy, sellerProxy }
  }

  /*
   * Lifecycle
   */

  beforeEach(async () => {
    const accounts = await web3.eth.getAccounts()
    daemon = accounts[ACCOUNT_DAEMON]
    buyer = accounts[ACCOUNT_BUYER]
    seller = accounts[ACCOUNT_SELLER]
    thirdParty = accounts[ACCOUNT_THIRD_PARTY]

    deployment = await deployAllForTest({
      web3,
      initialPriceKyberDAI: ethDaiPrice,
      firstTime: true,
      config,
      seedAccounts: [buyer, seller, thirdParty]
    })

    // console.log(JSON.stringify(deployment.updatedConfig, null, 2))

    proxyApi = await ProxyAPI.newInstance(deployment.updatedConfig, web3)
  })

  /*
   * Tests
   */

  it('main lifecycle - create to liquidation', async () => {
    const { cfd, buyerProxy, sellerProxy } = await createCFD()

    const { daiToken } = deployment
    assertEqualBN(
      await daiToken.methods
        .allowance(buyer, buyerProxy.options.address)
        .call(),
      MAX_UINT256.minus(notionalAmountDai),
      'buyer allowance to proxy'
    )
    assertEqualBN(
      await daiToken.methods
        .allowance(seller, sellerProxy.options.address)
        .call(),
      MAX_UINT256.minus(notionalAmountDai),
      'seller allowance to proxy'
    )

    assertEqualAddress(
      await cfd.methods.buyer().call(),
      buyerProxy.options.address
    )
    assertEqualBN(
      await cfd.methods.notionalAmountDai().call(),
      notionalAmountDai
    )
    assertEqualBN(await cfd.methods.strikePrice().call(), ethDaiPriceAdjusted)
    assert.equal(await cfd.methods.market().call(), marketId)

    // 5% threshold passed for seller
    const newMarketPrice = fromContractBigNumber(
      ethDaiPriceAdjusted.times(1.951)
    )
    await mockKyberPut(
      deployment.kyberNetworkProxy,
      daiToken.options.address,
      newMarketPrice
    )

    const cfdBalance = await getBalance(daiToken, cfd.options.address)
    const buyerBalBefore = await getBalance(daiToken, buyer)
    const sellerProxyBalBefore = await getBalance(
      daiToken,
      sellerProxy.options.address
    )

    await cfd.methods.liquidate().send({
      from: daemon,
      gas: 200000
    })

    await assertStatus(cfd, STATUS.CLOSED)
    assert.isTrue(await cfd.methods.closed().call())
    assert.isFalse(await cfd.methods.terminated().call())

    // full cfd balance transferred
    assertEqualBN(
      await getBalance(daiToken, buyer),
      buyerBalBefore.plus(cfdBalance),
      'buyer should have full balance transferred'
    )
    // unchanged
    assertEqualBN(
      await getBalance(daiToken, sellerProxy.options.address),
      sellerProxyBalBefore,
      'seller balance should be unchanged'
    )
  })

  it('sale lifecycle - sellPrepare and buy', async () => {
    const { cfd, buyerProxy } = await createCFD()
    const { daiToken } = deployment

    // put buyer side on sale
    const salePricePercent = 1.2
    const saleStrikePrice = ethDaiPriceAdjusted.times(salePricePercent)
    await proxyApi.proxySellPrepare(
      buyerProxy,
      cfd,
      saleStrikePrice.toFixed(),
      0
    )
    await assertStatus(cfd, STATUS.SALE)

    // assert sale details in the contract
    assertEqualBN(
      await cfd.methods.buyerSaleStrikePrice().call(),
      saleStrikePrice
    )

    // buyingParty buys the seller side
    const thirdPartyProxy = await proxyApi.proxyNew(thirdParty)
    const buyBuyerSide = true
    const buyValue = notionalAmountDai.toFixed()

    const buyerBalBefore = await getBalance(daiToken, buyer)
    await proxyApi.proxyBuy(thirdPartyProxy, cfd, buyBuyerSide, buyValue)

    // thirdParty now owns the buy side
    assertEqualAddress(
      await cfd.methods.buyer().call(),
      thirdPartyProxy.options.address
    )

    // exiting party recieves funds from sale
    assertEqualBN(
      await getBalance(daiToken, buyer),
      buyerBalBefore.plus(notionalAmountDai.times(salePricePercent)),
      'buyer should have full balance transferred'
    )

    const expectedNewNotional = notionalAmountDai.times(1.2)
    assertEqualBN(
      await cfd.methods.notionalAmountDai().call(),
      expectedNewNotional,
      'new notional'
    )
    assertEqualBN(
      await cfd.methods.buyerInitialNotional().call(),
      expectedNewNotional,
      'buyer initial notional same as new notional'
    )
    assertEqualBN(
      await cfd.methods.sellerInitialNotional().call(),
      notionalAmountDai,
      'seller initial notional unchanged'
    ) // unchanged
  })

  it('sellUpdate and sellCancel', async () => {
    const { cfd, buyerProxy } = await createCFD()

    // put buyer side on sale
    const salePricePercent = 1.2
    const saleStrikePrice = ethDaiPriceAdjusted.times(salePricePercent)
    await proxyApi.proxySellPrepare(
      buyerProxy,
      cfd,
      saleStrikePrice.toFixed(),
      0
    )

    await assertStatus(cfd, STATUS.SALE, `sale status`)
    await assertEqualBN(
      await cfd.methods.buyerSaleStrikePrice().call(),
      saleStrikePrice,
      'buyer initial sale price'
    )

    // sellUpdate
    const updatedStrikePrice = saleStrikePrice.times(1.1)
    await proxyApi.proxySellUpdate(buyerProxy, cfd, updatedStrikePrice)
    await assertEqualBN(
      await cfd.methods.buyerSaleStrikePrice().call(),
      updatedStrikePrice,
      'buyer updated sale price'
    )
    await assertStatus(cfd, STATUS.SALE, `still sale status`)

    // sellCancel
    await proxyApi.proxySellCancel(buyerProxy, cfd)
    await assertStatus(cfd, STATUS.INITIATED, `back to INITIATED`)
  })

  it('changeStrikePrice and cancelNew', async () => {
    const buyerProxy = await proxyApi.proxyNew(buyer)
    const cfd = await proxyApi.proxyCreateCFD({
      proxy: buyerProxy,
      marketId,
      strikePrice: ethDaiPriceAdjusted,
      notional: notionalAmountDai,
      value: notionalAmountDai
    })

    // changeStrikePrice
    const updatedStrikePrice = ethDaiPriceAdjusted.times(1.1)
    await proxyApi.proxyChangeStrikePrice(buyerProxy, cfd, updatedStrikePrice)
    await assertEqualBN(
      await cfd.methods.buyerInitialStrikePrice().call(),
      updatedStrikePrice,
      'buyer updated strike price'
    )

    // cancelNew
    await proxyApi.proxyCancelNew(buyerProxy, cfd)
    await assertStatus(cfd, STATUS.CLOSED)
  })

  it('topup and withdraw', async () => {
    const { cfd, buyerProxy } = await createCFD()

    assertEqualBN(
      await cfd.methods.buyerDepositBalance().call(),
      notionalAmountDai
    )

    // topup and check balances
    const { daiToken } = deployment
    const buyerBalBeforeTopup = await getBalance(daiToken, buyer)
    const topupAmount = notionalAmountDai.dividedBy(2)

    await proxyApi.proxyTopup(buyerProxy, cfd, topupAmount)

    assertEqualBN(
      await cfd.methods.buyerDepositBalance().call(),
      notionalAmountDai.plus(topupAmount),
      'buyerDepositBalance after topup'
    )
    assertEqualBN(
      await getBalance(daiToken, buyer),
      buyerBalBeforeTopup.minus(topupAmount),
      'buyer balance after topup'
    )

    // withdraw and check balances
    const buyerBalBeforeWithdraw = await getBalance(daiToken, buyer)
    const withdrawAmount = topupAmount
    await proxyApi.proxyWithdraw(buyerProxy, cfd, withdrawAmount)

    assertEqualBN(
      await cfd.methods.buyerDepositBalance().call(),
      notionalAmountDai,
      'buyerDepositBalance after withdraw'
    )
    assertEqualBN(
      await getBalance(daiToken, buyer),
      buyerBalBeforeWithdraw.plus(withdrawAmount),
      'buyer address gets the withdrawn amount'
    )
  })

  it('transferPosition', async () => {
    const { cfd, buyerProxy } = await createCFD()

    const thirdPartyProxy = await proxyApi.proxyNew(thirdParty)

    await proxyApi.proxyTransferPosition(
      buyerProxy,
      cfd,
      thirdPartyProxy.options.address
    )

    assertEqualAddress(
      await cfd.methods.buyer().call(),
      thirdPartyProxy.options.address,
      'buyer is now the thirdPartyProxy'
    )
  })

  it('forceTerminate', async () => {
    const { cfd, sellerProxy } = await createCFD()

    await proxyApi.proxyForceTerminate(sellerProxy, cfd)

    await assertStatus(cfd, STATUS.CLOSED, `still sale status`)
  })

  it('upgrade proxy', async () => {
    const { cfd, buyerProxy, sellerProxy } = await createCFD()

    const cfdBalance = await getBalance(
      deployment.daiToken,
      cfd.options.address
    )
    assertEqualBN(cfdBalance, notionalAmountDai.times(2), 'initial cfd balance')

    // Deploy new set of contracts that we will later try upgrade too
    const deploymentv2 = await deployAllForTest({
      web3,
      // initialPriceExternal: ethDaiPrice,
      firstTime: false,
      config: deployment.updatedConfig
    })

    // Upgrade CFD to new set
    const proxyApiNewDeployment = await ProxyAPI.newInstance(
      deploymentv2.updatedConfig,
      web3
    )
    await proxyApiNewDeployment.proxyUpgrade(buyerProxy, cfd)
    const txUpgrade = await proxyApiNewDeployment.proxyUpgrade(sellerProxy, cfd)

    // Check
    const newCFDAddr = unpackAddress(txUpgrade.events[4].raw.data)

    assertEqualBN(
      await getBalance(deployment.daiToken, newCFDAddr),
      cfdBalance,
      'balance transferred in'
    )

    // const newCFD = await cfdAPI.getCFD(newCFDAddr)
  })
})
