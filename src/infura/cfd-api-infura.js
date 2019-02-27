import BigNumber from 'bignumber.js'
import Promise from 'bluebird'

import {
  getContract,
  cfdInstance,
  cfdFactoryInstanceDeployed,
  cfdRegistryInstanceDeployed,
  daiTokenInstanceDeployed,
  feedsInstanceDeployed
} from './contracts'
import {
  assertBigNumberOrString,
  fromContractBigNumber,
  toContractBigNumber,
  txFailed,
  getAllEventsWithName,
  signAndSendTransaction
} from './utils'

import {creatorFee, joinerFee} from '../calc'

// strip off any decimal component of a value as values must be whole numbers
const safeValue = value => value.toFixed(0)

export default class CFDAPI {
  /**
   * Create a new instance of this class setting up contract handles and
   * valaditing the config addresses point to actual deployed contracts.
   *
   * @param config Configuration object with all properties as per
   *               config.json.template
   * @param web3 Initiated and connected web3 instance
   * @param privateKey (optional) The private key used to sign the transactions when using Infura (needed only for the daemon)
   *
   * @return Constructed and initialised instance of this class
   */
  static async newInstance (config, web3, privateKey) {
    /*if (web3 == undefined || web3.isConnected() !== true) {
      return Promise.reject(
        new Error('web3 is not connected - check the endpoint')
      )
    }*/
    const api = new CFDAPI(config, web3, privateKey)
    await api.initialise()
    return api
  }

  /**
   * Create a new CFD.
   *
   * See creatorFee() for details of required fees in addition to the initial
   * collateral.
   *
   * @param marketIdStr Contract for this market (eg. "Poloniex_ETH_USD")
   * @param strikePrice Contract strike price
   * @param notionalAmountDai Contract amount
   * @param leverage The leverage (between 0.01 and 5.00)
   * @param isBuyer Creator wants to be contract buyer or seller
   * @param creator Creator of this contract who will sign the transaction
   *
   * @return Promise resolving to a new cfd truffle-contract instance on
   *            success or a promise failure if the tx failed
   */
  async newCFD (
    marketIdStr,
    strikePrice,
    notionalAmountDai,
    leverage,
    isBuyer,
    creator
  ) {
    assertBigNumberOrString(strikePrice)
    assertBigNumberOrString(notionalAmountDai)
    assertBigNumberOrString(leverage)

    const decimals = await this.feeds.methods.decimals().call()
    const strikePriceBN = toContractBigNumber(strikePrice, decimals).toFixed()
    const marketId = this.marketIdStrToBytes(marketIdStr)
    const leverageValue = parseFloat(leverage)

    if (isNaN(leverageValue) === true || leverageValue === 0) {
      return Promise.reject(new Error(`invalid leverage`))
    }

    const notionalBN = new BigNumber(notionalAmountDai)
    const deposit = notionalBN.dividedBy(leverageValue)
    const value = safeValue(deposit.plus(creatorFee(notionalBN)))

    await this.daiToken.methods.approve(this.cfdFactory.options.address, value).send({from: creator})
    const receipt = await this.cfdFactory.methods.createContract(
      marketId,
      strikePriceBN,
      notionalBN.toFixed(),
      isBuyer,
      value
    ).send({from: creator, gas: 500000})

    if (txFailed(receipt.status)) {
      return Promise.reject(
        new Error(
          `transaction status != 1. tx:[${JSON.stringify(receipt, null, 2)}]`
        )
      )
    }

    const cfdAddress = receipt.events.LogCFDFactoryNew.returnValues.newCFDAddr
    return getContract(cfdAddress, this.web3)
  }

  /**
   * Deposit is called by a party wishing to join a new CFD.
   *
   * See joinerFee() for details of required fees in addition to the initial
   * collateral. These fees are added on to the passed amount.
   *
   * @return Promise resolving to success with tx details or reject depending
   *          on the outcome.
   */
  async deposit (cfdAddress, depositAccount, amount) {
    const cfd = getContract(cfdAddress, this.web3)
    const fee = await this.joinFee(cfd)
    const value = safeValue(amount.plus(fee))
    await this.daiToken.methods.approve(cfd.options.address, value).send({from: depositAccount})
    return cfd.methods.deposit(value).send({from: depositAccount, gas: 1000000})
  }

