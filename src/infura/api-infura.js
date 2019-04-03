import Promise from 'bluebird'
import has from 'lodash/has'

import {
  feedsInstanceDeployed,
  feedsMakerEthUsdInstanceDeployed
} from './contracts'
import {
  assertBigNumberOrString,
  toContractBigNumber,
  fromContractBigNumber,
  getAllEventsWithName,
  signAndSendTransaction,
  getMarketFromHex
} from './utils'

const pushGasLimit = 700000
const addMarketGasLimit = 700000
// Number of milliseconds between each check for pushing a new value
const delayBetweenPush = 5000

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
  static async newInstance (config, web3, privateKey) {
    /*if (web3 == undefined || web3.isConnected() !== true) {
      return Promise.reject(
        new Error('web3 is not connected - check the endpoint')
      )
    }*/
    const api = new API(config, web3, privateKey)
    await api.initialise()
    return api
  }

  /**
   * Add this push in our queue
   * It will be push on the blockchain when possible (meaning when no pending transactions)
   * @param marketIdStr Push read for this market (eg. "Poloniex_ETH_USD")
   * @param read BigNumber|String
   * @param ts UNIX millisecond timestamp of the read.
   * @param doneCallback Callback when the transaction has been mined
   */
  push (marketIdStr, read, ts) {
    var self = this;
    return new Promise(function(resolve, reject) {
      self.pushQueue.unshift({marketIdStr: marketIdStr, read: read, ts: ts, doneCallback: function(receipt) {
        // Success
        resolve(receipt);
      }, errorCallback: function(err) {
        // Error
        reject(err);
      }});
    });
  }

  /**
   * Read latest value from the contract.
   *
   * @param marketIdStr Read value for this market (eg. "Poloniex_ETH_USD")
   * @return {value: <read value>, timestamp: <epoch milliseconds timestamp>}
   */
  async read (marketIdStr) {
    // Find which feed source to use
    // If no feed found for this market, use the default one (daemon feed)
    if (this.specificFeeds[marketIdStr] != undefined) {
      // Use the specific source feed
      const res = await this.specificFeeds[marketIdStr].methods.read().call();
      const numberStr = this.web3.utils.hexToNumberString(res);
      return {value: this.web3.utils.fromWei(numberStr)};
    }
    else {
      // Else, use the default source feed
      const marketId = this.marketIdStrToBytes(marketIdStr)
      const res = await this.feeds.methods.read(marketId).call();
      return {value: fromContractBigNumber(res.value, this.decimals), timestamp: res.timestamp};
    }
  }

  /**
   * Add a new market feed.
   * @param marketIdStr Market ID for new market (eg. "Poloniex_ETH_USD")
   * @return Promise resolving to the transaction receipt
   */
  async addMarket (marketIdStr) {
    return new Promise(function(resolve, reject) {
      this.feeds.methods.addMarket(marketIdStr).send({
        from: this.config.ownerAccountAddr,
        gas: addMarketGasLimit
      }).once('receipt', function(receipt) {
        // Transaction has been mined
        resolve(receipt);
      }).on('error', function(error) {
        // Error
        reject(error);
      });
    });
  }

  /**
   * Register callback for LogFeedsPush events - whenever a Feeds.push() call
   * completes.
   * @param Callback expecting error as the first param and an object with
   *        event arguments as the second param.
   */
  watchPushEvents (onEventCallback) {
    this.feeds.events.allEvents({fromBlock: 0}, (error, event) => {
      if (event != undefined)
        onEventCallback(event);
    });
  }

  /**
   * Get all the push events for all (or a specific) market(s) at an interval of blocks
   * @param fromBlock, The beginning of the block interval
   * @param toBlock, The end of the block interval
   * @return a promise with the array of events
   */
  async getAllFeedsPushEvents (
    fromBlock = this.config.deploymentBlockNumber || 0,
    toBlock = 'latest'
  ) {
    return getAllEventsWithName("LogFeedsPush", this.feeds, fromBlock, toBlock);
  }

  /**
   * Sign and push new read value and timestamp to the contract.
   * @param marketIdStr Push read for this market (eg. "Poloniex_ETH_USD")
   * @param read BigNumber|String
   * @param ts UNIX millisecond timestamp of the read.
   * @return Promise resolving to the transaction receipt
   */
  async signAndPush (next) {
    assertBigNumberOrString(next.read)
    const readBigNumber = toContractBigNumber(next.read, this.decimals).toFixed()
    const marketId = this.marketIdStrToBytes(next.marketIdStr)
    return signAndSendTransaction(this.web3, this.config.daemonAccountAddr, this.privateKey, this.config.feedContractAddr,
            this.feeds.methods.push(marketId, readBigNumber, next.ts).encodeABI(), this.config.gasPrice, pushGasLimit);
  }

  /**
   * Pop the next value in the queue, and start the transaction
   */
  pushNextQueueValue() {
    var next = this.pushQueue.pop(), self = this;
    if (next != undefined) {
      console.log("[API-Infura] Start pushing " + next.read + " on " + next.marketIdStr + "...");
      this.currentTx = {requesting: true};
      this.signAndPush(next).then((receipt) => {
        // Done callback
        if (next.doneCallback != undefined)
          next.doneCallback(receipt);
        // When transaction has been mined, send the next one if needed
        self.currentTx = undefined;
        self.pushNextQueueValue();
      }).catch((err) => {
        // Error callback
        if (next.errorCallback != undefined)
          next.errorCallback(err);
        this.currentTx = undefined;
      });
    }
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
    const fromBlock = this.config.deploymentBlockNumber || 0, self = this;
    getAllEventsWithName("LogFeedsMarketAdded", this.feeds, fromBlock, 'latest').then((markets) => {
      Promise.all(
        markets.map(async market => {
          if (market == undefined || market.raw == undefined || market.raw.topics == undefined ||
              market.raw.topics.length <= 1)
            return undefined;
          const bytesId = market.raw.topics[1];
          const strId = await self.marketIdBytesToStr(bytesId);
          return this.feeds.methods.isMarketActive(bytesId).call().then(active => {
            return {bytesId, strId, active}
          })
        })
      ).then(onSuccessCallback);
    }, (err) => {
      onErrorCallback(err);
    });
  }

  /**
   * Convert market id in string format to bytes32 format
   * @param marketIdStr eg. Poloniex_ETH_USD
   * @return bytes32 sha3 of the marketIdStr
   */
  marketIdStrToBytes (marketIdStr) {
    return this.web3.utils.sha3(marketIdStr)
  }

  /**
   * Convert market id in bytes32 format to string format by looking up the
   * Feeds.marketNames smart contract list.
   * @param marketId sha3 of the market id string
   * @return Market id string
   */
  marketIdBytesToStr (marketId) {
    return this.feeds.methods.marketNames(marketId).call()
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
  constructor (config, web3, privateKey = undefined) {
    this.config = config
    this.web3 = web3
    this.privateKey = privateKey
    // Our pushes queue (since we can only push one at a time)
    this.pushQueue = [];
    // When a transaction is pending, that variable will hold the transaction hash
    this.currentTx = undefined;
    // Specify another feed source for some markets
    // If the market is not listed in this object, it means we will use the default daemon feed
    // Else, we use the specified feed
    this.specificFeeds = {};
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
  async initialise () {
    var self = this;
    this.feeds = await feedsInstanceDeployed(this.config, this.web3);
    this.decimals = await this.feeds.methods.decimals().call();
    // Specify another feed source for market Coinbase_ETH
    this.specificFeeds['Coinbase_ETH'] = await feedsMakerEthUsdInstanceDeployed(this.config, this.web3);
    // Start our recurrent function to check and eventually start pushing on the blockchain
    setInterval(function() {
      // If no pending transaction, push the next value waiting in the queue
      if (self.currentTx == undefined)
        self.pushNextQueueValue();
    }, delayBetweenPush)
    return this
  }
}
