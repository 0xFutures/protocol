import Promise from 'bluebird'
import {
  cfdInstance
} from './contracts'

// Transaction event timeout (in ms)
const TRANSACTIONS_EVENT_TIMEOUT = 30000;

export default class EVENTAPI {

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
    const api = new EVENTAPI(config, web3)
    await api.initialise()
    return api
  }

  /**
   * Get all the transactions events for each contract passed in parameter
   * @param contracts A list of contracts
   * @param onSuccessCallback Callback receives list of events
   * @param onErrorCallback Callback receives error details on error
   */
  getAllTransactionsEvent (
    contracts,
    onSuccessCallback,
    onErrorCallback
  ) {
    let self = this
    let transactions = []
    let nbContracts = (contracts != undefined && contracts.length != undefined) ? contracts.length : 0;
    let nbContractDone = 0
    // Check if we have 0 contracts
    if (nbContracts <= 0)
      onSuccessCallback(transactions);
    else {
      // For each contract
      contracts.forEach(function (contract) {

        // Get all the events
        let events = self.cfd.at(contract.cfd.address).allEvents({fromBlock: 0, toBlock: 'latest'})
        events.get((err, events) => {
          // If we have at least one event, push them into the transactions array
          if (err == null && events != null && events !== undefined && events.length > 0) {
            events.forEach(function (e) {
              transactions.push(e)
            })
          }
          // Check if we are done with all the contracts
          nbContractDone += 1
          if (nbContractDone >= nbContracts) {
            // Sort array by block number
            transactions.sort(function (a, b) { return b.blockNumber - a.blockNumber })
            onSuccessCallback(transactions)
          }
        })

        // In case the events never return, use a timeout
        setTimeout(function() {
          // Check if we are done with all the contracts
          nbContractDone += 1
          if (nbContractDone >= nbContracts) {
            // Sort array by block number
            transactions.sort(function (a, b) { return b.blockNumber - a.blockNumber })
            onSuccessCallback(transactions)
          }
        }, TRANSACTIONS_EVENT_TIMEOUT)

      })
    }
  }

  /**
   * NOTE: use EVENTAPI.newInstance to create a new instance rather then this
   *       constructor.
   *
   * Construct an API instance setting config and web3. initialise() must be
   * called after this to setup the contract handler. newInstance() does both
   * these steps so is the preferred way to get an instance of this class.
   *
   * @param config Configuration object with all properties as per config.json.template
   * @param web3 Initiated web3 instance for the network to work with.
   */
  constructor (config, web3) {
    this.config = config
    this.web3 = web3
    this.web3.eth.getCodeAsync = Promise.promisify(this.web3.eth.getCode)
    this.web3.eth.getBlockAsync = Promise.promisify(this.web3.eth.getBlock)
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
    this.cfd = cfdInstance(this.web3.currentProvider, this.config.ownerAccountAddr)
    return this
  }
}
