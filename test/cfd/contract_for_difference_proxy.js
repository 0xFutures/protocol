import { assert } from 'chai'
import BigNumber from 'bignumber.js'

import {
  cfdInstance,
  dsProxyInstanceDeployed
} from '../../src/infura/contracts'
import {
  logGas,
  toContractBigNumber
} from '../../src/infura/utils'

import { assertEqualBN } from '../helpers/assert'
import { deployAllForTest } from '../helpers/deploy'
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

describe('ContractForDifferenceProxy', function () {

  let deployment

  let cfd
  let cfdProxy
  let cfdProxyAddr

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

    // console.log(Object.keys(deployment))

    cfd = cfdInstance(web3, config)
    cfdProxy = deployment.cfdProxy
    cfdProxyAddr = cfdProxy.options.address.toLowerCase()
  })

  it('creates proxy for user', async () => {
    const { dsProxyFactory } = deployment
    const user = buyer

    const buildProxyReceipt = await dsProxyFactory.methods.build(user).send()

    const proxyAddr = buildProxyReceipt.events.Created.returnValues.proxy.toLowerCase()
    const userProxy = await dsProxyInstanceDeployed(config, web3, proxyAddr, user)

    assert.equal(await userProxy.methods.owner().call(), user)
    assert(await dsProxyFactory.methods.isProxy(proxyAddr).call())
  })

  it.only('create CFD through user proxy', async () => {
    const { daiToken, dsProxyFactory } = deployment

    const buildProxyReceipt = await dsProxyFactory.methods.build(buyer).send()
    logGas(`Proxy create`, buildProxyReceipt)

    const buyerProxyAddr = buildProxyReceipt.events.Created.returnValues.proxy.toLowerCase()
    const buyerProxy = await dsProxyInstanceDeployed(config, web3, buyerProxyAddr, buyer)

    const approveTx = await daiToken.methods.approve(buyerProxyAddr, '-1').send({ from: buyer })
    logGas(`DAI approve`, approveTx)

    assertEqualBN(
      await daiToken.methods.allowance(buyer, buyerProxyAddr).call(),
      MAX_UINT256
    )

    // see web3.js #2077 - BigNumber below converted to string due to bug
    const msgData = cfdProxy.methods.createContract(
      deployment.cfdFactory.options.address.toLowerCase(), // TODO: wire into contract
      deployment.daiToken.options.address.toLowerCase(), // TODO: wire into contract
      marketId,
      ethDaiPriceAdjusted.toString(),
      notionalAmountDai.toString(),
      true, // isBuyer
      notionalAmountDai.toString() // value: 1x leverage - same as notional
    ).encodeABI()

    // console.log(`dsproxy: ${buyerProxyAddr}`)
    // console.log(`cfdProxy: ${cfdProxyAddr}`)
    // console.log(`buyer: ${buyer}`)
    // console.log(`proxyowner: ${await buyerProxy.methods.owner().call()}`)
    // console.log(`cfdFactory: ${deployment.cfdFactory.options.address.toLowerCase()}`)
    // console.log(`daiToken: ${deployment.daiToken.options.address.toLowerCase()}`)

    const txRsp = await buyerProxy.methods[
      //'execute(bytes,bytes)'
      'execute(address,bytes)'
    ](
      // cfdProxy.options.data, // code
      cfdProxyAddr.toLowerCase(),
      msgData
    )
      .send({
        from: buyer,
        gas: 5123456
      })
    logGas(`CFD create (through proxy)`, txRsp)

    const cfdPartyEventTopics = txRsp.events[10].raw.topics
    assert.equal(cfdPartyEventTopics[0], EVENT_LogCFDRegistryParty)
    assert.equal(unpackAddress(cfdPartyEventTopics[2]), buyerProxyAddr)

    cfd.options.address = unpackAddress(cfdPartyEventTopics[1])

    assert.equal((await cfd.methods.buyer().call()).toLowerCase(), buyerProxyAddr)
    assertEqualBN(await cfd.methods.notionalAmountDai().call(), notionalAmountDai)
    assertEqualBN(await cfd.methods.strikePrice().call(), ethDaiPriceAdjusted)
    assert.equal(await cfd.methods.market().call(), marketId)
  })
})
