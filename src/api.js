import Promise from 'bluebird'
import has from 'lodash/has'

import {
  feedsInstanceDeployed
} from './contracts'
import {
  assertBigNumberOrString,
  fromContractBigNumber,
  toContractBigNumber
} from './utils'

const pushGasLimit = 100000
const addMarketGasLimit = 200000

export default class API {
  /**
   * Create a new instance of this class setting up contract handles and
   * validiting the config addresses point to actual deployed contracts.
   *
   * @param config Configuration object with all properties as per
   *               config.json.template
   * @param web3 Initiated and connected web3 instance
   *
   * @return Constructed and initialised instance of this class
   */
  static async newInstance (config, web3) {
    if (web3.isConnected() !== true) {
      return Promise.reject(
        new Error('web3 is not connected - check the endpoint')
      )
    }
    const api = new API(config, web3)
    await api.initialise()
    return api
  }

  /**
   * Push new read value and timestamp to the contract.
   * @param marketIdStr Push read for this market (eg. "Poloniex_ETH_USD")
   * @param read BigNumber|String
   * @param ts UNIX millisecond timestamp of the read.
   * @return Promise resolving to the transaction receipt
   */
  async push (marketIdStr, read, ts) {
    assertBigNumberOrString(read)
    const decimals = await this.feeds.decimals.call()
    const readBigNumber = toContractBigNumber(read, decimals).toString()
    const marketId = this.marketIdStrToBytes(marketIdStr)
    return this.feeds.push(marketId, readBigNumber, ts, {gas: pushGasLimit})
  }

  /**
   * Read latest value from the contract.
   *
   * @param marketIdStr Read value for this market (eg. "Poloniex_ETH_USD")
   * @return {read: <BigNumber read value>, ts: <epoch milliseconds timestamp>}
   */
  async read (marketIdStr) {
    const marketId = this.marketIdStrToBytes(marketIdStr)
    const [readBigNumber, tsMillis] = await this.feeds.read.call(marketId)
    const decimals = await this.feeds.decimals.call()
    const read = fromContractBigNumber(readBigNumber, decimals)
    return {read, ts: tsMillis.toNumber()}
  }

  /**
   * Add a new market feed.
   * @param marketIdStr Market ID for new market (eg. "Poloniex_ETH_USD")
   * @return Promise resolving to the transaction receipt
   */
  async addMarket (marketIdStr) {
    return this.feeds.addMarket(marketIdStr, {
      from: this.config.ownerAccountAddr,
      gas: addMarketGasLimit
    })
  }

  /**
   * Register callback for LogFeedsPush events - whenever a Feeds.push() call
   * completes.
   * @param Callback expecting error as the first param and an object with
   *        event arguments as the second param.
   */
  watchPushEvents (onEventCallback) {
    const event = this.feeds.LogFeedsPush()
    event.watch((error, event) => {
      if (error) onEventCallback(error, {})
      this.eventParse(event).then(eventArgs =>
        onEventCallback(error, eventArgs)
      )
    })
  }

  /**
   * Get all markets in the feeds contract with a mapping to isActive.
   * @param onSuccessCallback Callback that will receive a list like:
   *        [
   *          {bytesId: "0xabc...", strId: "Poloniex_BTC_ETH", active: true},
   *          {bytesId: "0x123...", strId: "Binance_USD_ETH", active: false},
   *          ...
   *        ]
   * @param onErrorCallback Callback that will receive any errors
   */
  getMarkets (onSuccessCallback, onErrorCallback) {
    const event = this.feeds.LogFeedsMarketAdded(
      {},
      {fromBlock: 0, toBlock: 'latest'}
    )
    event.get((error, events) => {
      if (error) {
        onErrorCallback(error)
        return
      }
      const markets = events.map(event => event.args)
      Promise.all(
        markets.map(market => {
          const {bytesId, strId} = market
          return this.feeds.isMarketActive.call(bytesId).then(active => {
            return {bytesId, strId, active}
          })
        })
      ).then(onSuccessCallback)
    })
  }

  /**
   * Get all the push events for all (or a specific) market(s) at an interval of blocks
   * @param fromBlock, The beginning of the block interval
   * @param toBlock, The end of the block interval
   * @param onSuccessCallback Callback that will receive a list like:
   *        [
   *          {marketId: "0x123...", timestamp: BigNumber, value: BigNumber}
   *          {marketId: "0x123...", timestamp: BigNumber, value: BigNumber}
   *          ...
   *        ]
   * @param onErrorCallback Callback that will receive any errors
   */
  async getAllFeedsPushEvents (
    fromBlock,
    toBlock,
    onSuccessCallback,
    onErrorCallback
  ) {
    const decimals = await this.feeds.decimals.call()
    const event = this.feeds.LogFeedsPush(
      {},
      {fromBlock: fromBlock, toBlock: toBlock}
    )
    event.get((error, events) => {
      if (error) {
        onErrorCallback(error)
        return
      }
      Promise.all(
        events.map(event => {
          event.args.value = fromContractBigNumber(event.args.value, decimals)
          return event.args
        })
      ).then(onSuccessCallback)
    })
  }

  /**
   * Convert market id in string format to bytes32 format
   * @param marketIdStr eg. Poloniex_ETH_USD
   * @return bytes32 sha3 of the marketIdStr
   */
  marketIdStrToBytes (marketIdStr) {
    return this.web3.sha3(marketIdStr)
  }

  /**
   * Convert market id in bytes32 format to string format by looking up the
   * Feeds.marketNames smart contract list.
   * @param marketId sha3 of the market id string
   * @return Market id string
   */
  marketIdBytesToStr (marketId) {
    return this.feeds.marketNames.call(marketId)
  }

  /**
   * Takes a raw event and extracts args field only.
   * Additionally any marketId in bytes32 format is converted back to a string.
   * @param event Raw JSON event from Ethereum client.
   * @return Object with the event arguments.
   */
  async eventParse (event) {
    const eventArgs = event.args
    if (has(eventArgs, 'marketId')) {
      eventArgs.marketId = await this.marketIdBytesToStr(eventArgs.marketId)
    }
    return eventArgs
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
   */
  constructor (config, web3) {
    this.config = config
    this.web3 = web3
    this.web3.eth.getCodeAsync = Promise.promisify(this.web3.eth.getCode)
  }

  /**
   * NOTE: use newInstance() to create new instances rather then call this
   *       routine.
   *
   * Sets up contract handles and validiting the config addresses point to
   * actual deployed contracts. Seperate to the constructor as it needs to make
   * asynchronous calls.
   *
   * @return api instance
   */
  async initialise () {
    this.feeds = await feedsInstanceDeployed(this.config, this.web3)
    return this
  }
}
