import { assert } from 'chai'
import BigNumber from 'bignumber.js'

import { creatorFee, joinerFee } from '../../src/calc'
import ProxyAPI from '../../src/infura/proxy'
import {
  toContractBigNumber,
  unpackAddress,
  STATUS,
} from '../../src/infura/utils'

import { assertEqualAddress, assertEqualBN, assertStatus } from '../helpers/assert'
import { deployAllForTest, mockMakerPut } from '../helpers/deploy'
import { config, web3 } from '../helpers/setup'

// TEST ACCOUNTS (indexes into web3.eth.accounts)
const ACCOUNT_DAEMON = 3
const ACCOUNT_BUYER = 5
const ACCOUNT_SELLER = 6
const ACCOUNT_THIRD_PARTY = 7

const MAX_UINT256 = new BigNumber(2).exponentiatedBy(256).minus(1)

const marketId = web3.utils.sha3('Maker_ETH_USD')
const ethDaiPrice = '275.20'
const ethDaiPriceAdjusted = toContractBigNumber('275.20')
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
  const getBalance = async (daiToken, addr) => new BigNumber(
    await daiToken.methods.balanceOf(addr).call()
  )

  // create a proxy for each user and create a new CFD and deposit
  const createCFD = async () => {
    const buyerProxy = await proxyApi.proxyNew(buyer, deployment)
    const sellerProxy = await proxyApi.proxyNew(seller, deployment)

    const cfd = await proxyApi.proxyCreateCFD({
      proxy: buyerProxy,
      deployment,
      marketId,
      strikePrice: ethDaiPriceAdjusted,
      notional: notionalAmountDai,
      value: notionalAmountDai.plus(creatorFee(notionalAmountDai))
    })
    await proxyApi.proxyDeposit(
      sellerProxy,
      cfd,
      deployment,
      notionalAmountDai.plus(joinerFee(notionalAmountDai))
    )
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
      initialPriceExternal: ethDaiPrice,
      firstTime: true,
      config,
      seedAccounts: [buyer, seller, thirdParty]
    })

    // console.log(JSON.stringify(deployment.updatedConfig, null, 2))

    proxyApi = await ProxyAPI.newInstance(config, web3)
  })

  /*
   * Tests
   */

  it('main lifecycle - create to liquidation', async () => {
    const { cfd, buyerProxy, sellerProxy } = await createCFD()

    const { daiToken } = deployment

    assertEqualBN(
      await daiToken.methods.allowance(buyer, buyerProxy.options.address).call(),
      MAX_UINT256.minus(notionalAmountDai.plus(creatorFee(notionalAmountDai))),
      'buyer allowance to proxy'
    )
    assertEqualBN(
      await daiToken.methods.allowance(seller, sellerProxy.options.address).call(),
      MAX_UINT256.minus(notionalAmountDai.plus(joinerFee(notionalAmountDai))),
      'seller allowance to proxy'
    )

    assertEqualAddress(await cfd.methods.buyer().call(), buyerProxy.options.address)
    assertEqualBN(await cfd.methods.notionalAmountDai().call(), notionalAmountDai)
    assertEqualBN(await cfd.methods.strikePrice().call(), ethDaiPriceAdjusted)
    assert.equal(await cfd.methods.market().call(), marketId)

    // 5% threshold passed for seller
    const newMarketPrice = ethDaiPriceAdjusted.times(1.951)
    await mockMakerPut(deployment.ethUsdMaker, newMarketPrice)

    const cfdBalance = await getBalance(daiToken, cfd.options.address)
    const buyerBalBefore = await getBalance(daiToken, buyer)
    const sellerProxyBalBefore = await getBalance(daiToken, sellerProxy.options.address)

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
    await proxyApi.proxySellPrepare(buyerProxy, cfd, deployment, saleStrikePrice.toFixed(), 0)
    await assertStatus(cfd, STATUS.SALE)

    // assert sale details in the contract
    assertEqualBN(await cfd.methods.buyerSaleStrikePrice().call(), saleStrikePrice)

    // buyingParty buys the seller side
    const thirdPartyProxy = await proxyApi.proxyNew(thirdParty, deployment)
    const buyBuyerSide = true
    const buyValue = notionalAmountDai.plus(joinerFee(notionalAmountDai)).toFixed()

    const buyerBalBefore = await getBalance(daiToken, buyer)
    await proxyApi.proxyBuy(thirdPartyProxy, cfd, deployment, buyBuyerSide, buyValue)

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
    await proxyApi.proxySellPrepare(buyerProxy, cfd, deployment, saleStrikePrice.toFixed(), 0)

    await assertStatus(cfd, STATUS.SALE, `sale status`)
    await assertEqualBN(
      await cfd.methods.buyerSaleStrikePrice().call(),
      saleStrikePrice,
      'buyer initial sale price'
    )

    // sellUpdate
    const updatedStrikePrice = saleStrikePrice.times(1.1)
    await proxyApi.proxySellUpdate(buyerProxy, cfd, deployment, updatedStrikePrice)
    await assertEqualBN(
      await cfd.methods.buyerSaleStrikePrice().call(),
      updatedStrikePrice,
      'buyer updated sale price'
    )
    await assertStatus(cfd, STATUS.SALE, `still sale status`)

    // sellCancel
    await proxyApi.proxySellCancel(buyerProxy, cfd, deployment)
    await assertStatus(cfd, STATUS.INITIATED, `back to INITIATED`)
  })

  it('cancelNew', async () => {
    const buyerProxy = await proxyApi.proxyNew(buyer, deployment)
    const cfd = await proxyApi.proxyCreateCFD({
      proxy: buyerProxy,
      deployment,
      marketId,
      strikePrice: ethDaiPriceAdjusted,
      notional: notionalAmountDai,
      value: notionalAmountDai
    })

    await proxyApi.proxyCancelNew(buyerProxy, cfd, deployment)
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
    const topupAmount =
      notionalAmountDai.dividedBy(2)

    await proxyApi.proxyTopup(
      buyerProxy,
      cfd,
      deployment,
      topupAmount
    )

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
    await proxyApi.proxyWithdraw(
      buyerProxy,
      cfd,
      deployment,
      withdrawAmount
    )

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

    const thirdPartyProxy = await proxyApi.proxyNew(thirdParty, deployment)

    await proxyApi.proxyTransferPosition(
      buyerProxy,
      cfd,
      deployment,
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

    await proxyApi.proxyForceTerminate(
      sellerProxy,
      cfd,
      deployment
    )

    await assertStatus(cfd, STATUS.CLOSED, `still sale status`)
  })

  it('upgrade proxy', async () => {
    const { cfd, buyerProxy, sellerProxy } = await createCFD()

    const cfdBalance = await getBalance(deployment.daiToken, cfd.options.address)
    assertEqualBN(
      cfdBalance,
      notionalAmountDai.times(2),
      'initial cfd balance'
    )

    // Deploy new set of contracts that we will later try upgrade too
    const deploymentv2 = await deployAllForTest({
      web3,
      // initialPriceExternal: ethDaiPrice,
      firstTime: false,
      config: deployment.updatedConfig,
    })

    // Upgrade CFD to new set
    await proxyApi.proxyUpgrade(buyerProxy, cfd, deployment)
    const txUpgrade = await proxyApi.proxyUpgrade(sellerProxy, cfd, deployment)

    // Check
    const newCFDAddr = unpackAddress(txUpgrade.events[5].raw.data)
    assertEqualBN(
      await getBalance(deployment.daiToken, newCFDAddr),
      cfdBalance,
      'balance transferred in'
    )

    // const newCFD = await cfdAPI.getCFD(newCFDAddr)

  })
})
