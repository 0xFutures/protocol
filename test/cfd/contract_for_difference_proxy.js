import { assert } from 'chai'
import BigNumber from 'bignumber.js'

import {
  cfdInstance,
  dsProxyInstanceDeployed
} from '../../src/infura/contracts'
import { creatorFee, joinerFee } from '../../src/calc'
import {
  logGas,
  toContractBigNumber,
  STATUS,
} from '../../src/infura/utils'

import { assertEqualAddress, assertEqualBN, assertStatus } from '../helpers/assert'
import { deployAllForTest, mockMakerPut } from '../helpers/deploy'
import { config, web3 } from '../helpers/setup'

const REJECT_MESSAGE = 'Returned error: VM Exception while processing transaction'
const EVENT_LogCFDRegistryParty = web3.utils.sha3('LogCFDRegistryParty(address,address)')

// TEST ACCOUNTS (indexes into web3.eth.accounts)
const ACCOUNT_OWNER = 0
const ACCOUNT_DAEMON = 3
const ACCOUNT_BUYER = 5
const ACCOUNT_SELLER = 6
const ACCOUNT_THIRD_PARTY = 7

const MAX_UINT256 = new BigNumber(2).exponentiatedBy(256).minus(1)

const marketStr = 'Maker_ETH_USD'
const marketId = web3.utils.sha3('Maker_ETH_USD')
const ethDaiPrice = '275.20'
const ethDaiPriceAdjusted = toContractBigNumber('275.20')
const notionalAmountDai = new BigNumber('1e18') // 1 DAI

// convert from 64 digit long to 40 digit long
const unpackAddress = packed => packed.replace(/x0{24}/, 'x')

// get DAI balance for address
const getBalance = async (daiToken, addr) => new BigNumber(
  await daiToken.methods.balanceOf(addr).call()
)

/**
 * Send transaction to CFD proxy
 * @param {DSProxy} proxy
 * @param {ContractForDifferenceProxy} cfdProxy 
 * @param {string} msgData Transaction msg.data to send
 */
const proxySendTransaction = async (proxy, cfdProxy, msgData) =>
  proxy.methods[
    'execute(address,bytes)'
  ](
    cfdProxy.options.address,
    msgData
  )
    .send({
      from: await proxy.methods.owner().call(),
      gas: 2750000
    })

/**
 * Helper function to build msg.data and call sendTransaction.
 * @param {DSProxy} proxy
 * @param {ContractForDifferenceProxy} cfdProxy 
 * @param {string} method Signature/name of method to call on proxy
 * @param {Array} methodArgs Arguments to method
 */
const proxyTx = async (
  proxy,
  cfdProxy,
  method,
  methodArgs
) => {
  const msgData = cfdProxy.methods[method](...methodArgs).encodeABI()
  const txRsp = await proxySendTransaction(proxy, cfdProxy, msgData)
  logGas(`CFD ${method} (through proxy)`, txRsp)
  return txRsp
}

const proxyNew = async (user, { dsProxyFactory, daiToken }) => {
  const buildTx = await dsProxyFactory.methods.build(user).send()
  const proxyAddr = buildTx.events.Created.returnValues.proxy
  const proxy = await dsProxyInstanceDeployed(config, web3, proxyAddr, user)
  await daiToken.methods.approve(proxyAddr, '-1').send({ from: user })
  return proxy
}

const proxyCreateCFD = async ({
  proxy,
  deployment: { cfdFactory, cfdProxy, daiToken },
  marketId,
  strikePrice,
  notional,
  value
}) => {
  const txRsp = await proxyTx(proxy, cfdProxy, 'createContract', [
    cfdFactory.options.address,
    daiToken.options.address,
    marketId,
    strikePrice.toString(),
    notional.toString(),
    true, // isBuyer
    value.toString()
  ])

  const cfdPartyEventTopics = txRsp.events[10].raw.topics
  assert.equal(cfdPartyEventTopics[0], EVENT_LogCFDRegistryParty)
  assertEqualAddress(unpackAddress(cfdPartyEventTopics[2]), proxy.options.address)

  const cfd = cfdInstance(web3, config)
  cfd.options.address = unpackAddress(cfdPartyEventTopics[1])
  return cfd
}

const proxyDeposit = (
  proxy,
  cfd,
  { cfdProxy, daiToken },
  value
) =>
  proxyTx(proxy, cfdProxy, 'deposit', [
    cfd.options.address, daiToken.options.address, value.toString()
  ])

const proxySellPrepare = async (
  proxy,
  cfd,
  { cfdProxy },
  desiredStrikePrice,
  timeLimit
) =>
  proxyTx(proxy, cfdProxy, 'sellPrepare', [
    cfd.options.address, desiredStrikePrice.toString(), timeLimit
  ])

