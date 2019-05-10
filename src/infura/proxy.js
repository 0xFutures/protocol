import {
  cfdInstance,
  cfdProxyInstanceDeployed,
  cfdFactoryInstanceDeployed,
  daiTokenInstanceDeployed,
  dsProxyInstanceDeployed,
  dsProxyFactoryInstanceDeployed
} from './contracts'
import { logGas, unpackAddress } from './utils'
import Promise from 'bluebird'

/**
 * A Proxy is created for each user in the 0xfutures system. This enables 
 * bundling multiple steps into a single transaction. For example instead
 * of one transaction for DAIToken approve followed by one transaction for
 * CFD create, both of these can be bundled in some byte code that is and 
 * executed (deletecall'd) in one transaction (see dappsys/proxy.sol
 * for details of the mechanism).
 * 
 * NOTE: TESTING - routines in this api are tested in the and used by the
 *        contract_for_difference_proxy.js test. For this reason there is
 *        no seperate test file for proxy.js.
 */
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
   * Create a new DSProxy for the given user.
   * Later can query proxies by getUserProxy in this class.
   * @param {address} user User of the system - a CFD party
   */
  async proxyNew(user) {
    // Tx1: create proxy contract
    const buildTx = await this.dsProxyFactory.methods.build(user).send({
      from: user,
      gas: 1000000
    })
    const proxyAddr = buildTx.events.Created.returnValues.proxy
    const proxy = await dsProxyInstanceDeployed(
      this.config,
      this.web3,
      proxyAddr,
      user
    )

    // Tx2: approve proxy contract transfers of DAI Token
    await this.daiToken.methods.approve(proxyAddr, '-1').send({ from: user })

    return proxy
  }

  /**
   * Get Proxy address for a given user address.
   * @param fromBlock, The beginning of the block interval
   * @param toBlock, The end of the block interval
   * @param userAddress, Look up proxy for this address
   * @return Promise<string|undefined> Proxy address string or undefined 
   *          if none exists
   */
  async getUserProxy(
    fromBlock = this.config.deploymentBlockNumber || 0,
    toBlock = 'latest',
    userAddress
  ) {
  	var self = this;
    return new Promise(function(resolve, reject) {
    	// Find the proxy address
    	self.dsProxyFactory.getPastEvents(
			'Created',
			{
				filter: { owner: userAddress },
				fromBlock,
				toBlock
			}
	    ).then(async (results) => {
	    	// Make sure we have at least one proxy
	    	if (results && results.length > 0 && results[0].returnValues != undefined && results[0].returnValues.proxy != undefined) {
          var proxyObj = results[results.length - 1];
          // Check we have the proxy address
          if (proxyObj != undefined && proxyObj.returnValues != undefined && proxyObj.returnValues.proxy != undefined) {
            // Get the deployed instance of the proxy
            const proxy = await dsProxyInstanceDeployed(
              self.config,
              self.web3,
              proxyObj.returnValues.proxy,
              userAddress
            )
            resolve(proxy);
          } else
            resolve(undefined);
	    	}
	    	// Proxy does not exist, return undefined
	    	else
	    		resolve(undefined);
	    });
    });
  }

  /**
   * Return the allowed amount by the user for this proxy
   * @param {address} proxyAddr Address of the proxy
   * @param {address} user User of the system - a CFD party
   * @return {Number} Allowed amount by the user for this proxy
   */
  async allowance(
    proxyAddr,
    user
  ) {
    const amount = await this.daiToken.methods.allowance(user, proxyAddr).call();
    return amount;
  }

  /**
   * Ask the user to approve his DAI for this proxy
   * @param {address} proxyAddr Address of the proxy
   * @param {address} user User of the system - a CFD party
   * @return {Number} Allowed amount by the user for this proxy
   */
  approve(
    proxyAddr,
    user
  ) {
    return this.daiToken.methods.approve(proxyAddr, '-1').send({ from: user })
  }


  /**
   * ContractForDifference functions
   */
  async proxyCreateCFD({
    proxy,
    marketId,
    strikePrice,
    notional,
    isBuyer,
    value
  }) {
    const txRsp = await this.proxyTx(proxy, 'createContract', [
      this.cfdFactory.options.address,
      this.daiToken.options.address,
      marketId,
      strikePrice.toString(),
      notional.toString(),
      isBuyer,
      value.toString()
    ])

    const cfdPartyEvent = Object.entries(txRsp.events).find(
      e => e[1].raw.topics[0] === this.eventHashLogCFDRegistryParty
    )[1]
    const cfdAddr = unpackAddress(cfdPartyEvent.raw.topics[1])

    const cfd = cfdInstance(this.web3, this.config)
    cfd.options.address = cfdAddr
    return cfd
  }

  proxyDeposit(
    proxy,
    cfd,
    value
  ) {
    return this.proxyTx(proxy, 'deposit', [
      cfd.options.address, this.daiToken.options.address, value.toString()
    ])
  }

  proxyChangeStrikePrice(
    proxy,
    cfd,
    newPrice
  ) {
    return this.proxyTx(proxy, 'changeStrikePrice', [
      cfd.options.address, newPrice.toString()
    ])
  }

  async proxySellPrepare(
    proxy,
    cfd,
    desiredStrikePrice,
    timeLimit
  ) {
    return this.proxyTx(proxy, 'sellPrepare', [
      cfd.options.address, desiredStrikePrice.toString(), timeLimit
    ])
  }

  async proxySellUpdate(
    proxy,
    cfd,
    newPrice
  ) {
    return this.proxyTx(proxy, 'sellUpdate', [
      cfd.options.address, newPrice.toString()
    ])
  }

  async proxySellCancel(
    proxy,
    cfd,
  ) {
    return this.proxyTx(proxy, 'sellCancel', [
      cfd.options.address
    ])
  }

  async proxyBuy(
    proxy,
    cfd,
    buyBuyerSide,
    buyValue
  ) {
    return this.proxyTx(proxy, 'buy', [
      cfd.options.address,
      this.daiToken.options.address,
      buyBuyerSide,
      buyValue.toString()
    ])
  }

  async proxyTopup(
    proxy,
    cfd,
    value
  ) {
    return this.proxyTx(proxy, 'topup', [
      cfd.options.address, this.daiToken.options.address, value.toString()
    ])
  }

  async proxyWithdraw(
    proxy,
    cfd,
    value
  ) {
    return this.proxyTx(proxy, 'withdraw', [
      cfd.options.address, value.toString()
    ])
  }

  async proxyCancelNew(
    proxy,
    cfd,
  ) {
    return this.proxyTx(proxy, 'cancelNew', [
      cfd.options.address
    ])
  }

  async proxyForceTerminate(
    proxy,
    cfd,
  ) {
    return this.proxyTx(proxy, 'forceTerminate', [
      cfd.options.address
    ])
  }

  async proxyUpgrade(
    proxy,
    cfd,
  ) {
    return this.proxyTx(proxy, 'upgrade', [
      cfd.options.address
    ])
  }

  async proxyTransferPosition(
    proxy,
    cfd,
    newAddress
  ) {
    return this.proxyTx(proxy, 'transferPosition', [
      cfd.options.address,
      newAddress.toString()
    ])
  }

  /**
   * Send transaction to CFD proxy
   * @param {DSProxy} proxy
   * @param {ContractForDifferenceProxy} cfdProxy 
   * @param {string} msgData Transaction msg.data to send
   */
  async proxySendTransaction(proxy, msgData) {
    return proxy.methods['execute(address,bytes)'](
      this.cfdProxy.options.address,
      msgData
    ).send({
      from: await proxy.methods.owner().call(),
      gas: 2750000
    })
  }

  /**
   * Helper function to build msg.data and call sendTransaction.
   * @param {DSProxy} proxy
   * @param {ContractForDifferenceProxy} cfdProxy 
   * @param {string} method Signature/name of method to call on proxy
   */
  async proxyTx(
    proxy,
    method,
    methodArgs
  ) {
    const msgData = this.cfdProxy.methods[method](...methodArgs).encodeABI()
    const txRsp = await this.proxySendTransaction(proxy, msgData)
    logGas(`CFD ${method} (through proxy)`, txRsp)
    return txRsp
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
    this.daiToken = await daiTokenInstanceDeployed(this.config, this.web3)
    this.dsProxyFactory = await dsProxyFactoryInstanceDeployed(this.config, this.web3)
    this.cfdProxy = await cfdProxyInstanceDeployed(this.config, this.web3)
    this.cfdFactory = await cfdFactoryInstanceDeployed(this.config, this.web3)
    this.eventHashLogCFDRegistryParty = this.web3.utils.sha3(`LogCFDRegistryParty(address,address)`)
    return this
  }
}
