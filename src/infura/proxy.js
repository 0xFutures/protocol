import {
  dsProxyFactoryInstance,
} from './contracts'

export default class Proxy {

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
  static async newInstance(config, web3) {
    const proxy = new Proxy(config, web3)
    await proxy.initialise()
    return proxy
  }

  /**
   * NOTE: use Proxy.newInstance to create a new instance rather then this
   *       constructor.
   *
   * Construct an Proxy instance setting config and web3. initialise() must be
   * called after this to setup the contract handler. newInstance() does both
   * these steps so is the preferred way to get an instance of this class.
   *
   * @param config Configuration object with all properties as per
   *               config.json.template
   * @param web3 Initiated web3 instance for the network to work with.
   */
  constructor(config, web3) {
    this.config = config
    this.web3 = web3
  }

  /**
   * Sets up contract handles.
   * @return Proxy instance
   */
  async initialise() {
    this.dsProxyFactory = await dsProxyFactoryInstanceDeployed(this.config, this.web3);
    return this
  }
}