const proxyBuy = async (
  proxy,
  cfd,
  { cfdProxy, daiToken },
  buyBuyerSide,
  buyValue
) =>
  proxyTx(proxy, cfdProxy, 'buy', [
    cfd.options.address,
    daiToken.options.address,
    buyBuyerSide,
    buyValue.toString()
  ])

const proxyTopup = async (
  proxy,
  cfd,
  { cfdProxy, daiToken },
  value
) =>
  proxyTx(proxy, cfdProxy, 'topup', [
    cfd.options.address, daiToken.options.address, value.toString()
  ])

const proxyWithdraw = async (
  proxy,
  cfd,
  { cfdProxy },
  value
) =>
  proxyTx(proxy, cfdProxy, 'withdraw', [
    cfd.options.address, value.toString()
  ])

describe('ContractForDifferenceProxy', function () {
  let deployment

  let daemon
  let buyer
  let seller
  let thirdParty

  before(async () => {
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
  })

  it('main lifecycle - create to liquidation', async () => {
    const { daiToken } = deployment

    const buyerProxy = await proxyNew(buyer, deployment)
    const sellerProxy = await proxyNew(seller, deployment)

    const cfd = await proxyCreateCFD({
      proxy: buyerProxy,
      deployment,
      marketId,
      strikePrice: ethDaiPriceAdjusted,
      notional: notionalAmountDai,
      value: notionalAmountDai
    })
    assertEqualAddress(await cfd.methods.buyer().call(), buyerProxy.options.address)
    assertEqualBN(await cfd.methods.notionalAmountDai().call(), notionalAmountDai)
    assertEqualBN(await cfd.methods.strikePrice().call(), ethDaiPriceAdjusted)
    assert.equal(await cfd.methods.market().call(), marketId)

    await proxyDeposit(
      sellerProxy,
      cfd,
      deployment,
      notionalAmountDai.plus(joinerFee(notionalAmountDai))
    )

    // 5% threshold passed for seller
    const newMarketPrice = ethDaiPriceAdjusted.times(1.951)
    await mockMakerPut(deployment.ethUsdMaker, newMarketPrice)

    const cfdBalance = await getBalance(daiToken, cfd.options.address)
    const buyerBalBefore = await getBalance(daiToken, buyer)
    const sellerBalBefore = await getBalance(daiToken, seller)

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
      await getBalance(daiToken, seller),
      sellerBalBefore,
      'seller balance should be unchanged'
    )
  })

  it('sale lifecycle - sellPrepare and buy', async () => {
    const { daiToken } = deployment

    const buyerProxy = await proxyNew(buyer, deployment)
    const sellerProxy = await proxyNew(seller, deployment)
    const thirdPartyProxy = await proxyNew(thirdParty, deployment)

    const joinFee = joinerFee(notionalAmountDai)
    const cfd = await proxyCreateCFD({
      proxy: buyerProxy,
      deployment,
      marketId,
      strikePrice: ethDaiPriceAdjusted,
      notional: notionalAmountDai,
      value: notionalAmountDai
    })
    await proxyDeposit(
      sellerProxy,
      cfd,
      deployment,
      notionalAmountDai.plus(joinFee)
    )

    // put seller side on sale
    const saleStrikePrice = ethDaiPriceAdjusted.times(1.2)
    await proxySellPrepare(buyerProxy, cfd, deployment, saleStrikePrice.toFixed(), 0)
    await assertStatus(cfd, STATUS.SALE)

    // assert sale details in the contract
    assertEqualBN(await cfd.methods.buyerSaleStrikePrice().call(), saleStrikePrice)

    // buyingParty buys the seller side
    const buyBuyerSide = true
    const buyValue = notionalAmountDai.plus(joinFee).toFixed()
    await proxyBuy(thirdPartyProxy, cfd, deployment, buyBuyerSide, buyValue)

    // thirdParty now owns the buy side
    assertEqualAddress(
      await cfd.methods.buyer().call(),
      thirdPartyProxy.options.address
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

  it.only('topup and withdraw', async () => {
    const { daiToken } = deployment

    const buyerProxy = await proxyNew(buyer, deployment)
    const sellerProxy = await proxyNew(seller, deployment)

    const cfd = await proxyCreateCFD({
      proxy: buyerProxy,
      deployment,
      marketId,
      strikePrice: ethDaiPriceAdjusted,
      notional: notionalAmountDai,
      value: notionalAmountDai.plus(creatorFee(notionalAmountDai))
    })
    await proxyDeposit(
      sellerProxy,
      cfd,
      deployment,
      notionalAmountDai.plus(joinerFee(notionalAmountDai))
    )

    assertEqualBN(
      await cfd.methods.buyerDepositBalance().call(),
      notionalAmountDai
    )

    // topup and check balances
    const buyerBalBeforeTopup = await getBalance(daiToken, buyer)
    const topupAmount =
      notionalAmountDai.dividedBy(2)

    await proxyTopup(
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
    await proxyWithdraw(
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

})
