import Promise from 'bluebird'
import * as EthereumjsTx from 'ethereumjs-tx'
import {
  cfdInstance,
  cfdProxyInstanceDeployed,
  cfdFactoryInstanceDeployed,
  daiTokenInstanceDeployed,
  dsProxyInstanceDeployed,
  dsProxyFactoryInstanceDeployed
} from './contracts'
import { logGas, unpackAddress, signSendTransactionForMobile } from './utils'

const createCFDTxRspToCfdInstance = (web3, config, eventHash, txEvents) => {
  const cfdPartyEvent = Object.entries(txEvents).find(
    e => e[1].raw.topics[0] === eventHash
  )[1]
  const cfdAddr = unpackAddress(cfdPartyEvent.raw.topics[1])

  const cfd = cfdInstance(web3, config)
  cfd.options.address = cfdAddr
  return cfd
}

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
   * @param {Number} gasLimit How much gas we are willing to spent
   * @param {Number} gasPrice Price of the gas
                     (if undefined, will use the default value from config file)
   * @param {string} privateKey If we need to manually sign the transaction (if no metamask available)
   */
  async proxyNew(user, gasLimit = 1000000, gasPrice = undefined, privateKey = undefined) {
    // Function to wait
    const timeout = async ms => {
      return new Promise(resolve => setTimeout(resolve, ms))
    }

    // Tx1: create proxy contract
    var tx, buildTx;

    // If we need to manually sign the transaction
    if (privateKey != undefined) {
      tx = {
        from: user,
        to: this.dsProxyFactory.options.address,
        gas: gasLimit,
        gasPrice: gasPrice || this.config.gasPrice,
        data: this.dsProxyFactory.methods.build(user).encodeABI()
      }
      buildTx = await signSendTransactionForMobile(this.web3, tx, privateKey);
    }
    // Metamask will sign transaction by itself
    else {
      tx = this.dsProxyFactory.methods.build(user);
      buildTx = await tx.send({ from: user, gas: gasLimit, gasPrice: gasPrice || this.config.gasPrice })
    }
    logGas(`Proxy build`, buildTx)

    if (buildTx == undefined || buildTx.status != true)
      return Promise.reject('Invalid transaction receipt');

    // Wait a few seconds to make sure the contract is deployed correctly
    // (used to avoid the getCode() function to fail)
    await timeout(3000)

    // Check user proxy
    const proxy = await this.getUserProxy(undefined, undefined, user);
    var proxyAddr = (proxy != undefined && proxy.options != undefined) ? proxy.options.address : undefined;

    if (proxyAddr == undefined)
      return Promise.reject('Cannot get proxy address');

    // Tx2: approve proxy contract transfers of DAI Token
    // If we need to manually sign the transaction
    if (privateKey != undefined) {
      tx = {
        from: user,
        to: this.daiToken.options.address,
        gas: gasLimit,
        data: this.daiToken.methods.approve(proxyAddr, '-1').encodeABI()
      }
      buildTx = await signSendTransactionForMobile(this.web3, tx, privateKey);
    }
    // Metamask will sign transaction by itself
    else {
      await this.daiToken.methods.approve(proxyAddr, '-1').send({ from: user, gas: gasLimit })
    }

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
    var self = this
    return new Promise(function (resolve, reject) {
      // Find the proxy address
      self.dsProxyFactory
        .getPastEvents('Created', {
          filter: { owner: userAddress },
          fromBlock,
          toBlock
        })
        .then(async results => {
          // Make sure we have at least one proxy
          if (
            results &&
            results.length > 0 &&
            results[0].returnValues != undefined &&
            results[0].returnValues.proxy != undefined
          ) {
            var proxyObj = results[results.length - 1]
            // Check we have the proxy address
            if (
              proxyObj != undefined &&
              proxyObj.returnValues != undefined &&
              proxyObj.returnValues.proxy != undefined
            ) {
              // Get the deployed instance of the proxy
              const proxy = await dsProxyInstanceDeployed(
                self.config,
                self.web3,
                proxyObj.returnValues.proxy,
                userAddress
              )
              resolve(proxy)
            } else resolve(undefined)
          }
          // Proxy does not exist, return undefined
          else resolve(undefined)
        })
    })
  }

  /**
   * Return the allowed amount by the user for this proxy
   * @param {address} proxyAddr Address of the proxy
   * @param {address} user User of the system - a CFD party
   * @return {Number} Allowed amount by the user for this proxy
   */
  async allowance(proxyAddr, user) {
    const amount = await this.daiToken.methods.allowance(user, proxyAddr).call()
    return amount
  }

  /**
   * Ask the user to approve his DAI for this proxy
   * @param {address} proxyAddr Address of the proxy
   * @param {address} user User of the system - a CFD party
   * @param {Number} gasLimit How much gas we are willing to spent
   * @param {Number} gasPrice Price of the gas
                     (if undefined, will use the default value from config file)
   * @param {string} privateKey If we need to manually sign the transaction (if no metamask available)
   * @return {Number} Allowed amount by the user for this proxy
   */
  approve(proxyAddr, user, gasLimit = 100000, gasPrice = undefined, privateKey = undefined) {
    // If we need to manually sign the transaction
    if (privateKey != undefined) {
      var tx = {
        from: user,
        to: this.daiToken.options.address,
        gas: gasLimit,
        gasPrice: gasPrice || this.config.gasPrice,
        data: this.daiToken.methods.approve(proxyAddr, '-1').encodeABI()
      }
      return signSendTransactionForMobile(this.web3, tx, privateKey);
    }
    // Metamask will sign transaction by itself
    else {
      return this.daiToken.methods.approve(proxyAddr, '-1').send({
        from: user,
        gas: gasLimit,
        gasPrice: gasPrice || this.config.gasPrice,
      })
    }
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
    value,
    gasLimit = 600000,
    gasPrice = undefined,
    privateKey = undefined
  }) {
    const txRsp = await this.proxyTx(proxy, 'createContract', [
      this.cfdFactory.options.address,
      this.daiToken.options.address,
      marketId,
      strikePrice.toString(),
      notional.toString(),
      isBuyer,
      value.toString()
    ], gasLimit, gasPrice, privateKey)
    return createCFDTxRspToCfdInstance(
      this.web3,
      this.config,
      this.eventHashLogCFDRegistryParty,
      txRsp.events
    )
  }

  async proxyCreateCFDWithETH({
    proxy,
    marketId,
    strikePrice,
    notional,
    isBuyer,
    valueETH,
    gasLimit = 900000,
    gasPrice = undefined,
    privateKey = undefined
  }) {
    const txRsp = await this.proxyTx(proxy, 'createContractWithETH', [
      this.cfdFactory.options.address,
      marketId,
      strikePrice.toString(),
      notional.toString(),
      isBuyer
    ], gasLimit, gasPrice, privateKey,
      valueETH.toString()
    )
    return createCFDTxRspToCfdInstance(
      this.web3,
      this.config,
      this.eventHashLogCFDRegistryParty,
      txRsp.events
    )
  }

  proxyDeposit(proxy, cfd, value, gasLimit = 350000, gasPrice = undefined, privateKey = undefined) {
    return this.proxyTx(proxy, 'deposit', [
      cfd.options.address,
      this.daiToken.options.address,
      value.toString()
    ], gasLimit, gasPrice, privateKey)
  }

  proxyChangeStrikePrice(proxy, cfd, newPrice, gasLimit = 200000, gasPrice = undefined, privateKey = undefined) {
    return this.proxyTx(proxy, 'changeStrikePrice', [
      cfd.options.address,
      newPrice.toString()
    ], gasLimit, gasPrice, privateKey)
  }

  async proxySellPrepare(proxy, cfd, desiredStrikePrice, timeLimit, gasLimit = 200000, gasPrice = undefined, privateKey = undefined) {
    return this.proxyTx(proxy, 'sellPrepare', [
      cfd.options.address,
      desiredStrikePrice.toString(),
      timeLimit
    ], gasLimit, gasPrice, privateKey)
  }

  async proxySellUpdate(proxy, cfd, newPrice, gasLimit = 200000, gasPrice = undefined, privateKey = undefined) {
    return this.proxyTx(proxy, 'sellUpdate', [
      cfd.options.address,
      newPrice.toString()
    ], gasLimit, gasPrice, privateKey)
  }

  async proxySellCancel(proxy, cfd, gasLimit = 75000, gasPrice = undefined, privateKey = undefined) {
    return this.proxyTx(proxy, 'sellCancel', [cfd.options.address], gasLimit, gasPrice, privateKey)
  }

  async proxyBuy(proxy, cfd, buyBuyerSide, buyValue, gasLimit = 500000, gasPrice = undefined, privateKey = undefined) {
    return this.proxyTx(proxy, 'buy', [
      cfd.options.address,
      this.daiToken.options.address,
      buyBuyerSide,
      buyValue.toString()
    ], gasLimit, gasPrice, privateKey)
  }

  async proxyTopup(proxy, cfd, value, gasLimit = 250000, gasPrice = undefined, privateKey = undefined) {
    return this.proxyTx(proxy, 'topup', [
      cfd.options.address,
      this.daiToken.options.address,
      value.toString()
    ], gasLimit, gasPrice, privateKey)
  }

  async proxyWithdraw(proxy, cfd, value, gasLimit = 350000, gasPrice = undefined, privateKey = undefined) {
    return this.proxyTx(proxy, 'withdraw', [
      cfd.options.address,
      value.toString()
    ], gasLimit, gasPrice, privateKey)
  }

  async proxyCancelNew(proxy, cfd, gasLimit = 200000, gasPrice = undefined, privateKey = undefined) {
    return this.proxyTx(proxy, 'cancelNew', [cfd.options.address], gasLimit, gasPrice, privateKey)
  }

  async proxyLiquidateMutual(proxy, cfd, gasLimit = 500000, gasPrice = undefined, privateKey = undefined) {
    return this.proxyTx(proxy, 'liquidateMutual', [cfd.options.address], gasLimit, gasPrice, privateKey)
  }

  async proxyLiquidateMutualCancel(proxy, cfd, gasLimit = 150000, gasPrice = undefined, privateKey = undefined) {
    return this.proxyTx(proxy, 'liquidateMutualCancel', [cfd.options.address], gasLimit, gasPrice, privateKey)
  }

  async proxyForceTerminate(proxy, cfd, gasLimit = 400000, gasPrice = undefined, privateKey = undefined) {
    return this.proxyTx(proxy, 'forceTerminate', [cfd.options.address], gasLimit, gasPrice, privateKey)
  }

  async proxyUpgrade(proxy, cfd, gasLimit = 2000000, gasPrice = undefined, privateKey = undefined) {
    return this.proxyTx(proxy, 'upgrade', [cfd.options.address], gasLimit, gasPrice, privateKey)
  }

  async proxyTransferPosition(proxy, cfd, newAddress, gasLimit = 200000, gasPrice = undefined, privateKey = undefined) {
    return this.proxyTx(proxy, 'transferPosition', [
      cfd.options.address,
      newAddress.toString()
    ], gasLimit, gasPrice, privateKey)
  }

  /**
   * Send transaction to CFD proxy
   * @param {DSProxy} proxy
   * @param {string} msgData Transaction msg.data to send
   * @param {Number} gasLimit How much gas we are willing to spent
   * @param {Number} gasPrice Price of the gas
                     (if undefined, will use the default value from config file)
   * @param {string} privateKey User's private key
                     (if undefined, will use the send function directly)
   * @param {string} ethValue (optional) ETH amount
   */
  async proxySendTransaction(proxy, msgData, gasLimit, gasPrice, privateKey, ethValue) {
    if (privateKey != undefined) {
      var tx = {
        from: await proxy.methods.owner().call(),
        to: proxy.options.address,
        gas: gasLimit,
        gasPrice: gasPrice || this.config.gasPrice,
        data: proxy.methods['execute(address,bytes)'](this.cfdProxy.options.address, msgData).encodeABI(),
        value: ethValue
      }
      return signSendTransactionForMobile(this.web3, tx, privateKey);
    } else {
      return proxy.methods['execute(address,bytes)'](
        this.cfdProxy.options.address,
        msgData
      ).send({
        from: await proxy.methods.owner().call(),
        gas: gasLimit,
        gasPrice: gasPrice || this.config.gasPrice,
        value: ethValue
      })
    }
  }

  /**
   * Helper function to build msg.data and call sendTransaction.
   * @param {DSProxy} proxy
   * @param {string} method Signature/name of method to call on proxy
   * @param {array} methodArgs Method arguments
   * @param {Number} gasLimit How much gas we are willing to spent
   * @param {Number} gasPrice Price of the gas
                     (if undefined, will use the default value from config file)
   * @param {string} privateKey User's private key
                     (if undefined, will use the send function directly)
   * @param {string} ethValue (optional) ETH amount
   */
  async proxyTx(proxy, method, methodArgs, gasLimit, gasPrice, privateKey, ethValue) {
    const msgData = this.cfdProxy.methods[method](...methodArgs).encodeABI()
    const txRsp = await this.proxySendTransaction(proxy, msgData, gasLimit, gasPrice, privateKey, ethValue)
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
    this.Tx = EthereumjsTx.default;
  }

  /**
   * Sets up contract handles.
   * @return Proxy instance
   */
  async initialise() {
    this.daiToken = await daiTokenInstanceDeployed(this.config, this.web3)
    this.dsProxyFactory = await dsProxyFactoryInstanceDeployed(
      this.config,
      this.web3
    )
    this.cfdProxy = await cfdProxyInstanceDeployed(this.config, this.web3)
    this.cfdFactory = await cfdFactoryInstanceDeployed(this.config, this.web3)
    this.eventHashLogCFDRegistryParty = this.web3.utils.sha3(
      `LogCFDRegistryParty(address,address)`
    )
    return this
  }
}
