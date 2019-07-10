import BigNumber from 'bignumber.js'
import * as Utils from 'web3-utils'

import { toContractBigNumber } from '../../src/infura/utils'

const EthDaiMarketStr = 'Kyber_ETH_DAI'
const EthWbtcMarketStr = 'Kyber_ETH_WBTC'

const KyberNativeEthAddress = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

/**
 * Add market to PriceFeedsKyber contract.
 * @param {Web3.eth.Contract} PriceFeedsKyber PriceFeedsKyber contract handle
 * @param {Web3.eth.Contract} tokenContractAddr Token contract address (eg. DAI ERC20)
 * @param {string} marketStr String id of market
 */
const addMarketKyber = async (priceFeedsKyber, tokenContractAddr, marketStr) =>
  priceFeedsKyber.methods.addMarket(marketStr, tokenContractAddr).send()

/**
 * Push a given price into the kyber mock contract.
 * @param {Web3.eth.Contract} kyberMock KyberNetworkProxy contract handle
 * @param {string} tokenAddress Address of token on kyber market
 * @param {BigNumber|string} price value in raw form (eg. '160.5' for 160.60 USD)
 */
const mockKyberPut = async (kyberMock, tokenAddress, price) => {
  const valueAdjusted = toContractBigNumber(price)
  const valueAsBytes32 = Utils.padLeft(Utils.numberToHex(valueAdjusted), 64)
  await kyberMock.methods.put(tokenAddress, valueAsBytes32).send()
}

export {
  EthDaiMarketStr,
  EthWbtcMarketStr,
  KyberNativeEthAddress,
  addMarketKyber,
  mockKyberPut,
}
