import Promise from 'bluebird'

import {
  priceFeedsInstanceDeployed,
  priceFeedsKyberInstanceDeployed,
  daiTokenInstanceDeployed
} from './contracts'
import { fromContractBigNumber, getAllEventsWithName } from './utils'

const addMarketGasLimit = 700000
// Number of milliseconds between each check for pushing a new value
const delayBetweenPush = 5000

const getMarketsFromEventLogs = (
  api,
  eventName,
  contractInstance,
  onSuccessCallback,
  onErrorCallback
) => {
  const fromBlock = api.config.deploymentBlockNumber || 0,
    self = api
  getAllEventsWithName(eventName, contractInstance, fromBlock, 'latest').then(
    markets => {
      Promise.all(
        markets.map(async market => {
          if (
            market == undefined ||
            market.raw == undefined ||
            market.raw.topics == undefined ||
            market.raw.topics.length <= 1
          ) {
            return undefined
          }
          const bytesId = market.raw.topics[1]
          const strId = await self.marketIdBytesToStr(bytesId)
          return self.priceFeeds.methods
            .isMarketActive(bytesId)
            .call()
            .then(active => {
              return { bytesId, strId, active }
            })
        })
      ).then(onSuccessCallback)
    },
    err => {
      onErrorCallback(err)
    }
  )
}

export default class API {
  /**
   * Create a new instance of this class setting up contract handles and
   * validiting the config addresses point to actual deployed contracts.
   *
   * @param config Configuration object with all properties as per
   *               config.json.template
   * @param web3 Initiated and connected web3 instance
   * @param privateKey (optional) The private key used to sign the transactions (for using Infura for example)
   *
   * @return Constructed and initialised instance of this class
   */
  static async newInstance(config, web3, privateKey) {
    const api = new API(config, web3, privateKey)
    await api.initialise()
    return api
  }

  /**
   * Read latest value from the feeds.
   *
   * @param {string} marketIdStr Read value for this market (eg. "Kyber_ETH_DAI")
   * @return {BigNumber} price
   */
  async read(marketIdStr) {
    const marketId = this.marketIdStrToBytes(marketIdStr)
    const decimals = this.getMarketDecimals(marketIdStr)
    const price = await this.priceFeeds.methods.read(marketId).call()
    return fromContractBigNumber(price, decimals)
  }

  /**
   * Get the DAI balance for this address
   */
  async getDaiBalance(address) {
    const balance = await this.daiToken.methods.balanceOf(address).call()
    return fromContractBigNumber(balance)
  }

  /**
   * Add a new kyber market feed.
   * @param marketIdStr Market ID for new market (eg. "Kyber_ETH_DAI")
   * @param tokenAddr Address "from" of ERC20 token on market
   * @param tokenAddrTo Address "to" of ERC20 token on market
   * @return Promise resolving to the transaction receipt
   */
  async addMarketKyber(marketIdStr, tokenAddr, tokenAddrTo) {
    const self = this
    return new Promise(function(resolve, reject) {
      self.priceFeedsKyber.methods
        .addMarket(marketIdStr, tokenAddr, tokenAddrTo)
        .send({
          from: self.config.ownerAccountAddr,
          gas: addMarketGasLimit
        })
        .once('receipt', function(receipt) {
          // Transaction has been mined
          resolve(receipt)
        })
        .on('error', function(error) {
          // Error
          reject(error)
        })
    })
  }

  /**
   * Pop the next value in the queue, and start the transaction
   */
  pushNextQueueValue() {
    var next = this.pushQueue.pop(),
      self = this
    if (next != undefined) {
      console.log(
        '[API-Infura] Start pushing ' +
          next.read +
          ' on ' +
          next.marketIdStr +
          '...'
      )
      this.currentTx = { requesting: true }
      this.signAndPush(next)
        .then(receipt => {
          // Done callback
          if (next.doneCallback != undefined) next.doneCallback(receipt)
          // When transaction has been mined, send the next one if needed
          self.currentTx = undefined
          self.pushNextQueueValue()
        })
        .catch(err => {
          // Error callback
          if (next.errorCallback != undefined) next.errorCallback(err)
          this.currentTx = undefined
        })
    }
  }

  /**
   * Get all markets in the PriceFeedsKyber contract with a mapping to isActive.
   * @param onSuccessCallback Callback that will receive a list like:
   *        [
   *          {bytesId: "0xabc...", strId: "Kyber_ETH_DAI", active: true},
   *          {bytesId: "0x123...", strId: "Kyber_ETH_WBTC", active: false},
   *          ...
   *        ]
   * @param onErrorCallback Callback that will receive any errors
   */
  getMarketsKyber(onSuccessCallback, onErrorCallback) {
    getMarketsFromEventLogs(
      this,
      'LogPriceFeedsKyberMarketAdded',
      this.priceFeedsKyber,
      onSuccessCallback,
      onErrorCallback
    )
  }

  /**
   * Convert market id in string format to bytes32 format
   * @param marketIdStr eg. Kyber_ETH_DAI
   * @return bytes32 sha3 of the marketIdStr
   */
  marketIdStrToBytes(marketIdStr) {
    return this.web3.utils.sha3(marketIdStr)
  }

  /**
   * Convert market id in bytes32 format to string format by looking up the
   * Feeds.marketNames smart contract list.
   * @param marketId sha3 of the market id string
   * @return Market id string
   */
  marketIdBytesToStr(marketId) {
    return this.priceFeeds.methods.marketName(marketId).call()
  }

  /**
   * Look in the config file for the market decimals
   * If not found, returns the default erc20 decimals, which is 18
   */
  getMarketDecimals(marketId) {
    var markets = this.config.feeds.kyber.markets, decimals = 18;
    for (var marketIdStr in markets) {
      if (marketIdStr.toLowerCase() == marketId.toLowerCase() && markets[marketIdStr].decimals != undefined)
        decimals = parseInt(markets[marketIdStr].decimals);
    }
    return decimals;
  }

  /**
   * NOTE: use API.newInstance to create a new instance rather then this
   *       constructor.
   *
   * Construct an API instance setting config and web3. initialise() must be
   * called after this to setup the contract handler. newInstance() does both
   * these steps so is the preferred way to get an instance of this class.
   *
   * @param config Configuration object with all properties as per
   *               config.json.template
   * @param web3 Initiated web3 instance for the network to work with.
   * @param privateKey (optional) The private key used to sign the transactions (for using Infura for example)
   */
  constructor(config, web3, privateKey = undefined) {
    this.config = config
    this.web3 = web3
    this.privateKey = privateKey
    // Our pushes queue (since we can only push one at a time)
    this.pushQueue = []
    // When a transaction is pending, that variable will hold the transaction hash
    this.currentTx = undefined
  }

  /**
   * NOTE: use newInstance() to create new instances rather then call this
   *       routine.
   *
   * Sets up contract handles and validiting the config addresses point to
   * actual deployed contracts. Seperate to the constructor as it needs to make
   * asynchronous calls.
   *
   * @return API instance
   */
  async initialise() {
    var self = this
    this.priceFeeds = await priceFeedsInstanceDeployed(this.config, this.web3)
    this.priceFeedsKyber = await priceFeedsKyberInstanceDeployed(
      this.config,
      this.web3
    )
    this.daiToken = await daiTokenInstanceDeployed(this.config, this.web3)
    // Start our recurrent function to check and eventually start pushing on the blockchain
    setInterval(function() {
      // If no pending transaction, push the next value waiting in the queue
      if (self.currentTx == undefined) self.pushNextQueueValue()
    }, delayBetweenPush)
    return this
  }
}
