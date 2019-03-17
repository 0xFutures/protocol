import Promise from 'bluebird'
import {
  cfdInstance,
  getContract
} from './contracts'
import {
  getAllEventsWithName
} from './utils'

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
    /*if (web3.isConnected() !== true) {
      return Promise.reject(
        new Error('web3 is not connected - check the endpoint')
      )
    }*/
    const api = new EVENTAPI(config, web3)
    await api.initialise()
    return api
  }

  /**
   * Get all the events for each contract passed in parameter
   * @param contracts A list of contracts
   * @param eventName (optional) To get a specific event only (undefined to get all)
   * @return Promise resolving to a list of events
   */
  getAllEvents (
    contracts,
    eventName = undefined
  ) {
    let self = this
    let resEvents = []
    let nbContracts = (contracts != undefined && contracts.length != undefined) ? contracts.length : 0;
    let nbContractDone = 0
    // Function to check if we are done requesting
    const checkDone = (resolve) => {
    	nbContractDone += 1;
    	if (nbContractDone >= nbContracts)
    		resolve(resEvents);
    }
    return new Promise(function(resolve, reject) {
	    // Check if we have 0 contracts
	    if (nbContracts <= 0)
	      resolve([]);
	    else {
	      // For each contract
	      contracts.forEach(function (contract) {
	      	// Get the CFD instance
	      	const cfd = getContract(contract.options.address, self.web3);
	      	// Get all the events
	      	getAllEventsWithName(eventName, cfd, self.config.deploymentBlockNumber, 'latest').then((events) => {
	      		events.forEach(function(ev) {
	      			resEvents.push(ev);
	      		});
	      		checkDone(resolve);
	      	}).catch((err) => {
	      		checkDone(resolve);
	      	});
	      })
	    }
	});
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
