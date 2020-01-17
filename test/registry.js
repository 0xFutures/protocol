import { assert } from 'chai'
import { registryInstance } from '../src/infura/contracts'
import { config, web3 } from './helpers/setup'

const ERROR_REVERT = 'Returned error: VM Exception while processing transaction: revert'
const ADDRESS_UNDEFINED = '0x0000000000000000000000000000000000000000'

describe('registry.js', function () {
  const Registry = registryInstance(web3.currentProvider, config)

  web3.eth.personal.getAccounts().then((accounts) => {

    const anAddr = '0x333322221111ddddeeeeffff0000aaaabbbbcccc'

    describe('CFDFactoryLatest', () => {
      it('unregistrered contract returns 0x0', async () => {
        const registry = await Registry.deploy({}).send({
          from: config.ownerAccountAddr,
          gas: config.gasDefault
        })
        assert.equal(ADDRESS_UNDEFINED, await registry.methods.getCFDFactoryLatest().call())
      })

      it('get and set', async () => {
        const registry = await Registry.deploy({}).send({
          from: config.ownerAccountAddr,
          gas: config.gasDefault
        })
        const cfdFactoryAddr = anAddr
        await registry.methods.setCFDFactoryLatest(cfdFactoryAddr).send()
        let read = await registry.methods.getCFDFactoryLatest().call()
        assert.equal(cfdFactoryAddr, read.toLowerCase())
      })

      it('only owner is authorised to setCFDFactoryLatest', async () => {
        const registry = await Registry.deploy({}).send({
          from: config.ownerAccountAddr,
          gas: config.gasDefault
        })
        try {
          let res = await registry.methods.setCFDFactoryLatest(anAddr).send({ from: accounts[2] })
          assert.fail(`expected failure`)
        } catch (err) {
          const reg = new RegExp(ERROR_REVERT + '.*')
          assert.match(err.message, reg)
        }
      })
    })

    describe('allCFDs', () => {
      it('unregistered', async () => {
        const registry = await Registry.deploy({}).send({
          from: config.ownerAccountAddr,
          gas: config.gasDefault
        })
        assert.equal(ADDRESS_UNDEFINED, await registry.methods.allCFDs(anAddr).call())
      })

      it('registered', async () => {
        const cfdAddr = anAddr
        const cfdFactoryAddr = accounts[9]
        const registry = await Registry.deploy({}).send({
          from: config.ownerAccountAddr,
          gas: config.gasDefault
        })
        await registry.methods.setCFDFactoryLatest(cfdFactoryAddr).send()
        await registry.methods.addCFD(cfdAddr).send({ from: cfdFactoryAddr })
        assert.equal(cfdFactoryAddr, await registry.methods.allCFDs(cfdAddr).call())
      })

      it('only factory is authorised to addCFD', async () => {
        const registry = await Registry.deploy({}).send({
          from: config.ownerAccountAddr,
          gas: config.gasDefault
        })
        try {
          await registry.methods.addCFD(anAddr).send({ from: accounts[2] })
          assert.fail(`expected failure`)
        } catch (err) {
          assert.equal(
            `${ERROR_REVERT} Only latest CFD Factory can add new CFDs`,
            err.message)
        }
      })
    })

  });
})
