import { assert } from 'chai'

import AdminAPI from '../src/admin-api'
import { deployAllForTest } from './helpers/deploy'
import { config as configBase, web3 } from './helpers/setup'

const PRICE = '67.00239'

describe('admin-api.js', function () {
  let feeds
  let cfdFactory
  let cfdRegistry

  let config
  let api

  before(done => {
    web3.eth.getAccounts(async (err, accounts) => {
      if (err) {
        console.log(err)
        process.exit(-1)
      }

      let registry

        // eslint-disable-next-line no-extra-semi
        ; ({ feeds, cfdRegistry, cfdFactory, registry } = await deployAllForTest(
          {
            web3,
            initialPrice: PRICE
          }
        ))

      config = Object.assign({}, configBase)
      config.feedContractAddr = feeds.address
      config.cfdFactoryContractAddr = cfdFactory.address
      config.cfdRegistryContractAddr = cfdRegistry.address
      config.registryAddr = registry.address

      api = await AdminAPI.newInstance(config, web3)

      done()
    })
  })

  it('changeDaemonAccount', async () => {
    assert.equal(await api.feeds.daemonAccount.call(), config.daemonAccountAddr)
    const newDaemonAddr = web3.eth.accounts[4]
    await api.changeDaemonAccount(newDaemonAddr)
    assert.equal(await api.feeds.daemonAccount.call(), newDaemonAddr)
  })

  describe('changeOwnerAccount', () => {
    const OWNED_CONTRACTS = ['feeds', 'registry', 'cfdRegistry', 'cfdFactory']

    const assertOwnerAll = (ownerAddr, owned = OWNED_CONTRACTS) => Promise.all(owned.map(
      async contract => assert.equal(
        ownerAddr,
        await api[contract].owner.call(),
        `${contract} owner`
      ))
    )

    it('all ownable', async () => {
      await assertOwnerAll(api.config.ownerAccountAddr)

      const NEW_OWNER_ADDR = web3.eth.accounts[5]
      await api.changeOwnerAccount(NEW_OWNER_ADDR)

      await assertOwnerAll(NEW_OWNER_ADDR)
      assert.equal(
        NEW_OWNER_ADDR,
        api.config.ownerAccountAddr,
        'in memory config updated'
      )
    })

    it('only Registry', async () => {
      const ORIGINAL_OWNER_ADDR = api.config.ownerAccountAddr
      await assertOwnerAll(ORIGINAL_OWNER_ADDR)

      // change to new account
      const NEW_OWNER_ADDR = web3.eth.accounts[6]
      await api.changeOwnerAccount(NEW_OWNER_ADDR, { registryOnly: true })

      // registry updated
      await assertOwnerAll(NEW_OWNER_ADDR, ['registry'])

      // other ownables NOT updated
      await assertOwnerAll(
        ORIGINAL_OWNER_ADDR,
        OWNED_CONTRACTS.filter(contract => contract !== 'registry')
      )

      // config on admin api updated
      assert.equal(
        NEW_OWNER_ADDR,
        api.config.ownerAccountAddr,
        'in memory config updated'
      )
    })
  })
})