  /**
   * Get details of a CFD given a deployment address.
   * @param cfdAddress Address of a deployed CFD
   */
  getCFD (cfdAddress) {
    const self = this;
    return Promise.all([
      this.web3.eth.getCodeAsync(cfdAddress)
    ]).then(() => {
      // Contract address exists
      const cfd = getContract(cfdAddress, self.web3);
      return Promise.all([
        cfd.methods.getCfdAttributes().call(),    // [buyer,seller,market,strikePrice,notionalAmountDai,buyerSelling,sellerSelling,status]
        cfd.methods.getCfdAttributes2().call(),   // [buyerInitialNotional,sellerInitialNotional,buyerDepositBalance,sellerDepositBalance,buyerSaleStrikePrice,sellerSaleStrikePrice,buyerInitialStrikePrice,sellerInitialStrikePrice]
        cfd.methods.getCfdAttributes3().call(),   // [termninated,upgradeCalledBy]
        self.feeds.methods.decimals().call(),
        cfd.methods.closed().call()
      ]).then(function (values) {
        // Got all the data, fetch the data that needed previous values
        return Promise.all([
          self.marketIdBytesToStr(values[0][2]),                                            // [0]
          cfd.methods.cutOffPrice(values[0][4], values[1][2], values[0][3], true).call(),   // [1]
          cfd.methods.cutOffPrice(values[0][4], values[1][3], values[0][3], false).call()   // [2]
        ]).then(function (values2) {
          // Got the rest of the data
          return {
            address: cfdAddress,
            closed: values[4],
            status: values[0][7],
            liquidated: values[2][0],
            upgradeCalledBy: values[2][1],
            buyer: values[0][0],
            buyerIsSelling: values[0][5],
            seller: values[0][1],
            sellerIsSelling: values[0][6],
            market: values2[0],
            notionalAmountDai: fromContractBigNumber(values[0][4], values[3]),
            buyerInitialNotional: fromContractBigNumber(values[1][0], values[3]),
            sellerInitialNotional: fromContractBigNumber(values[1][1], values[3]),
            strikePrice: fromContractBigNumber(values[0][3], values[3]),
            buyerSaleStrikePrice: fromContractBigNumber(values[1][4], values[3]),
            sellerSaleStrikePrice: fromContractBigNumber(values[1][5], values[3]),
            buyerDepositBalance: fromContractBigNumber(values[1][2], values[3]),
            sellerDepositBalance: fromContractBigNumber(values[1][3], values[3]),
            buyerInitialStrikePrice: fromContractBigNumber(values[1][6], values[3]),
            sellerInitialStrikePrice: fromContractBigNumber(values[1][7], values[3]),
            buyerLiquidationPrice: fromContractBigNumber(values2[1], values[3]),
            sellerLiquidationPrice: fromContractBigNumber(values2[2], values[3])
          }
        }).catch(error => {
          throw new Error(error);
        });
      }).catch(error => {
        throw new Error(error);
      });
    }).catch(error => {
      throw new Error(error);
    });
  }

  /**
   * Fulfill a request to update the strike price for a non-initialized CFD
   * @param cfdAddress Address of a deployed CFD
   * @param userAccount User's account making the request
   * @param desiredStrikePrice User wants this strike price value for his CFD
   * @return Promise resolving to success with tx details or reject depending
   *          on the outcome.
   */
  async changeStrikePriceCFD (cfdAddress, userAccount, desiredStrikePrice) {
    const cfd = getContract(cfdAddress, this.web3)

    if ((await cfd.methods.isContractParty(userAccount).call()) === false) {
      return Promise.reject(
        new Error(`${userAccount} is not a party to CFD ${cfdAddress}`)
      )
    }

    const decimals = await this.feeds.methods.decimals().call()
    const desiredStrikePriceBN = toContractBigNumber(
      desiredStrikePrice,
      decimals
    ).toFixed()

    return cfd.methods.changeStrikePrice(desiredStrikePriceBN).send({from: userAccount})
  }

  /**
   * Tansfer the position in a contract to another account.
   * @param cfdAddress, Address of the deployed CFD
   * @param fromAccount, Account who is transferring the position
   * @param toAccount, Account who the position gets transferred too
   * @return Promise resolving to success with tx details or reject depending
   *          on the outcome.
   */
  async transferPosition (cfdAddress, fromAccount, toAccount) {
    const cfd = getContract(cfdAddress, this.web3)
    return cfd.methods.transferPosition(toAccount).send({from: fromAccount, gas: 50000})
  }

