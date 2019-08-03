import { existsSync, readFileSync } from 'fs'
import BigNumber from 'bignumber.js'
import Web3 from 'web3'

import API from '../src/infura/api-infura'
import {
  kyberNetworkProxyInstanceDeployed,
  priceFeedsInstanceDeployed,
  priceFeedsKyberInstanceDeployed
} from '../src/infura/contracts'
import { fromContractBigNumber } from '../src/infura/utils'

if (process.argv.length < 3 || !existsSync(process.argv[2])) {
  console.error(`Usage: ${process.argv[1]} <config file>`)
  process.exit(-1)
}

const config = JSON.parse(readFileSync(process.argv[2]))
const web3 = new Web3(new Web3.providers.HttpProvider(config.rpcAddr))

const MARKETS = config.feeds.kyber.markets

const BITMASK_EXCLUDE_PERMISSIONLESS = new web3.utils.BN(1).shln(255);
const ONE_ETH = web3.utils.toWei(web3.utils.toBN(1), 'ether')
const SRC_QTY_ONE_ETH_WITH_BITMASK = BITMASK_EXCLUDE_PERMISSIONLESS.or(ONE_ETH).toString()

// console.log(`1 ETH with Bitmask: ${SRC_QTY_ONE_ETH_WITH_BITMASK}`)

const logRate = (prefix, rate) => {
  const rateAdjusted = fromContractBigNumber(rate)
  console.log(`  ${prefix}: ${rateAdjusted} ` +
    `(reverse: ${new BigNumber('1').div(rateAdjusted)})`
  )
}

const summary = async () => {
  const api = await API.newInstance(config, web3)
  const kyberNetworkProxy = await kyberNetworkProxyInstanceDeployed(config, web3)
  const priceFeeds = await priceFeedsInstanceDeployed(config, web3)
  const priceFeedsKyber = await priceFeedsKyberInstanceDeployed(config, web3)

  console.log('\nMarkets\n=======\n')

  await new Promise((resolve) => api.getMarketsKyber(resolve)).
    then(markets =>
      console.log(JSON.stringify(markets, null, 2))
    )


  console.log('\nRates (through PriceFeeds - permissioned only)')
  console.log('==============================================\n')

  await Promise.all(
    Object.entries(MARKETS).map(([marketId]) => {
      return api.read(marketId).then(rate =>
        console.log(`${marketId}: ${rate}`)
      )
    })
  )


  console.log('\nRates (direct from KyberNetworkProxy)')
  console.log('=======================================\n')

  await Promise.all(
    Object.entries(MARKETS).map(([marketId, contracts]) => {
      const { from: fromTokenAddr, to: toTokenAddr } = contracts
      return Promise.all([
        kyberNetworkProxy.methods.getExpectedRate(
          fromTokenAddr,
          toTokenAddr,
          SRC_QTY_ONE_ETH_WITH_BITMASK
        ).call(),

        kyberNetworkProxy.methods.getExpectedRate(
          fromTokenAddr,
          toTokenAddr,
          ONE_ETH.toString()
        ).call()
      ]).then(([ratePermOnly, ratePermLess]) => {
        console.log(`${marketId}:`)
        logRate(`permissioned only  `, ratePermOnly.expectedRate)
        logRate(`incl permissionless`, ratePermLess.expectedRate)
      })
    })
  )

  console.log('\nRates (direct from PriceFeeds/PriceFeedsKyber)')
  console.log('================================================\n')

  await Promise.all(
    Object.entries(MARKETS).map(([marketIdStr]) => {
      const marketId = web3.utils.keccak256(marketIdStr)
      return Promise.all([
        priceFeeds.methods.read(marketId).call(),
        priceFeedsKyber.methods.read(marketId).call()
      ]).then(([pfRate, pfkRate]) => {
        console.log(`${marketIdStr}:`)
        logRate(`PriceFeeds     `, pfRate)
        logRate(`PriceFeedsKyber`, pfkRate)
      })
    })
  )
}

summary().
  then(() => process.exit()).
  catch(err => {
    console.error(err);
    process.exit(-1)
  })