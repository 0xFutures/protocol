import Promise from 'bluebird'
import has from 'lodash/has'

import {
  feedsInstanceDeployed
} from './contracts'
import {
  assertBigNumberOrString,
  fromContractBigNumber,
  toContractBigNumber,
  getAllEventsWithName,
  signAndSendTransaction
} from './utils'

const pushGasLimit = 100000
const addMarketGasLimit = 200000
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
  push (marketIdStr, read, ts, doneCallback) {
    this.pushQueue.unshift({marketIdStr: marketIdStr, read: read, ts: ts, doneCallback: doneCallback});
  }

  /**
   * Read latest value from the contract.
   *
   * @param marketIdStr Read value for this market (eg. "Poloniex_ETH_USD")
   * @return {read: <BigNumber read value>, ts: <epoch milliseconds timestamp>}
   */
  async read (marketIdStr) {
    const decimals = await this.feeds.decimals.call()
    const marketId = this.marketIdStrToBytes(marketIdStr)
    const [readBigNumber, tsMillis] = await this.feeds.read.call(marketId)
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
    const decimals = await this.feeds.methods.decimals().call()
    const readBigNumber = toContractBigNumber(next.read, decimals).toFixed()
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
        next.doneCallback(receipt);
        // When transaction has been mined, send the next one if needed
        self.currentTx = undefined;
        self.pushNextQueueValue();
      }, (err) => {
        this.currentTx = undefined;
      });
    }
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
    this.feeds = await feedsInstanceDeployed(this.config, this.web3)
    // Start our recurrent function to check and eventually start pushing on the blockchain
    setInterval(function() {
      // If no pending transaction, push the next value waiting in the queue
      if (self.currentTx == undefined)
        self.pushNextQueueValue();
    }, delayBetweenPush)
    return this
  }
}