  /**
   * Force liquidation a contract
   * @param cfdAddress, Address of the deployed CFD
   * @param account, The address of the account who is terminating
   * @return Promise resolving to success with tx details or reject depending
   *          on the outcome.
   */
  async forceTerminate (cfdAddress, account) {
    const cfd = getContract(cfdAddress, this.web3)
    return cfd.methods.forceTerminate().send({from: account, gas: 150000})
  }

  /**
   * Get all contracts for a specific market
   * @param marketId
   * @param options Object with optional properties:
   *          fromBlock Block to query events from (default=0)
   *          includeLiquidated Include liquidated cfd's in the results
   *                            (default=false)
   * @return a promise with the array of contracts
   */
  contractsForMarket (
    marketId,
    {fromBlock = this.config.deploymentBlockNumber || 0, includeLiquidated = false}
  ) {
    const self = this;
    const market = this.marketIdStrToBytes(marketId);
    // Function to get one CFD details
    const getDetailsCfd = async address => self.getCFD(address);
    // Function to get the CFDs from addresses
    const getCFDs = async events => {
      let results = await Promise.all(
        events.map((ev) => {
          return getDetailsCfd(ev.address);
        })
      )
      return results
    }

    return new Promise((resolve, reject) => {
      // Get all the events
      getAllEventsWithName("LogCFDFactoryNew", this.cfdFactory).then((events) => {
        // Filter events with the marketId
        events = events.filter(function(ev) {
          if (ev == undefined || ev.raw == undefined || ev.raw.data == undefined || ev.raw.topics == undefined || ev.raw.topics.length <= 1)
            return false;
          ev.address = '0x' + ev.raw.data.substr(ev.raw.data.length - 40);
          return (market == ev.raw.topics[1]);
        });
        // For each event, get the CFD
        getCFDs(events).then(cfds => resolve(cfds.filter((cfd) => {
          // Check if we want to exclude the liquidated
          if (includeLiquidated == true || cfd.closed == false)
            return true;
          return false;
        })));
      }, (err) => reject(err));
    });
  }

  /**
   * Check for liquidation
   * @param cfdAddress, Address of the contract
   * @param account, Account address of the user
   */
  attemptContractLiquidation (cfdAddress, account) {
    const self = this;
    return Promise.all([
      this.web3.eth.getCodeAsync(cfdAddress)
    ]).then(() => {
      // Contract address exists
      const cfd = getContract(cfdAddress, self.web3);
      return cfd.methods.liquidate().send({from: account, gas: 200000});
    }).catch(error => {
      throw new Error(error);
    });
  }
  /**
   * Check for liquidation with a signed transaction (for the daemon)
   * @param cfdAddress, Address of the contract
   * @param account, Account address of the user
   */
  attemptContractLiquidationDaemon (cfdAddress, account) {
    const self = this;
    return Promise.all([
      this.web3.eth.getCodeAsync(cfdAddress)
    ]).then(() => {
      // Contract address exists
      const cfd = getContract(cfdAddress, self.web3);
      return signAndSendTransaction(self.web3, self.config.daemonAccountAddr, self.privateKey, self.config.feedContractAddr,
            cfd.methods.liquidate().encodeABI(), self.config.gasPrice, 200000);
    }).catch(error => {
      throw new Error(error);
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

  async joinFee (cfd) {
    const notionalAmount = await cfd.methods.notionalAmountDai().call()
    return joinerFee(new BigNumber(notionalAmount))
  }

  /**
   * NOTE: use CFDAPI.newInstance to create a new instance rather then this
   *       constructor.
   *
   * Construct an API instance setting config and web3. initialise() must be
   * called after this to setup the contract handler. newInstance() does both
   * these steps so is the preferred way to get an instance of this class.
   *
   * @param config Configuration object with all properties as per config.json.template
   * @param web3 Initiated web3 instance for the network to work with.
   * @param privateKey (optional) The private key used to sign the transactions (for using Infura for example)
   */
  constructor (config, web3, privateKey = undefined) {
    this.config = config
    this.web3 = web3
    this.privateKey = privateKey
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
    this.cfd = cfdInstance(
      this.web3.currentProvider,
      this.config.ownerAccountAddr
    )
    this.cfdFactory = await cfdFactoryInstanceDeployed(this.config, this.web3)
    this.cfdRegistry = await cfdRegistryInstanceDeployed(this.config, this.web3)
    this.daiToken = await daiTokenInstanceDeployed(this.config, this.web3)
    this.feeds = await feedsInstanceDeployed(this.config, this.web3)
    return this
  }
}
