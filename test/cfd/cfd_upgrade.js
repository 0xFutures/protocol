import { assert } from 'chai'
import BigNumber from 'bignumber.js'

import CFDAPI from '../../src/infura/cfd-api-infura'
import ProxyAPI from '../../src/infura/proxy'
import {
  registryInstanceDeployed,
  daiTokenInstanceDeployed
} from '../../src/infura/contracts'
import { unpackAddress, STATUS } from '../../src/infura/utils'

import {
  assertStatus,
  assertEqualAddress,
  assertEqualBN
} from '../helpers/assert'
import { deployAllForTest } from '../helpers/deploy'
import { config as configBase, web3 } from '../helpers/setup'

const REJECT_MESSAGE =
  'Returned error: VM Exception while processing transaction'

// TEST ACCOUNTS (indexes into web3.eth.accounts)
const ACCOUNT_BUYER = 5
const ACCOUNT_SELLER = 6

const marketStr = 'ETH/DAI'
const price = '67.00239'

const isBigNumber = num =>
  typeof num === 'object' && 'e' in num && 'c' in num && 's' in num

describe('cfd upgrade', function () {
  let buyer
  let seller
  let notionalAmountDai

  let cfdAPI

  const leverage = 1 // most tests using leverage 1

  const deployFullSet = async ({ config = configBase, firstTime }) => {
    let updatedConfig
      // eslint-disable-next-line no-extra-semi
      ; ({ updatedConfig } = await deployAllForTest({
        web3,
        initialPriceKyberDAI: price,
        firstTime,
        config,
        seedAccounts: [buyer, seller]
      }))
    return updatedConfig
  }

  const newCFDInitiated = async (
    partyProxy,
    counterpartyProxy,
    partyIsBuyer
  ) => {
    const cfd = await cfdAPI.newCFD(
      marketStr,
      price,
      notionalAmountDai,
      leverage,
      partyIsBuyer,
      partyProxy
    )
    await cfdAPI.deposit(
      cfd.options.address,
      counterpartyProxy,
      notionalAmountDai
    )
    return cfd
  }

  const createProxies = async (config, buyer, seller) => {
    const proxyApi = await ProxyAPI.newInstance(config, web3)
    const buyerProxy = await proxyApi.proxyNew(buyer)
    const sellerProxy = await proxyApi.proxyNew(seller)
    return { buyerProxy, sellerProxy }
  }

  const assertPropsMatch = (oldCFD, newCFD) => {
    const cfdProps = [
      'closed',
      'liquidated',
      'buyer',
      'buyerIsSelling',
      'seller',
      'sellerIsSelling',
      'market',
      'notionalAmountDai',
      'buyerInitialNotional',
      'sellerInitialNotional',
      'strikePrice',
      'buyerSaleStrikePrice',
      'sellerSaleStrikePrice',
      'buyerDepositBalance',
      'sellerDepositBalance',
      'buyerInitialStrikePrice',
      'sellerInitialStrikePrice',
      'buyerLiquidationPrice',
      'sellerLiquidationPrice'
    ]
    cfdProps.forEach(prop => {
      const msg = `${prop} should match`
      isBigNumber(oldCFD[prop])
        ? assertEqualBN(oldCFD[prop], newCFD[prop], msg)
        : assert.equal(oldCFD[prop], newCFD[prop], msg)
    })
  }

  before(done => {
    notionalAmountDai = new BigNumber('1e18') // 1 DAI
    web3.eth
      .getAccounts()
      .then(async accounts => {
        buyer = accounts[ACCOUNT_BUYER]
        seller = accounts[ACCOUNT_SELLER]
        done()
      })
      .catch(err => {
        console.log(err)
        process.exit(-1)
      })
  })

  it('upgrade contract with status INITIATED', async () => {
    const deploymentConfig = { v1: {}, v2: {} }

    //
    // Deploy 1st set of contracts and create a CFD
    //
    deploymentConfig.v1 = await deployFullSet({ firstTime: true })
    const { buyerProxy, sellerProxy } = await createProxies(
      deploymentConfig.v1,
      buyer,
      seller
    )

    cfdAPI = await CFDAPI.newInstance(deploymentConfig.v1, web3)
    const registry = await registryInstanceDeployed(deploymentConfig.v1, web3)
    const daiToken = await daiTokenInstanceDeployed(deploymentConfig.v1, web3)

    const cfd = await newCFDInitiated(buyerProxy, sellerProxy, true)

    await assertStatus(cfd, STATUS.INITIATED)
    assert.equal(
      deploymentConfig.v1.cfdFactoryContractAddr,
      await registry.methods.getCFDFactoryLatest().call(),
      'new CFDFactory registered'
    )
    assert.equal(
      deploymentConfig.v1.cfdFactoryContractAddr,
      await registry.methods.allCFDs(cfd.options.address).call(),
      'cfd added with current factory to registry.allCFDs'
    )

    //
    // Deploy new set of contracts and upgrade the CFD
    //
    deploymentConfig.v2 = await deployFullSet({
      config: deploymentConfig.v1,
      firstTime: false
    })
    assert.equal(
      deploymentConfig.v1.registryAddr,
      deploymentConfig.v2.registryAddr,
      'registry is unchanged'
    )
    assert.notEqual(
      deploymentConfig.v1.cfdFactoryContractAddr,
      deploymentConfig.v2.cfdFactoryContractAddr,
      'new cfdFactory deployed'
    )
    assert.equal(
      deploymentConfig.v2.cfdFactoryContractAddr,
      await registry.methods.getCFDFactoryLatest().call(),
      'CFDFactory updated to latest in registry'
    )

    //
    // Upgrade the contract - requires an upgrade call each party, upgrade
    // happens on the second call
    //
    await cfdAPI.upgradeCFD(cfd.options.address, buyerProxy)
    assertEqualAddress(
      buyerProxy.options.address,
      await cfd.methods.upgradeCalledBy().call(),
      'upgrade caller marked'
    )
    await assertStatus(cfd, STATUS.INITIATED)
    assert.isFalse(
      await cfd.methods.upgradeable().call(),
      'upgradeable not set yet'
    )

    const cfdBalanceBefore = await daiToken.methods
      .balanceOf(cfd.options.address)
      .call()
    const txUpgrade = await cfdAPI.upgradeCFD(cfd.options.address, sellerProxy)

    //
    // Check the old contract
    //
    assert.equal(
      0,
      await daiToken.methods.balanceOf(cfd.options.address).call(),
      'balance transferred out'
    )
    await assertStatus(cfd, STATUS.CLOSED)

    //
    // Check the new contract
    //
    const newCFDAddr = unpackAddress(txUpgrade.events[7].raw.data)
    assertEqualBN(
      cfdBalanceBefore,
      await daiToken.methods.balanceOf(newCFDAddr).call(),
      'balance transferred in'
    )

    const newCFD = await cfdAPI.getCFD(newCFDAddr)
    const oldCFD = await cfdAPI.getCFD(cfd.options.address)
    assertPropsMatch(oldCFD, newCFD)

    assert.equal(newCFD.details.status, STATUS.INITIATED, `new status initiated`)
  })

  it('upgrade contract with status CREATED - no one has joined the other side yet', async () => {
    const deploymentConfig = { v1: {}, v2: {} }

    // Deploy full set of 0xfutures contracts and party proxies
    deploymentConfig.v1 = await deployFullSet({ firstTime: true })
    const { buyerProxy } = await createProxies(
      deploymentConfig.v1,
      buyer,
      seller
    )
    cfdAPI = await CFDAPI.newInstance(deploymentConfig.v1, web3)
    const daiToken = await daiTokenInstanceDeployed(deploymentConfig.v1, web3)

    // Create a CFD with a buyer side but no seller yet
    const cfd = await cfdAPI.newCFD(
      marketStr,
      price,
      notionalAmountDai,
      leverage,
      true, // buyer side
      buyerProxy
    )

    // Deploy new set of contracts
    deploymentConfig.v2 = await deployFullSet({
      config: deploymentConfig.v1,
      firstTime: false
    })

    // Upgrade the contract - should work with only one call from the buyer
    const cfdBalanceBefore = await daiToken.methods
      .balanceOf(cfd.options.address)
      .call()
    const txUpgrade = await cfdAPI.upgradeCFD(cfd.options.address, buyerProxy)

    // Check the old contract
    assert.equal(
      0,
      await daiToken.methods.balanceOf(cfd.options.address).call(),
      'balance transferred out'
    )
    await assertStatus(cfd, STATUS.CLOSED, `old cfd status closed`)

    // Check the new contract
    const newCFDAddr = unpackAddress(txUpgrade.events[7].raw.data)
    assertEqualBN(
      cfdBalanceBefore,
      await daiToken.methods.balanceOf(newCFDAddr).call(),
      'balance transferred in'
    )

    // Check all props match on old and new contracts
    const newCFD = await cfdAPI.getCFD(newCFDAddr)
    const oldCFD = await cfdAPI.getCFD(cfd.options.address)
    assertPropsMatch(oldCFD, newCFD)

    // check new cfd status 
    assert.equal(newCFD.details.status, STATUS.CREATED, `new cfd status initiated`)
  })

  it('upgrade contract with one side on sale', async () => {
    const deploymentConfig = { v1: {}, v2: {} }

    // Deploy full set of 0xfutures contracts and party proxies
    deploymentConfig.v1 = await deployFullSet({ firstTime: true })
    const { buyerProxy, sellerProxy } = await createProxies(
      deploymentConfig.v1,
      buyer,
      seller
    )
    cfdAPI = await CFDAPI.newInstance(deploymentConfig.v1, web3)
    const daiToken = await daiTokenInstanceDeployed(deploymentConfig.v1, web3)

    // create CFD with buyer and seller and put one side on sale
    const cfd = await newCFDInitiated(buyerProxy, sellerProxy, true)
    await cfdAPI.sellCFD(cfd.options.address, buyerProxy, price, 0)
    await assertStatus(cfd, STATUS.SALE)

    // Deploy new set of contracts
    deploymentConfig.v2 = await deployFullSet({
      config: deploymentConfig.v1,
      firstTime: false
    })

    // Upgrade the contract - should work with only one call from the buyer
    const cfdBalanceBefore = await daiToken.methods
      .balanceOf(cfd.options.address)
      .call()
    await cfdAPI.upgradeCFD(cfd.options.address, buyerProxy)
    const txUpgrade = await cfdAPI.upgradeCFD(cfd.options.address, sellerProxy)

    // Check the old contract
    assert.equal(
      0,
      await daiToken.methods.balanceOf(cfd.options.address).call(),
      'balance transferred out'
    )
    await assertStatus(cfd, STATUS.CLOSED, `old cfd status closed`)

    // Check the new contract
    const newCFDAddr = unpackAddress(txUpgrade.events[7].raw.data)
    assertEqualBN(
      cfdBalanceBefore,
      await daiToken.methods.balanceOf(newCFDAddr).call(),
      'balance transferred in'
    )

    // Check all props match on old and new contracts
    const newCFD = await cfdAPI.getCFD(newCFDAddr)
    const oldCFD = await cfdAPI.getCFD(cfd.options.address)
    assertPropsMatch(oldCFD, newCFD)

    // explicitly check side is still on sale
    assert.isTrue(newCFD.details.buyerIsSelling, `buyerSelling should still be set`)
    assert.equal(newCFD.details.status, STATUS.SALE, `status should still be SALE`)
  })

  it('upgrade rejected for contract already at latest version', async () => {
    const deploymentConfig = await deployFullSet({ firstTime: true })
    const { buyerProxy, sellerProxy } = await createProxies(
      deploymentConfig,
      buyer,
      seller
    )

    cfdAPI = await CFDAPI.newInstance(deploymentConfig, web3)
    const cfd = await newCFDInitiated(buyerProxy, sellerProxy, true)
    try {
      await cfdAPI.upgradeCFD(cfd.options.address, buyerProxy)
      assert.fail(`expected upgrade failure`)
    } catch (err) {
      assert.isTrue(err.message.startsWith(REJECT_MESSAGE))
    }
  })
})
