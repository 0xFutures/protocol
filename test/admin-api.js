import { assert } from 'chai'

import AdminAPI from '../src/infura/admin-api'
import { deployAllForTest } from './helpers/deploy'
import { config as configBase, web3 } from './helpers/setup'

const PRICE = '67.00239'

describe('admin-api.js', function () {
  let feeds
  let cfdFactory
  let cfdRegistry

  let config
  let api

  let accounts

  before(done => {
    web3.eth.getAccounts().then(async (accs) => {

      accounts = accs

      let registry

        // eslint-disable-next-line no-extra-semi
        ; ({ feeds, cfdRegistry, cfdFactory, registry } = await deployAllForTest(
          {
            web3,
            initialPrice: PRICE
          }
        ))

      config = Object.assign({}, configBase)
      config.feedContractAddr = feeds.options.address
      config.cfdFactoryContractAddr = cfdFactory.options.address
      config.cfdRegistryContractAddr = cfdRegistry.options.address
      config.registryAddr = registry.options.address

      api = await AdminAPI.newInstance(config, web3)

      done()
    }).catch((err) => {
      console.log(err)
      process.exit(-1)
    })
  })

  it('changeDaemonAccount', async () => {
    assert.equal((await api.feeds.methods.daemonAccount().call()).toLowerCase(), config.daemonAccountAddr.toLowerCase())
    const newDaemonAddr = accounts[4]
    await api.changeDaemonAccount(newDaemonAddr)
    assert.equal((await api.feeds.methods.daemonAccount().call()).toLowerCase(), newDaemonAddr.toLowerCase())
  })

  describe('changeOwnerAccount', () => {
    const OWNED_CONTRACTS = ['feeds', 'registry', 'cfdRegistry', 'cfdFactory']

    const assertOwnerAll = (ownerAddr, owned = OWNED_CONTRACTS) => Promise.all(owned.map(
      async contract => assert.equal(
        ownerAddr.toLowerCase(),
        (await api[contract].methods.owner().call()).toLowerCase(),
        `${contract} owner`
      ))
    )

    it('all ownable', async () => {
      await assertOwnerAll(api.config.ownerAccountAddr)

      const NEW_OWNER_ADDR = accounts[5]
      await api.changeOwnerAccount(NEW_OWNER_ADDR)

      await assertOwnerAll(NEW_OWNER_ADDR)
      assert.equal(
        NEW_OWNER_ADDR.toLowerCase(),
        api.config.ownerAccountAddr.toLowerCase(),
        'in memory config updated'
      )
    })

    it('only Registry', async () => {
      const ORIGINAL_OWNER_ADDR = api.config.ownerAccountAddr
      await assertOwnerAll(ORIGINAL_OWNER_ADDR)

      // change to new account
      const NEW_OWNER_ADDR = accounts[6].toLowerCase()
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
        NEW_OWNER_ADDR.toLowerCase(),
        api.config.ownerAccountAddr.toLowerCase(),
        'in memory config updated'
      )
    })
  })
})
