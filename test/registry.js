import { assert } from 'chai'
import { registryInstance } from '../src/contracts'
import { config, web3 } from './helpers/setup'

const ERROR_REVERT = 'VM Exception while processing transaction: revert'
const ADDRESS_UNDEFINED = '0x0000000000000000000000000000000000000000'

describe('Registry', function () {
  const Registry = registryInstance(web3.currentProvider, config)
  const accounts = web3.eth.accounts
  const anAddr = '0x333322221111ddddeeeeffff0000aaaabbbbcccc'

  describe('CFDFactoryLatest', () => {
    it('unregistrered contract returns 0x0', async () => {
      const registry = await Registry.new()
      assert.equal(ADDRESS_UNDEFINED, await registry.getCFDFactoryLatest.call())
    })

    it('get and set', async () => {
      const registry = await Registry.new()
      const cfdFactoryAddr = anAddr
      await registry.setCFDFactoryLatest(cfdFactoryAddr)
      assert.equal(cfdFactoryAddr, await registry.getCFDFactoryLatest.call())
    })

    it('only owner is authorised to setCFDFactoryLatest', async () => {
      const registry = await Registry.new()
      try {
        await registry.setCFDFactoryLatest(anAddr, { from: accounts[2] })
        assert.fail(`expected failure`)
      } catch (err) {
        assert.equal(ERROR_REVERT, err.message)
      }
    })
  })

  describe('allCFDs', () => {
    it('unregistered', async () => {
      const registry = await Registry.new()
      assert.equal(ADDRESS_UNDEFINED, await registry.allCFDs.call(anAddr))
    })

    it('registered', async () => {
      const cfdAddr = anAddr
      const cfdFactoryAddr = accounts[9]
      const registry = await Registry.new()
      await registry.setCFDFactoryLatest(cfdFactoryAddr)
      await registry.addCFD(cfdAddr, { from: cfdFactoryAddr })
      assert.equal(cfdFactoryAddr, await registry.allCFDs.call(cfdAddr))
    })

    it('only factory is authorised to addCFD', async () => {
      const registry = await Registry.new()
      try {
        await registry.addCFD(anAddr, { from: accounts[2] })
        assert.fail(`expected failure`)
      } catch (err) {
        assert.equal(
          `${ERROR_REVERT} Only latest CFD Factory can add new CFDs`,
          err.message)
      }
    })
  })
})
