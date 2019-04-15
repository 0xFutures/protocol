import BigNumber from 'bignumber.js'
import Promise from 'bluebird'

import {
  getContract,
  cfdInstance,
  cfdFactoryInstanceDeployed,
  cfdRegistryInstanceDeployed,
  daiTokenInstanceDeployed,
  priceFeedsInstanceDeployed
} from './contracts'
import {
  STATUS,
  assertBigNumberOrString,
  fromContractBigNumber,
  toContractBigNumber,
  txFailed,
  getAllEventsWithName,
  signAndSendTransaction
} from './utils'

import { creatorFee, joinerFee } from '../calc'

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
  static async newInstance(config, web3, privateKey) {
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
   * @return Promise resolving to a new cfd contract instance on
   *            success or a promise failure if the tx failed
   */
  async newCFD(
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

    const strikePriceBN = toContractBigNumber(strikePrice).toFixed()
    const marketId = this.marketIdStrToBytes(marketIdStr)
    const leverageValue = parseFloat(leverage)

    if (isNaN(leverageValue) === true || leverageValue === 0) {
      return Promise.reject(new Error(`invalid leverage`))
    }

    const notionalBN = new BigNumber(notionalAmountDai)
    const deposit = notionalBN.dividedBy(leverageValue)
    const value = safeValue(deposit.plus(creatorFee(notionalBN)))

    await this.daiToken.methods.approve(this.cfdFactory.options.address, value).send({ from: creator })
    const receipt = await this.cfdFactory.methods.createContract(
      marketId,
      strikePriceBN,
      notionalBN.toFixed(),
      isBuyer,
      value
    ).send({ from: creator, gas: 500000 })

    if (txFailed(receipt.status)) {
      return Promise.reject(
        new Error(
          `transaction status != 1. tx:[${JSON.stringify(receipt, null, 2)}]`
        )
      )
    }
    // If we cannot get the cfd address
    if (
      receipt == undefined ||
      receipt.events == undefined ||
      receipt.events.LogCFDFactoryNew == undefined ||
      receipt.events.LogCFDFactoryNew.raw == undefined ||
      receipt.events.LogCFDFactoryNew.raw.data == undefined
    )
      return undefined;
    const cfdAddressRaw = receipt.events.LogCFDFactoryNew.raw.data;
    const cfdAddress = '0x' + cfdAddressRaw.substr(cfdAddressRaw.length - 40);
    return this.getCFD(cfdAddress)
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
  async deposit(cfdAddress, depositAccount, amount) {
    const cfd = getContract(cfdAddress, this.web3)
    const fee = await this.joinFee(cfd)
    const value = safeValue(amount.plus(fee))
    await this.daiToken.methods.approve(cfd.options.address, value).send({ from: depositAccount })
    return cfd.methods.deposit(value).send({ from: depositAccount, gas: 1000000 })
  }

  /**
   * Get details of a CFD given a deployment address.
   * @param cfdAddress Address of a deployed CFD
   */
  async getCFD(cfdAddress) {
    const self = this, cfd = getContract(cfdAddress, self.web3);
    return Promise.all([
      cfd.methods.getCfdAttributes().call(),    // [buyer,seller,market,strikePrice,notionalAmountDai,buyerSelling,sellerSelling,status]
      cfd.methods.getCfdAttributes2().call(),   // [buyerInitialNotional,sellerInitialNotional,buyerDepositBalance,sellerDepositBalance,buyerSaleStrikePrice,sellerSaleStrikePrice,buyerInitialStrikePrice,sellerInitialStrikePrice]
      cfd.methods.getCfdAttributes3().call(),   // [termninated,upgradeCalledBy]
      cfd.methods.closed().call()
    ]).then(function (values) {
      // Got all the data, fetch the data that needed previous values
      return Promise.all([
        self.marketIdBytesToStr(values[0][2]),                                            // [market]
        cfd.methods.cutOffPrice(values[0][4], values[1][2], values[1][6], true).call(),   // [buyerLiquidationPrice]
        cfd.methods.cutOffPrice(values[0][4], values[1][3], values[1][7], false).call()   // [sellerLiquidationPrice]
      ]).then(function (values2) {
        // Got the rest of the data
        return Object.assign(cfd, {
          details: {
            address: cfdAddress.toLowerCase(),
            closed: values[3],
            status: parseInt(values[0][7]),
            liquidated: values[2][0],
            upgradeCalledBy: values[2][1].toLowerCase(),
            buyer: values[0][0].toLowerCase(),
            buyerIsSelling: values[0][5],
            seller: values[0][1].toLowerCase(),
            sellerIsSelling: values[0][6],
            market: values2[0],
            notionalAmountDai: fromContractBigNumber(values[0][4]),
            buyerInitialNotional: fromContractBigNumber(values[1][0]),
            sellerInitialNotional: fromContractBigNumber(values[1][1]),
            strikePrice: fromContractBigNumber(values[0][3]),
            buyerSaleStrikePrice: fromContractBigNumber(values[1][4]),
            sellerSaleStrikePrice: fromContractBigNumber(values[1][5]),
            buyerDepositBalance: fromContractBigNumber(values[1][2]),
            sellerDepositBalance: fromContractBigNumber(values[1][3]),
            buyerInitialStrikePrice: fromContractBigNumber(values[1][6]),
            sellerInitialStrikePrice: fromContractBigNumber(values[1][7]),
            buyerLiquidationPrice: fromContractBigNumber(values2[1]),
            sellerLiquidationPrice: fromContractBigNumber(values2[2])
          }
        })
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
  async changeStrikePriceCFD(cfdAddress, userAccount, desiredStrikePrice) {
    const cfd = getContract(cfdAddress, this.web3)

    if ((await cfd.methods.isContractParty(userAccount).call()) === false) {
      return Promise.reject(
        new Error(`${userAccount} is not a party to CFD ${cfdAddress}`)
      )
    }

    const desiredStrikePriceBN = toContractBigNumber(
      desiredStrikePrice
    ).toFixed()

    return cfd.methods.changeStrikePrice(desiredStrikePriceBN).send({ from: userAccount })
  }

  /**
   * Fulfill a request to mark a CFD for sale by calling sellPrepare on the CFD
   * and sending the fee for a single market price read.
   * @param cfdAddress Address of a deployed CFD
   * @param sellerAccount Account settling the position.
   * @param desiredStrikePrice Sellers wants to sell at this strike price.
   * @param timeLimit Sale expired after this time (UNIX epoch seconds).
   *          Defaults to 0 for no limit.
   * @return Promise resolving to success with tx details or reject depending
   *          on the outcome.
   */
  async sellCFD(cfdAddress, sellerAccount, desiredStrikePrice, timeLimit = 0) {
    const cfd = getContract(cfdAddress, this.web3)

    if ((await cfd.methods.isContractParty(sellerAccount).call()) === false) {
      return Promise.reject(
        new Error(`${sellerAccount} is not a party to CFD ${cfdAddress}`)
      )
    }

    const desiredStrikePriceBN = toContractBigNumber(
      desiredStrikePrice
    ).toFixed()

    return cfd.methods.sellPrepare(desiredStrikePriceBN, timeLimit).send({
      from: sellerAccount,
      gas: 100000
    })
  }

  /**
   * Buy a contract for sale
   * @param cfdAddress, Address of the deployed CFD
   * @param account, The address of the account who is buying
   * @param valueToBuy, The amount the user has to pay (DAI)
   * @param isBuyerSide, Boolean if the user is buyer or seller
   * @return Promise resolving to success with tx details or reject depending
   *          on the outcome.
   */
  async buyCFD(cfdAddress, account, valueToBuy, isBuyerSide) {
    const cfd = getContract(cfdAddress, this.web3)
    const fee = await this.joinFee(cfd)
    const valueToBuyBN = new BigNumber(valueToBuy)
    const value = safeValue(valueToBuyBN.plus(fee))
    await this.daiToken.methods.approve(cfd.options.address, value).send({ from: account })
    return cfd.methods.buy(isBuyerSide, value).send({ from: account, gas: 1000000 })
  }

  /**
   * Tansfer the position in a contract to another account.
   * @param cfdAddress, Address of the deployed CFD
   * @param fromAccount, Account who is transferring the position
   * @param toAccount, Account who the position gets transferred too
   * @return Promise resolving to success with tx details or reject depending
   *          on the outcome.
   */
  async transferPosition(cfdAddress, fromAccount, toAccount) {
    const cfd = getContract(cfdAddress, this.web3)
    return cfd.methods.transferPosition(toAccount).send({ from: fromAccount, gas: 50000 })
  }

  /**
   * Force liquidation a contract
   * @param cfdAddress, Address of the deployed CFD
   * @param account, The address of the account who is terminating
   * @return Promise resolving to success with tx details or reject depending
   *          on the outcome.
   */
  async forceTerminate(cfdAddress, account) {
    const cfd = getContract(cfdAddress, this.web3)
    return cfd.methods.forceTerminate().send({ from: account, gas: 150000 })
  }

  /**
   * Cancel a newly created contract (must be non initialized)
   * @param cfdAddress, Address of the deployed CFD
   * @param account, The address of the account who is canceling
   * @return Promise resolving to success with tx details or reject depending
   *          on the outcome.
   */
  async cancelNew(cfdAddress, account) {
    const cfd = getContract(cfdAddress, this.web3)
    return cfd.methods.cancelNew().send({ from: account, gas: 150000 })
  }

  /**
   * Cancel a contract for sale (must be for sale)
   * @param cfdAddress, Address of the deployed CFD
   * @param account, The address of the account who is canceling
   * @return Promise resolving to success with tx details or reject depending
   *          on the outcome.
   */
  async cancelSale(cfdAddress, account) {
    const cfd = getContract(cfdAddress, this.web3)
    return cfd.methods.sellCancel().send({ from: account })
  }

  /**
   * Upgrade a contract to the latest deployed version
   * @param cfdAddress, Address of the deployed CFD
   * @param account, The address of the account who is upgrading
   * @return Promise resolving to success with tx details or reject depending
   *          on the outcome.
   */
  async upgradeCFD(cfdAddress, account) {
    const cfd = getContract(cfdAddress, this.web3)
    return cfd.methods.upgrade().send({ from: account })
  }

  /**
   * Check for liquidation
   * @param cfdAddress, Address of the contract
   * @param account, Account address of the user
   */
  attemptContractLiquidation(cfdAddress, account) {
    const self = this;
    return Promise.all([
      this.web3.eth.getCodeAsync(cfdAddress)
    ]).then(() => {
      // Contract address exists
      const cfd = getContract(cfdAddress, self.web3);
      return cfd.methods.liquidate().send({ from: account, gas: 200000 });
    }).catch(error => {
      throw new Error(error);
    });
  }
  /**
   * Check for liquidation with a signed transaction (for the daemon)
   * @param cfdAddress, Address of the contract
   * @param account, Account address of the user
   */
  attemptContractLiquidationDaemon(cfdAddress, account) {
    const self = this;
    return Promise.all([
      this.web3.eth.getCodeAsync(cfdAddress)
    ]).then(() => {
      // Contract address exists
      const cfd = getContract(cfdAddress, self.web3);
      return signAndSendTransaction(
        self.web3,
        self.config.daemonAccountAddr,
        self.privateKey,
        self.config.priceFeedsInternalContractAddr,
        cfd.methods.liquidate().encodeABI(),
        self.config.gasPrice,
        200000
      );
    }).catch(error => {
      throw new Error(error);
    });
  }

  /**
   * Fulfill a request to change the sale price for a CFD for sale
   * @param cfdAddress Address of a deployed CFD
   * @param sellerAccount Account settling the position.
   * @param desiredStrikePrice Sellers wants to sell at this strike price.
   * @return Promise resolving to success with tx details or reject depending
   *          on the outcome.
   */
  async changeSaleCFD(cfdAddress, sellerAccount, desiredStrikePrice) {
    const cfd = getContract(cfdAddress, this.web3);

    if ((await cfd.methods.isContractParty(sellerAccount).call()) === false) {
      return Promise.reject(
        new Error(`${sellerAccount} is not a party to CFD ${cfdAddress}`)
      )
    }

    const desiredStrikePriceBN = toContractBigNumber(
      desiredStrikePrice
    ).toFixed()

    return cfd.methods.sellUpdate(desiredStrikePriceBN).send({
      from: sellerAccount
    })
  }

  /**
   * Topup a CFD by the amount sent by the user
   * @param cfdAddress, Address of the deployed CFD
   * @param account, The address of the account who is topuping
   * @param valueToAdd, The amount the user wants to add (DAI)
   */
  async topup(cfdAddress, account, valueToAdd) {
    const cfd = getContract(cfdAddress, this.web3);

    if ((await cfd.methods.isContractParty(account).call()) === false) {
      return Promise.reject(
        new Error(`${account} is not a party to CFD ${cfdAddress}`)
      )
    }

    const value = safeValue(valueToAdd)
    await this.daiToken.methods.approve(cfdAddress, value).send({ from: account })
    return cfd.methods.topup(value).send({ from: account })
  }

  /**
   * Withdraw the amount from a CFD
   * @param cfdAddress, Address of the deployed CFD
   * @param account, The address of the account who is withdrawing
   * @param valueToWithdraw, The amount the user wants to withdraw (DAI)
   */
  async withdraw(cfdAddress, account, valueToWithdraw) {
    const cfd = getContract(cfdAddress, this.web3);
    if ((await cfd.methods.isContractParty(account).call()) === false) {
      return Promise.reject(
        new Error(`${account} is not a party to CFD ${cfdAddress}`)
      )
    }

    const value = safeValue(valueToWithdraw)
    return cfd.methods.withdraw(value).send({ from: account })
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
  contractsForMarket(
    marketId,
    { fromBlock = this.config.deploymentBlockNumber || 0, includeLiquidated = false }
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
      getAllEventsWithName("LogCFDFactoryNew", this.cfdFactory, fromBlock).then((events) => {
        if (events == undefined || events.length <= 0) {
          resolve([]);
          return;
        }
        // For each event, find the cfd address and filter on the market ID
        events = events.filter(function (ev) {
          if (ev.raw.data == undefined || ev.raw.topics.length <= 1)
            return false;
          ev.address = '0x' + ev.raw.data.substr(ev.raw.data.length - 40);
          return (market == ev.raw.topics[1]);
        });
        // For each event, get the CFD
        getCFDs(events).then(cfds => resolve(cfds.filter((cfd) => {
          // Check if we want to exclude the liquidated
          if (includeLiquidated == true || cfd.details.closed == false)
            return true;
          return false;
        })));
      }, (err) => reject(err));
    });
  }

  /**
   * Get contracts that a party is or has been associated with (as buyer or
   * seller).
   * @param partyAddress Get contracts for this party
   * @param options Object with optional properties:
   *          fromBlock Block to query events from (default=0)
   *          includeLiquidated Include liquidated cfd's in the results
   *                            (default=false)
   * @return a promise with the array of contracts
   */
  contractsForParty(
    partyAddress,
    { fromBlock = this.config.deploymentBlockNumber || 0, includeLiquidated = false }
  ) {
    const self = this;
    // Function to get one CFD details
    const getDetailsCfd = async (ev) => {
      let cfd = await self.getCFD(ev.address);
      const block = await self.web3.eth.getBlockAsync(ev.blockNumber);
      cfd.details.ts = new Date(block.timestamp * 1000);
      return cfd;
    }
    // Function to get the CFDs from addresses
    const getCFDs = async events => {
      let results = await Promise.all(
        events.map((ev) => {
          return getDetailsCfd(ev);
        })
      )
      return results
    }

    return new Promise((resolve, reject) => {
      // Get all the events
      getAllEventsWithName("LogCFDRegistryParty", this.cfdRegistry, fromBlock).then((events) => {
        if (events == undefined || events.length <= 0) {
          resolve([]);
          return;
        }
        // For each event, find the cfd address
        events = events.filter(function (ev) {
          if (ev.raw.topics.length <= 1)
            return false;
          ev.address = '0x' + ev.raw.topics[1].substr(ev.raw.topics[1].length - 40);
          return true;
        })
          // And remove duplicates events (by checking cfd address)
          .filter((ev, i, self) => i === self.findIndex((t) => (t.address == ev.address)));
        // For each event, get the CFD
        getCFDs(events).then(cfds => resolve(cfds.filter((cfd) => {
          // Check if we want to exclude the liquidated
          if ((cfd.details.buyer.toLowerCase() == partyAddress.toLowerCase() ||
            cfd.details.seller.toLowerCase() == partyAddress.toLowerCase()) &&
            (includeLiquidated == true || cfd.details.closed == false))
            return true;
          return false;
        })));
      }, (err) => reject(err));
    });
  }

  /**
   * Get contracts that have been created but don't yet have a counterparty.
   * @param options Object with optional properties:
   *          fromBlock Block to query events from (default=0)
   * @return a promise with the array of contracts
   */
  contractsWaitingCounterparty(
    { fromBlock = this.config.deploymentBlockNumber || 0 }
  ) {
    const self = this;
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
      getAllEventsWithName("LogCFDRegistryNew", this.cfdRegistry, fromBlock).then((events) => {
        if (events == undefined || events.length <= 0) {
          resolve([]);
          return;
        }
        // For each event, find the cfd address
        events = events.filter(function (ev) {
          if (ev.raw.topics.length <= 1)
            return false;
          ev.address = '0x' + ev.raw.topics[1].substr(ev.raw.topics[1].length - 40);
          return true;
        })
          // And remove duplicates events (by checking cfd address)
          .filter((ev, i, self) => i === self.findIndex((t) => (t.address == ev.address)));
        // For each event, get the CFD
        getCFDs(events).then(cfds => resolve(cfds.filter((cfd) => {
          // Get only the CFD that are not initialized and not closed
          if (cfd.details.status == STATUS.CREATED && cfd.details.closed == false)
            return true;
          return false;
        })));
      }, (err) => reject(err));
    });
  }

  /**
   * Get contracts available for sale (sellPrepare() called and waiting a buy())
   * @param options Object with optional properties:
   *          fromBlock Block to query events from (default=0)
   * @return a promise with the array of contracts
   */
  contractsForSale(
    { fromBlock = this.config.deploymentBlockNumber || 0 }
  ) {
    const self = this;
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
      getAllEventsWithName("LogCFDRegistrySale", this.cfdRegistry, fromBlock).then((events) => {
        if (events == undefined || events.length <= 0) {
          resolve([]);
          return;
        }
        // For each event, find the cfd address
        events = events.filter(function (ev) {
          if (ev.raw.topics.length <= 1)
            return false;
          ev.address = '0x' + ev.raw.topics[1].substr(ev.raw.topics[1].length - 40);
          return true;
        })
          // And remove duplicates events (by checking cfd address)
          .filter((ev, i, self) => i === self.findIndex((t) => (t.address == ev.address)));
        // For each event, get the CFD
        getCFDs(events).then(cfds => resolve(cfds.filter((cfd) => {
          // Get only the CFD that are not initialized and not closed
          if (cfd.details.status == STATUS.SALE && cfd.details.closed == false &&
            (cfd.details.buyerIsSelling == true || cfd.details.sellerIsSelling == true))
            return true;
          return false;
        })));
      }, (err) => reject(err));
    });
  }























  /**
   * Convert market id in string format to bytes32 format
   * @param marketIdStr eg. Poloniex_ETH_USD
   * @return bytes32 sha3 of the marketIdStr
   */
  marketIdStrToBytes(marketIdStr) {
    return this.web3.utils.sha3(marketIdStr)
  }

  /**
   * Convert market id in bytes32 format to string format by looking up the
   * Feeds.marketNames smart contract list.
   * @param marketId sha3 of the market id string
   * @return Market id string
   */
  marketIdBytesToStr(marketId) {
    return this.priceFeeds.methods.marketName(marketId).call()
  }

  async joinFee(cfd) {
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
  constructor(config, web3, privateKey = undefined) {
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
  async initialise() {
    this.cfd = cfdInstance(
      this.web3.currentProvider,
      this.config.ownerAccountAddr
    )
    this.cfdFactory = await cfdFactoryInstanceDeployed(this.config, this.web3)
    this.cfdRegistry = await cfdRegistryInstanceDeployed(this.config, this.web3)
    this.daiToken = await daiTokenInstanceDeployed(this.config, this.web3)
    this.priceFeeds = await priceFeedsInstanceDeployed(this.config, this.web3)
    return this
  }
}
