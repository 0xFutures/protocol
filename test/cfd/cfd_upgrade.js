import { assert } from 'chai'

import CFDAPI from '../../src/cfd-api'
import { registryInstanceDeployed } from '../../src/contracts'
import { STATUS } from '../../src/utils'

import { assertStatus, assertEqualBN } from '../helpers/assert'
import { deployAllForTest } from '../helpers/deploy'
import { config as configBase, web3 } from '../helpers/setup'

const REJECT_MESSAGE = 'VM Exception while processing transaction'

// TEST ACCOUNTS (indexes into web3.eth.accounts)
const ACCOUNT_OWNER = 0
const ACCOUNT_DAEMON = 3
const ACCOUNT_BUYER = 5
const ACCOUNT_SELLER = 6

const marketStr = 'Poloniex_ETH_USD'
const price = '67.00239'

const isBigNumber = num =>
  typeof num === 'object' && 'e' in num && 'c' in num && 's' in num

describe('cfd upgrade', function () {
  let daemonAccountAddr
  let ownerAccountAddr

  let buyer
  let seller
  let notionalAmountWei

  let cfdAPI

  const leverage = 1 // most tests using leverage 1

  const deployFullSet = async ({ config = configBase, firstTime }) => {
    let feeds
    let registry
    let cfdFactory
    let cfdRegistry

      // eslint-disable-next-line no-extra-semi
      ; ({ feeds, cfdRegistry, cfdFactory, registry } = await deployAllForTest(
      {
        web3,
        initialPrice: price,
        firstTime,
        config
      }
    ))

    const updatedConfig = Object.assign({}, configBase, {
      daemonAccountAddr,
      ownerAccountAddr,
      feedContractAddr: feeds.address,
      registryAddr: registry.address,
      cfdFactoryContractAddr: cfdFactory.address,
      cfdRegistryContractAddr: cfdRegistry.address
    })

    return updatedConfig
  }

  const newCFDInitiated = async (party, counterparty, partyIsBuyer) => {
    const cfd = await cfdAPI.newCFD(
      marketStr,
      price,
      notionalAmountWei,
      leverage,
      partyIsBuyer,
      party
    )
    const fee = await cfdAPI.joinFee(cfd)
    await cfd.deposit({
      from: counterparty,
      value: notionalAmountWei.plus(fee),
      gas: 1000000
    })
    return cfd
  }

  before(done => {
    notionalAmountWei = web3.toWei(web3.toBigNumber(10), 'finney')
    web3.eth.getAccounts(async (err, accounts) => {
      if (err) {
        console.log(err)
        process.exit(-1)
      }
      daemonAccountAddr = accounts[ACCOUNT_DAEMON]
      ownerAccountAddr = accounts[ACCOUNT_OWNER]
      buyer = accounts[ACCOUNT_BUYER]
      seller = accounts[ACCOUNT_SELLER]
      done()
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
    const cfd = await newCFDInitiated(buyer, seller, true)

    await assertStatus(cfd, STATUS.INITIATED)
    assert.equal(
      deploymentConfig.v1.cfdFactoryContractAddr,
      await registry.getCFDFactoryLatest.call(),
      'new CFDFactory registered'
    )
    assert.equal(
      deploymentConfig.v1.cfdFactoryContractAddr,
      await registry.allCFDs.call(cfd.address),
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
      await registry.getCFDFactoryLatest.call(),
      'CFDFactory updated to latest in registry'
    )

    //
    // Upgrade the contract - requires an upgrade call each party, upgrade
    // happens on the second call
    //
    await cfd.upgrade({ from: buyer })
    assert.equal(
      buyer,
      await cfd.upgradeCalledBy.call(),
      'upgrade caller marked'
    )
    await assertStatus(cfd, STATUS.INITIATED)
    assert.isFalse(await cfd.upgradeable.call(), 'upgradeable not set yet')

    const cfdBalanceBefore = web3.eth.getBalance(cfd.address)

    const txUpgrade = await cfd.upgrade({ from: seller, gas: 700000 })

    //
    // Check the old contract
    //
    assert.equal(0, web3.eth.getBalance(cfd.address), 'balance transferred out')
    await assertStatus(cfd, STATUS.CLOSED)

    //
    // Check the new contract
    //
    const newCFDAddr = txUpgrade.logs[0].args.newCFD
    assertEqualBN(
      cfdBalanceBefore,
      web3.eth.getBalance(newCFDAddr),
      'balance transferred in'
    )

    const newCFD = await cfdAPI.getCFD(newCFDAddr)
    const oldCFD = await cfdAPI.getCFD(cfd.address)

    assert.equal(STATUS.INITIATED, newCFD.status.toNumber(), `status initiated`)

    const cfdProps = [
      'liquidated',
      'buyer',
      'buyerIsSelling',
      'seller',
      'sellerIsSelling',
      'market',
      'notionalAmountWei',
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
      await cfd.upgrade({ from: buyer })
      assert.fail(`expected upgrade failure`)
    } catch (err) {
      assert.isTrue(err.message.startsWith(REJECT_MESSAGE))
    }
  })
})
