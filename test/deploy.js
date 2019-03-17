import {assert} from 'chai'
import BigNumber from 'bignumber.js'

import CFDAPI from '../src/infura/cfd-api-infura'
import {registryInstanceDeployed} from '../src/infura/contracts'
import {STATUS} from '../src/infura/utils'

import {deployAllForTest} from './helpers/deploy'
import {config as configBase, web3} from './helpers/setup'

const REJECT_MESSAGE = 'Returned error: VM Exception while processing transaction: revert'

// TEST ACCOUNTS (indexes into web3.eth.accounts)
const ACCOUNT_OWNER_1 = 0
const ACCOUNT_DAEMON_1 = 3
const ACCOUNT_OWNER_2 = 4
const ACCOUNT_DAEMON_2 = 5
const ACCOUNT_BUYER = 6
const ACCOUNT_SELLER = 7

const ONE_DAI = new BigNumber('1e18')

const marketStr = 'Poloniex_ETH_USD'
const price = '67.00239'

describe('deploy', function () {
  let daemon1, daemon2
  let owner1, owner2

  let buyer
  let seller
  let notionalAmount

  let cfdAPI

  const leverage = 1 // most tests using leverage 1

  const deployFullSet = async (config, firstTime = true) => {
    let cfdFactory
    let cfdRegistry
    let feeds
    let registry
    let daiToken

      // eslint-disable-next-line no-extra-semi
    ;({
      feeds,
      cfdRegistry,
      cfdFactory,
      registry,
      daiToken
    } = await deployAllForTest({
      web3,
      config,
      initialPrice: price,
      firstTime,
      seedAccounts: [buyer, seller]
    }))

    const updatedConfig = Object.assign({}, config, {
      feedContractAddr: feeds.options.address,
      registryAddr: registry.options.address,
      cfdFactoryContractAddr: cfdFactory.options.address,
      cfdRegistryContractAddr: cfdRegistry.options.address,
      daiTokenAddr: daiToken.options.address
    })

    return updatedConfig
  }

  const newCFDInitiated = async (party, counterparty, partyIsBuyer) => {
    const cfd = await cfdAPI.newCFD(
      marketStr,
      price,
      notionalAmount,
      leverage,
      partyIsBuyer,
      party
    )
    await cfdAPI.deposit(cfd.options.address, counterparty, notionalAmount)
    return cfd
  }

  before(done => {
    notionalAmount = ONE_DAI
    web3.eth.getAccounts().then(async (accounts) => {
    	daemon1 = accounts[ACCOUNT_DAEMON_1]
      daemon2 = accounts[ACCOUNT_DAEMON_2]
      owner1 = accounts[ACCOUNT_OWNER_1]
      owner2 = accounts[ACCOUNT_OWNER_2]
      buyer = accounts[ACCOUNT_BUYER]
      seller = accounts[ACCOUNT_SELLER]
      done()
    }).catch((err) => {
      console.log(err)
      process.exit(-1)
    });
  })

  it('deploy new set of contracts with new owner and daemon account', async () => {
    const deploymentConfig = {v1: {}, v2: {}}

    /*
     * Deploy first time - will create a new Registry and ALL others
     */

    const config1 = Object.assign({}, configBase, {
      ownerAccountAddr: owner1,
      daemonAccountAddr: daemon1
    })
    deploymentConfig.v1 = await deployFullSet(config1, true)

    const registry = await registryInstanceDeployed(deploymentConfig.v1, web3)
    await registry.methods.transferOwnership(owner2).send({from: owner1})
    assert.equal(owner2, await registry.methods.owner().call(), 'owner updated')

    /*
     * Deploy second time - will use the existing Registry but create ALL others
     */
    const config2 = Object.assign({}, deploymentConfig.v1, {
      ownerAccountAddr: owner2,
      daemonAccountAddr: daemon2
    })
    deploymentConfig.v2 = await deployFullSet(config2, false)

    assert.equal(
      deploymentConfig.v1.registryAddr,
      deploymentConfig.v2.registryAddr,
      'registry is unchanged'
    )

    // check can create CFDs on the new set of contracts
    cfdAPI = await CFDAPI.newInstance(deploymentConfig.v2, web3)
    const cfd = await newCFDInitiated(buyer, seller, true)
    assert.equal(STATUS.INITIATED, await cfd.methods.status().call(), 'new cfd initiated')

    // check cannot create CFD on the old set
    cfdAPI = await CFDAPI.newInstance(deploymentConfig.v1, web3)
    try {
      await newCFDInitiated(buyer, seller, true)
      assert.fail(`expected create failure`)
    } catch (err) {
      assert.isTrue(err.message.startsWith(REJECT_MESSAGE))
    }
  })
})
