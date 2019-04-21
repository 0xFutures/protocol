import { assert } from 'chai'
import BigNumber from 'bignumber.js'

import {
  cfdInstance,
  dsProxyInstanceDeployed
} from '../../src/infura/contracts'
import { joinerFee } from '../../src/calc'
import {
  logGas,
  toContractBigNumber
} from '../../src/infura/utils'

import { assertEqualAddress, assertEqualBN } from '../helpers/assert'
import { deployAllForTest, mockMakerPut } from '../helpers/deploy'
import { config, web3 } from '../helpers/setup'

const REJECT_MESSAGE = 'Returned error: VM Exception while processing transaction'
const EVENT_LogCFDRegistryParty = web3.utils.sha3('LogCFDRegistryParty(address,address)')

// TEST ACCOUNTS (indexes into web3.eth.accounts)
const ACCOUNT_OWNER = 0
const ACCOUNT_DAEMON = 3
const ACCOUNT_BUYER = 5
const ACCOUNT_SELLER = 6

const MAX_UINT256 = new BigNumber(2).exponentiatedBy(256).minus(1)

const marketStr = 'Maker_ETH_USD'
const marketId = web3.utils.sha3('Maker_ETH_USD')
const ethDaiPrice = '275.20'
const ethDaiPriceAdjusted = toContractBigNumber('275.20')
const notionalAmountDai = new BigNumber('1e18') // 1 DAI

// convert from 64 digit long to 40 digit long
const unpackAddress = packed => packed.replace(/x0{24}/, 'x')

const proxySendTransaction = async (proxy, cfdProxy, msgData) =>
  proxy.methods[
    'execute(address,bytes)'
  ](
    cfdProxy.options.address,
    msgData
  )
    .send({
      from: await proxy.methods.owner().call(),
      gas: 1750000
    })

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
  // see web3.js #2077 - BigNumbers below converted to string due to bug
  const msgData = cfdProxy.methods.createContract(
    cfdFactory.options.address,
    daiToken.options.address,
    marketId,
    strikePrice.toString(),
    notional.toString(),
    true, // isBuyer
    value.toString()
  ).encodeABI()

  const txRsp = await proxySendTransaction(proxy, cfdProxy, msgData)
  logGas(`CFD create (through proxy)`, txRsp)

  const cfdPartyEventTopics = txRsp.events[10].raw.topics
  assert.equal(cfdPartyEventTopics[0], EVENT_LogCFDRegistryParty)
  assertEqualAddress(unpackAddress(cfdPartyEventTopics[2]), proxy.options.address)

  const cfd = cfdInstance(web3, config)
  cfd.options.address = unpackAddress(cfdPartyEventTopics[1])
  return cfd
}

const proxyDeposit = async (
  proxy,
  cfd,
  { cfdProxy, daiToken },
  value
) => {
  const msgData = cfdProxy.methods.deposit(
    cfd.options.address,
    daiToken.options.address,
    value.toString()
  ).encodeABI()
  const txRsp = await proxySendTransaction(proxy, cfdProxy, msgData)
  logGas(`CFD deposit (through proxy)`, txRsp)
}


describe('ContractForDifferenceProxy', function () {
  let deployment

  let buyer
  let seller

  before(async () => {
    const accounts = await web3.eth.getAccounts()
    buyer = accounts[ACCOUNT_BUYER]
    seller = accounts[ACCOUNT_SELLER]

    deployment = await deployAllForTest({
      web3,
      initialPriceExternal: ethDaiPrice,
      firstTime: true,
      config,
      seedAccounts: [buyer, seller]
    })
  })


  it.only('create CFD through user proxy', async () => {
    const { daiToken } = deployment

    const buyerProxy = await proxyNew(buyer, deployment)
    const buyerProxyAddr = buyerProxy.options.address
    await daiToken.methods.approve(buyerProxyAddr, '-1').send({ from: buyer })
    assertEqualBN(
      await daiToken.methods.allowance(buyer, buyerProxyAddr).call(),
      MAX_UINT256
    )

    const cfd = await proxyCreateCFD({
      proxy: buyerProxy,
      deployment,
      marketId,
      strikePrice: ethDaiPriceAdjusted,
      notional: notionalAmountDai,
      value: notionalAmountDai
    })
    assertEqualAddress(await cfd.methods.buyer().call(), buyerProxyAddr)
    assertEqualBN(await cfd.methods.notionalAmountDai().call(), notionalAmountDai)
    assertEqualBN(await cfd.methods.strikePrice().call(), ethDaiPriceAdjusted)
    assert.equal(await cfd.methods.market().call(), marketId)
  })


  it.only('main lifecycle - create to liquidation', async () => {
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

    await proxyDeposit(
      sellerProxy,
      cfd,
      deployment,
      notionalAmountDai.plus(joinerFee(notionalAmountDai))
    )

    // // 5% threshold passed for seller
    // const newMarketPrice = makerEthPriceAdjusted.times(1.951)
    // await mockMakerPut(ethUsdMaker, newMarketPrice)

    // const cfdBalance = await getBalance(cfd.options.address)
    // const creatorBalBefore = await getBalance(CREATOR_ACCOUNT)
    // const cpBalBefore = await getBalance(COUNTERPARTY_ACCOUNT)

    // await cfd.methods.liquidate().send({
    //   from: DAEMON_ACCOUNT,
    //   gas: 200000
    // })

    // await assertStatus(cfd, STATUS.CLOSED)
    // assert.isTrue(await cfd.methods.closed().call())
    // assert.isFalse(await cfd.methods.terminated().call())

    // // full cfd balance transferred
    // assertEqualBN(
    //   await getBalance(CREATOR_ACCOUNT),
    //   creatorBalBefore.plus(cfdBalance),
    //   'buyer should have full balance transferred'
    // )
    // // unchanged
    // assertEqualBN(
    //   await getBalance(COUNTERPARTY_ACCOUNT),
    //   cpBalBefore,
    //   'seller balance should be unchanged'
    // )

  })
})
