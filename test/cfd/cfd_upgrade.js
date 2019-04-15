import { assert } from 'chai'
import BigNumber from 'bignumber.js'

import CFDAPI from '../../src/infura/cfd-api-infura'
import {
  registryInstanceDeployed,
  daiTokenInstanceDeployed
} from '../../src/infura/contracts'
import { STATUS } from '../../src/infura/utils'

import { assertStatus, assertEqualBN } from '../helpers/assert'
import { deployAllForTest } from '../helpers/deploy'
import { config as configBase, web3 } from '../helpers/setup'

const REJECT_MESSAGE = 'Returned error: VM Exception while processing transaction'

// TEST ACCOUNTS (indexes into web3.eth.accounts)
const ACCOUNT_OWNER = 0
const ACCOUNT_DAEMON = 3
const ACCOUNT_BUYER = 5
const ACCOUNT_SELLER = 6

const marketStr = 'Poloniex_ETH_USD'
const price = '67.00239'

const isBigNumber = num =>
  typeof num === 'object' && 'e' in num && 'c' in num && 's' in num

describe.only('cfd upgrade', function () {
  let daemonAccountAddr
  let ownerAccountAddr

  let buyer
  let seller
  let notionalAmountDai

  let cfdAPI

  const leverage = 1 // most tests using leverage 1

  const deployFullSet = async ({ config = configBase, firstTime }) => {
    let priceFeeds
    let registry
    let cfdFactory
    let cfdRegistry
    let daiToken
    let ethUsdMaker

      // eslint-disable-next-line no-extra-semi
      ; ({
        priceFeeds,
        cfdRegistry,
        cfdFactory,
        registry,
        daiToken,
        ethUsdMaker
      } = await deployAllForTest({
        web3,
        initialPriceInternal: price,
        firstTime,
        config,
        seedAccounts: [buyer, seller]
      }))

    const updatedConfig = Object.assign({}, configBase, {
      daemonAccountAddr,
      ownerAccountAddr,
      priceFeedsContractAddr: priceFeeds.options.address,
      registryAddr: registry.options.address,
      cfdFactoryContractAddr: cfdFactory.options.address,
      cfdRegistryContractAddr: cfdRegistry.options.address,
      daiTokenAddr: daiToken.options.address,
      ethUsdMakerAddr: ethUsdMaker.options.address
    })

    return updatedConfig
  }

  const newCFDInitiated = async (party, counterparty, partyIsBuyer) => {
    const cfd = await cfdAPI.newCFD(
      marketStr,
      price,
      notionalAmountDai,
      leverage,
      partyIsBuyer,
      party
    )
    await cfdAPI.deposit(cfd.options.address, counterparty, notionalAmountDai)
    return cfd
  }

  before(done => {
    notionalAmountDai = new BigNumber('1e18') // 1 DAI
    web3.eth.getAccounts().then(async (accounts) => {
      daemonAccountAddr = accounts[ACCOUNT_DAEMON]
      ownerAccountAddr = accounts[ACCOUNT_OWNER]
      buyer = accounts[ACCOUNT_BUYER]
      seller = accounts[ACCOUNT_SELLER]
      done()
    }).catch((err) => {
      console.log(err)
      process.exit(-1)
    })
  })

  it('core upgrade flow succeeds', async () => {
    const deploymentConfig = { v1: {}, v2: {} }

    //
    // Deploy 1st set of contracts and create a CFD
    //
    deploymentConfig.v1 = await deployFullSet({ firstTime: true })

    cfdAPI = await CFDAPI.newInstance(deploymentConfig.v1, web3)
    const registry = await registryInstanceDeployed(deploymentConfig.v1, web3)
    const daiToken = await daiTokenInstanceDeployed(deploymentConfig.v1, web3)

    const cfd = await newCFDInitiated(buyer, seller, true)

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
    await cfd.methods.upgrade().send({ from: buyer })
    assert.equal(
      buyer,
      await cfd.methods.upgradeCalledBy().call(),
      'upgrade caller marked'
    )
    await assertStatus(cfd, STATUS.INITIATED)
    assert.isFalse(await cfd.methods.upgradeable().call(), 'upgradeable not set yet')

    const cfdBalanceBefore = await daiToken.methods.balanceOf(cfd.options.address).call()
    const txUpgrade = await cfd.methods.upgrade().send({ from: seller, gas: 700000 })

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
    const newCFDAddrStr = txUpgrade.events.LogCFDUpgraded.raw.data
    const newCFDAddr = '0x' + newCFDAddrStr.substr(newCFDAddrStr.length - 40);
    assertEqualBN(
      cfdBalanceBefore,
      await daiToken.methods.balanceOf(newCFDAddr).call(),
      'balance transferred in'
    )

    const newCFD = await cfdAPI.getCFD(newCFDAddr)
    const oldCFD = await cfdAPI.getCFD(cfd.options.address)

    assert.equal(STATUS.INITIATED, newCFD.details.status, `status initiated`)

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
  })

  it('upgrade rejected for contract already at latest version', async () => {
    const deploymentConfig = await deployFullSet({ firstTime: true })

    cfdAPI = await CFDAPI.newInstance(deploymentConfig, web3)
    const cfd = await newCFDInitiated(buyer, seller, true)
    try {
      await cfd.methods.upgrade().send({ from: buyer })
      assert.fail(`expected upgrade failure`)
    } catch (err) {
      assert.isTrue(err.message.startsWith(REJECT_MESSAGE))
    }
  })
})
