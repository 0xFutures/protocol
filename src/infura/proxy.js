import {
  cfdInstance,
  dsProxyInstanceDeployed,
  dsProxyFactoryInstanceDeployed
} from './contracts'
import { logGas } from './utils'

// convert from 64 digit long to 40 digit long
const unpackAddress = packed => packed.replace(/x0{24}/, 'x')

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

  async proxyNew(user, { dsProxyFactory, daiToken }) {
    const buildTx = await dsProxyFactory.methods.build(user).send()
    const proxyAddr = buildTx.events.Created.returnValues.proxy
    const proxy = await dsProxyInstanceDeployed(this.config, this.web3, proxyAddr, user)
    await daiToken.methods.approve(proxyAddr, '-1').send({ from: user })
    return proxy
  }

  async proxyCreateCFD({
    proxy,
    deployment: { cfdFactory, cfdProxy, daiToken },
    marketId,
    strikePrice,
    notional,
    value
  }) {
    const txRsp = await this.proxyTx(proxy, cfdProxy, 'createContract', [
      cfdFactory.options.address,
      daiToken.options.address,
      marketId,
      strikePrice.toString(),
      notional.toString(),
      true, // isBuyer
      value.toString()
    ])

    const cfdPartyEventTopics = txRsp.events[10].raw.topics

    const cfd = cfdInstance(this.web3, this.config)
    cfd.options.address = unpackAddress(cfdPartyEventTopics[1])
    return cfd
  }

  proxyDeposit(
    proxy,
    cfd,
    { cfdProxy, daiToken },
    value
  ) {
    return this.proxyTx(proxy, cfdProxy, 'deposit', [
      cfd.options.address, daiToken.options.address, value.toString()
    ])
  }

  async proxySellPrepare(
    proxy,
    cfd,
    { cfdProxy },
    desiredStrikePrice,
    timeLimit
  ) {
    return this.proxyTx(proxy, cfdProxy, 'sellPrepare', [
      cfd.options.address, desiredStrikePrice.toString(), timeLimit
    ])
  }

  async proxySellUpdate(
    proxy,
    cfd,
    { cfdProxy },
    newPrice
  ) {
    return this.proxyTx(proxy, cfdProxy, 'sellUpdate', [
      cfd.options.address, newPrice.toString()
    ])
  }

  async proxySellCancel(
    proxy,
    cfd,
    { cfdProxy },
  ) {
    return this.proxyTx(proxy, cfdProxy, 'sellCancel', [
      cfd.options.address
    ])
  }

  async proxyBuy(
    proxy,
    cfd,
    { cfdProxy, daiToken },
    buyBuyerSide,
    buyValue
  ) {
    return this.proxyTx(proxy, cfdProxy, 'buy', [
      cfd.options.address,
      daiToken.options.address,
      buyBuyerSide,
      buyValue.toString()
    ])
  }
  async proxyTopup(
    proxy,
    cfd,
    { cfdProxy, daiToken },
    value
  ) {
    return this.proxyTx(proxy, cfdProxy, 'topup', [
      cfd.options.address, daiToken.options.address, value.toString()
    ])
  }

  async proxyWithdraw(
    proxy,
    cfd,
    { cfdProxy },
    value
  ) {
    return this.proxyTx(proxy, cfdProxy, 'withdraw', [
      cfd.options.address, value.toString()
    ])
  }

  async proxyCancelNew(
    proxy,
    cfd,
    { cfdProxy },
  ) {
    return this.proxyTx(proxy, cfdProxy, 'cancelNew', [
      cfd.options.address
    ])
  }

  async proxyForceTerminate(
    proxy,
    cfd,
    { cfdProxy },
  ) {
    return this.proxyTx(proxy, cfdProxy, 'forceTerminate', [
      cfd.options.address
    ])
  }

  async proxyUpgrade(
    proxy,
    cfd,
    { cfdProxy },
  ) {
    return this.proxyTx(proxy, cfdProxy, 'upgrade', [
      cfd.options.address
    ])
  }

  async proxyTransferPosition(
    proxy,
    cfd,
    { cfdProxy },
    newAddress
  ) {
    return this.proxyTx(proxy, cfdProxy, 'transferPosition', [
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
  async proxySendTransaction(proxy, cfdProxy, msgData) {
    return proxy.methods['execute(address,bytes)'](
      cfdProxy.options.address,
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
   * @param {Array} methodArgs Arguments to method
   */
  async proxyTx(
    proxy,
    cfdProxy,
    method,
    methodArgs
  ) {
    const msgData = cfdProxy.methods[method](...methodArgs).encodeABI()
    const txRsp = await this.proxySendTransaction(proxy, cfdProxy, msgData)
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
    this.dsProxyFactory = await dsProxyFactoryInstanceDeployed(this.config, this.web3);
    // this.EVENT_LogCFDRegistryParty = this.web3.utils.sha3('LogCFDRegistryParty(address,address)')
    return this
  }
}
