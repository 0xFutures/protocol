import { assert } from 'chai'
import * as Utils from 'web3-utils'

import {
  ethUsdMakerInstance,
  priceFeedsInstance,
  priceFeedsExternalInstance,
  priceFeedsInternalInstance
} from '../../src/infura/contracts'
import { toContractBigNumber } from '../../src/infura/utils'
import { assertEqualBN } from '../helpers/assert'
import { config, web3 } from '../helpers/setup'

const EthUsdMakerABI = require('../../build/contracts/EthUsdMakerInterface.json').abi
const EthUsdMakerContract = new web3.eth.Contract(EthUsdMakerABI)

const MakerMarketStr = 'MakerDAO_USD_ETH'
const CoinbaseMarketStr = 'Coinbase_USD_BTC'

const MakerReadCallSig = EthUsdMakerContract._jsonInterface.find(
  el => el.name === 'read'
).signature

const MakerMarket = {
  name: MakerMarketStr,
  id: Utils.sha3(MakerMarketStr),
  address: undefined, // added when deployed below
  callSig: MakerReadCallSig
}

const CoinbaseMarket = {
  name: CoinbaseMarketStr,
  id: Utils.sha3(CoinbaseMarketStr)
}

describe('PriceFeeds', function () {
  const PriceFeeds = priceFeedsInstance(web3.currentProvider, config)
  const PriceFeedsExternal = priceFeedsExternalInstance(web3.currentProvider, config)
  const PriceFeedsInternal = priceFeedsInternalInstance(web3.currentProvider, config)
  const EthUsdMakerMock = ethUsdMakerInstance(web3.currentProvider, config)

  const OWNER_ACCOUNT = config.ownerAccountAddr
  const DAEMON_ACCOUNT = config.daemonAccountAddr

  const coinbaseBTCValueStr = '5000.50'

  const makerValueStr = '164.625'
  const makerValueContract = toContractBigNumber(makerValueStr)

  const txOpts = { from: OWNER_ACCOUNT, gas: 2000000 }

  let pfiContract
  let pfeContract
  let pfContract
  let ethUsdMakerContract

  let coinbaseBTCValueContract

  beforeEach(async () => {
    // PriceFeedsInternal contract
    pfiContract = await PriceFeedsInternal.deploy({}).send(txOpts)
    await pfiContract.methods.setDaemonAccount(DAEMON_ACCOUNT).send();
    await pfiContract.methods.addMarket(CoinbaseMarket.name).send();

    // push value
    coinbaseBTCValueContract = toContractBigNumber(coinbaseBTCValueStr)
    await pfiContract.methods.push(
      CoinbaseMarket.id,
      coinbaseBTCValueContract.toFixed(),
      Date.now()
    ).send({
      from: DAEMON_ACCOUNT
    })

    // PriceFeedsExternal contract
    pfeContract = await PriceFeedsExternal.deploy({}).send(txOpts)

    ethUsdMakerContract = await EthUsdMakerMock.deploy({}).send(txOpts)
    MakerMarket.address = ethUsdMakerContract.options.address
    await pfeContract.methods.addMarket(
      MakerMarket.name,
      MakerMarket.address,
      MakerMarket.callSig
    ).send();

    const valueAsBytes32 = Utils.padLeft(Utils.numberToHex(makerValueContract), 64)
    await ethUsdMakerContract.methods.put(valueAsBytes32).send()

    // PriceFeeds contract
    pfContract = await PriceFeeds.deploy({
      arguments: [
        pfiContract.options.address,
        pfeContract.options.address
      ]
    }).send(txOpts)
  })

  const REVERT_MESSAGE = `Returned error: ` +
    `VM Exception while processing transaction: revert`
  const INACTIVE_MARKET_MESSAGE = `Price requested for inactive or unknown market`
  const ZERO_VALUE_MESSAGE = `Market price is zero`

  const assertReverts = async (feedContract, fnName, marketId, expectedMsg) => {
    try {
      await feedContract.methods[fnName](marketId).call()
      assert.fail('expected reject')
    } catch (err) {
      assert.equal(
        err.message,
        `${REVERT_MESSAGE} ${expectedMsg}`,
        'revert message unexpected'
      )
    }
  }

  describe('read', () => {
    it('internal ok', async () => {
      assertEqualBN(
        await pfContract.methods.read(MakerMarket.id).call(),
        makerValueContract,
        'read() value for internal market wrong'
      )
    })
    it('external ok', async () => {
      assertEqualBN(
        await pfContract.methods.read(CoinbaseMarket.id).call(),
        coinbaseBTCValueContract,
        'read() value for external market wrong'
      )
    })

    it('market not active reverts', async () => {
      await assertReverts(
        pfContract,
        'read',
        Utils.sha3('not_an_active_market'),
        INACTIVE_MARKET_MESSAGE
      )
    })

    describe('market zero value reverts', () => {
      it('external', async () => {
        await ethUsdMakerContract.methods.put('0x0').send()
        await assertReverts(pfContract, 'read', MakerMarket.id, ZERO_VALUE_MESSAGE)
      })

      it('internal', async () => {
        await pfiContract.methods.push(CoinbaseMarket.id, '0', Date.now()).send({
          from: DAEMON_ACCOUNT
        })
        await assertReverts(pfContract, 'read', CoinbaseMarket.id, ZERO_VALUE_MESSAGE)
      })
    })
  })

  describe('marketName', () => {
    it('internal ok', async () => {
      assert.equal(
        await pfContract.methods.marketName(MakerMarket.id).call(),
        MakerMarket.name,
        'marketName() value internal market wrong'
      )
    })
    it('external ok', async () => {
      assert.equal(
        await pfContract.methods.marketName(CoinbaseMarket.id).call(),
        CoinbaseMarket.name,
        'marketName() value for external market wrong'
      )
    })

    it('market not active reverts', async () => {
      await assertReverts(
        pfContract,
        'marketName',
        Utils.sha3('not_an_active_market'),
        INACTIVE_MARKET_MESSAGE
      )
    })
  })

})
