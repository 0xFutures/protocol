import { assert } from 'chai'
import * as Utils from 'web3-utils'

import { kyberFacadeInstance } from '../../src/infura/contracts'
import { assertEqualBN } from '../helpers/assert'
import { deployMocks } from '../helpers/deploy'
import { config, web3 } from '../helpers/setup'

const oneEthBN = Utils.toBN(Utils.toWei('1', 'ether'))

const KyberFacade = kyberFacadeInstance(web3.currentProvider, config)

let daiToken
let daiTokenAddr
let kyberFacade
let kyberNetworkProxy

describe('KyberFacade', function () {
  beforeEach(async () => {
    const mocks = await deployMocks(web3, config)
    daiToken = mocks.daiToken
    daiTokenAddr = daiToken.options.address
    kyberNetworkProxy = mocks.kyberNetworkProxy

    kyberFacade = await KyberFacade.deploy({
      arguments: [
        kyberNetworkProxy.options.address,
        config.feeds.kyber.walletId
      ]
    }).send()
  })

  it('ethToDai', async () => {
    const accounts = await web3.eth.getAccounts()
    const destAddress = accounts[5]
    const ethDaiPrice = await kyberNetworkProxy.methods.rates(daiTokenAddr).call()
    const ethAmount = oneEthBN

    await kyberFacade.methods.ethToDai(
      daiTokenAddr,
      destAddress
    ).send({
      value: ethAmount
    })

    assertEqualBN(
      await daiToken.methods.balanceOf(destAddress).call(),
      Utils.toBN(ethDaiPrice).mul(ethAmount).div(oneEthBN),
      'DAI transfer amount incorrect'
    )
  })
})
