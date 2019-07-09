import Promise from 'bluebird'
import {
  cfdFactoryInstanceDeployed,
  cfdRegistryInstanceDeployed,
  priceFeedsKyberInstanceDeployed,
  registryInstanceDeployed
} from './contracts'

export default class AdminAPI {
  /**
   * Create a new instance of this class setting up contract handles and
   * validating the config addresses point to actual deployed contracts.
   *
   * @param config Configuration object with all properties as per
   *               config.json.template
   * @param web3 Initiated and connected web3 instance
   *
   * @return Constructed and initialised instance of this class
   */
  static async newInstance(config, web3) {
    /* if (web3.isConnected() !== true) {
      return Promise.reject(
        new Error('web3 is not connected - check the endpoint')
      )
    } */
    const api = new AdminAPI(config, web3)
    await api.initialise()
    return api
  }

  /**
   * Change the owner account across all the contracts (or Regsitry only
   * if {registryOnly: true} - in case of a new deployment with a new owner).
   *
   * @param newOwnerAddr  New account address
   * @param options.registryOnly If true only update in the Registry owner
   *
   * @return Promise resolving to success with tx details or reject depending
   *          on the outcome.
   */
  changeOwnerAccount(newOwnerAddr, options = { registryOnly: false }) {
    const registryOnly = options.registryOnly === true
    const ownableContracts = registryOnly
      ? ['registry']
      : ['priceFeedsKyber', 'registry', 'cfdRegistry', 'cfdFactory']
    return Promise.all(
      ownableContracts.map(contractKey =>
        this[contractKey].methods
          .transferOwnership(newOwnerAddr)
          .send({ from: this.config.ownerAccountAddr })
      )
    ).then(() => {
      this.config.ownerAccountAddr = newOwnerAddr
      console.log(`Owner updated on chain to ${newOwnerAddr}.\n`)
      console.log(
        `Update ownerAccountAddr in your config.${
          this.config.network
        }.json file now.`
      )
    })
  }

  /**
   * NOTE: use AdminAPI.newInstance to create a new instance rather then this
   *       constructor.
   *
   * Construct an API instance setting config and web3. initialise() must be
   * called after this to setup the contract handler. newInstance() does both
   * these steps so is the preferred way to get an instance of this class.
   *
   * @param config Configuration object with all properties as per config.json.template
   * @param web3 Initiated web3 instance for the network to work with.
   */
  constructor(config, web3) {
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
  async initialise() {
    this.cfdFactory = await cfdFactoryInstanceDeployed(this.config, this.web3)
    this.cfdRegistry = await cfdRegistryInstanceDeployed(this.config, this.web3)
    this.priceFeedsKyber = await priceFeedsKyberInstanceDeployed(
      this.config,
      this.web3
    )
    this.registry = await registryInstanceDeployed(this.config, this.web3)
    return this
  }
}
