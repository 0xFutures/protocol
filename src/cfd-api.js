import BigNumber from 'bignumber.js'
import Promise from 'bluebird'

import {
  cfdInstance,
  cfdFactoryInstanceDeployed,
  cfdRegistryInstanceDeployed,
  feedsInstanceDeployed
} from './contracts'
import {
  assertBigNumberOrString,
  fromContractBigNumber,
  toContractBigNumber,
  txFailed
} from './utils'

import {creatorFee, joinerFee} from './calc'

// strip off any decimal component of a wei value as wei is the smallest unit of ETH
const safeWeiValue = weiValue => weiValue.toFixed(0)

export default class CFDAPI {
  /**
   * Create a new instance of this class setting up contract handles and
   * valaditing the config addresses point to actual deployed contracts.
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
    const api = new CFDAPI(config, web3)
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
   * @param notionalAmountWei Contract amount
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
    notionalAmountWei,
    leverage,
    isBuyer,
    creator
  ) {
    assertBigNumberOrString(strikePrice)
    assertBigNumberOrString(notionalAmountWei)
    assertBigNumberOrString(leverage)

    const decimals = await this.feeds.decimals.call()
    const strikePriceBN = toContractBigNumber(strikePrice, decimals).toString()
    const marketId = this.marketIdStrToBytes(marketIdStr)
    const leverageValue = parseFloat(leverage)

    if (isNaN(leverageValue) === true || leverageValue === 0) {
      return Promise.reject(new Error(`invalid leverage`))
    }

    const notionalBN = new BigNumber(notionalAmountWei)
    const deposit = notionalBN.dividedBy(leverageValue)
    const valueWei = deposit.plus(creatorFee(notionalBN))

    const createTx = await this.cfdFactory.createContract(
      marketId,
      strikePriceBN,
      notionalAmountWei,
      isBuyer,
      {from: creator, value: safeWeiValue(valueWei), gas: 500000}
    )

    if (txFailed(createTx.receipt.status)) {
      return Promise.reject(
        new Error(
          `transaction status != 1. tx:[${JSON.stringify(createTx, null, 2)}]`
        )
      )
    }

    const cfdAddress = createTx.receipt.logs[1].address
    return this.cfd.at(cfdAddress)
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
    const cfd = this.cfd.at(cfdAddress)
    const fee = await this.joinFee(cfd)
    return cfd.deposit({
      from: depositAccount,
      value: safeWeiValue(amount.plus(fee)),
      gas: 1000000
    })
  }

  /**
   * Get details of a CFD given a deployment address.
   * @param cfdAddress Address of a deployed CFD
   */
  async getCFD (cfdAddress) {
    // TODO:   call getCode to check it exists
    const cfd = this.cfd.at(cfdAddress)
    const self = this
    return Promise.all([
      cfd.getCfdAttributes.call(), // [buyer,seller,market,strikePrice,notionalAmountWei,buyerSelling,sellerSelling,status]
      cfd.getCfdAttributes2.call(), // [buyerInitialNotional,sellerInitialNotional,buyerDepositBalance,sellerDepositBalance,buyerSaleStrikePrice,sellerSaleStrikePrice,buyerInitialStrikePrice,sellerInitialStrikePrice]
      cfd.getCfdAttributes3.call(), // [termninated,upgradeCalledBy]
      self.feeds.decimals.call()
    ]).then(function (values) {
      // Got all the data, fetch the data that needed previous values
      const strikePrice = fromContractBigNumber(values[0][3], values[3])
      return Promise.all([
        self.marketIdBytesToStr(values[0][2]), // [0]
        cfd.cutOffPrice.call(values[0][4], values[1][2], strikePrice, true), // [1]
        cfd.cutOffPrice.call(values[0][4], values[1][3], strikePrice, false) // [2]
      ]).then(function (values2) {
        // Got the rest of the data
        return {
          address: cfdAddress,
          status: values[0][7],
          liquidated: values[2][0],
          upgradeCalledBy: values[2][1],
          buyer: values[0][0],
          buyerIsSelling: values[0][5],
          seller: values[0][1],
          sellerIsSelling: values[0][6],
          market: values2[0],
          notionalAmountWei: values[0][4],
          buyerInitialNotional: values[1][0],
          sellerInitialNotional: values[1][1],
          strikePrice: strikePrice,
          buyerSaleStrikePrice: fromContractBigNumber(values[1][4], values[3]),
          sellerSaleStrikePrice: fromContractBigNumber(values[1][5], values[3]),
          buyerDepositBalance: values[1][2],
          sellerDepositBalance: values[1][3],
          buyerInitialStrikePrice: fromContractBigNumber(
            values[1][6],
            values[3]
          ),
          sellerInitialStrikePrice: fromContractBigNumber(
            values[1][7],
            values[3]
          ),
          buyerLiquidationPrice: values2[1],
          sellerLiquidationPrice: values2[2]
        }
      })
    })
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
  async sellCFD (cfdAddress, sellerAccount, desiredStrikePrice, timeLimit = 0) {
    const cfd = this.cfd.at(cfdAddress)

    if ((await cfd.isContractParty.call(sellerAccount)) === false) {
      return Promise.reject(
        new Error(`${sellerAccount} is not a party to CFD ${cfdAddress}`)
      )
    }

    const decimals = await this.feeds.decimals.call()
    const desiredStrikePriceBN = toContractBigNumber(
      desiredStrikePrice,
      decimals
    ).toString()

    return cfd.sellPrepare(desiredStrikePriceBN, timeLimit, {
      from: sellerAccount,
      gas: 100000
    })
  }

  /**
   * Fulfill a request to change the sale price for a CFD for sale
   * @param cfdAddress Address of a deployed CFD
   * @param sellerAccount Account settling the position.
   * @param desiredStrikePrice Sellers wants to sell at this strike price.
   * @return Promise resolving to success with tx details or reject depending
   *          on the outcome.
   */
  async changeSaleCFD (cfdAddress, sellerAccount, desiredStrikePrice) {
    const cfd = this.cfd.at(cfdAddress)

    if ((await cfd.isContractParty.call(sellerAccount)) === false) {
      return Promise.reject(
        new Error(`${sellerAccount} is not a party to CFD ${cfdAddress}`)
      )
    }

    const decimals = await this.feeds.decimals.call()
    const desiredStrikePriceBN = toContractBigNumber(
      desiredStrikePrice,
      decimals
    ).toString()

    return cfd.sellUpdate(desiredStrikePriceBN, {
      from: sellerAccount
    })
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
    const cfd = this.cfd.at(cfdAddress)

    if ((await cfd.isContractParty.call(userAccount)) === false) {
      return Promise.reject(
        new Error(`${userAccount} is not a party to CFD ${cfdAddress}`)
      )
    }

    const decimals = await this.feeds.decimals.call()
    const desiredStrikePriceBN = toContractBigNumber(
      desiredStrikePrice,
      decimals
    ).toString()

    return cfd.changeStrikePrice(desiredStrikePriceBN, {
      from: userAccount
    })
  }

  /**
   * Buy a contract for sale
   * @param cfdAddress, Address of the deployed CFD
   * @param account, The address of the account who is topuping
   * @param valueToBuy, The amount (in Wei) the user has to pay
   * @param isBuyerSide, Boolean if the user is buyer or seller
   * @return Promise resolving to success with tx details or reject depending
   *          on the outcome.
   */
  async buyCFD (cfdAddress, account, valueToBuy, isBuyerSide) {
    const cfd = this.cfd.at(cfdAddress)
    const valueToBuyBN = new BigNumber(valueToBuy)
    const valuePlusBuy = valueToBuyBN.plus(await this.joinFee(cfd))
    return cfd.buy(isBuyerSide, {
      from: account,
      value: safeWeiValue(valuePlusBuy),
      gas: 200000
    })
  }

  /**
   * Force liquidation a contract
   * @param cfdAddress, Address of the deployed CFD
   * @param account, The address of the account who is terminating
   * @return Promise resolving to success with tx details or reject depending
   *          on the outcome.
   */
  async forceTerminate (cfdAddress, account) {
    const cfd = this.cfd.at(cfdAddress)
    return cfd.forceTerminate({
      from: account,
      gas: 150000
    })
  }

  /**
   * Topup a CFD by the amount sent by the user
   * @param cfdAddress, Address of the deployed CFD
   * @param account, The address of the account who is topuping
   * @param valueToAdd, The amount (in Wei) the user wants to add
   */
  async topup (cfdAddress, account, valueToAdd) {
    const cfd = this.cfd.at(cfdAddress)

    if ((await cfd.isContractParty.call(account)) === false) {
      return Promise.reject(
        new Error(`${account} is not a party to CFD ${cfdAddress}`)
      )
    }

    return cfd.topup({
      from: account,
      value: safeWeiValue(valueToAdd)
    })
  }

  /**
   * Withdraw the amount from a CFD
   * @param cfdAddress, Address of the deployed CFD
   * @param account, The address of the account who is withdrawing
   * @param valueToWithdraw, The amount (in Wei) the user wants to withdraw
   */
  async withdraw (cfdAddress, account, valueToWithdraw) {
    const cfd = this.cfd.at(cfdAddress)``
    if ((await cfd.isContractParty.call(account)) === false) {
      return Promise.reject(
        new Error(`${account} is not a party to CFD ${cfdAddress}`)
      )
    }

    return cfd.withdraw(valueToWithdraw, {
      from: account
    })
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
    const cfd = this.cfd.at(cfdAddress)
    return cfd.transferPosition(toAccount, {
      from: fromAccount,
      gas: 50000
    })
  }

  /**
   * Get contracts that have been created but don't yet have a counterparty.
   * @param options Object with optional properties:
   *          fromBlock Block to query events from (default=0)
   * @param onSuccessCallback Callback receives list of matching cfd address's
   * @param onErrorCallback Callback receives error details on error
   */
  contractsWaitingCounterparty (
    {fromBlock = 0},
    onSuccessCallback,
    onErrorCallback
  ) {
    const self = this
    const hasLiquidated = async cfd => cfd.closed.call()
    const getAttributes = async cfd => cfd.getCfdAttributes.call()
    const getAttributes2 = async cfd => cfd.getCfdAttributes2.call()
    const getMarketStr = async market => self.marketIdBytesToStr(market)
    const getStrikePrice = async (cfd, decimals) =>
      fromContractBigNumber(await cfd.strikePrice.call(), decimals)

    // Get the CFD that are not initialized and not closed
    const filterCfds = async cfdRecs => {
      let result = cfdRecs
      // Filter out the initialized cfds
      const initiatedFlags = await Promise.all(
        result.map(({cfd}) => cfd.initiated.call())
      )
      result = result.filter((rec, idx) => initiatedFlags[idx] === false)
      // Filter out the closed cfds
      const hasLiquidatedArr = await Promise.all(
        result.map(({cfd}) => hasLiquidated(cfd))
      )
      result = result.filter((rec, idx) => hasLiquidatedArr[idx] === false)
      return result
    }

    // For each CFD, get the market and the status
    const getDetailsCfds = async filteredCfds => {
      let result = filteredCfds
      // Get decimals
      const decimals = await self.feeds.decimals.call()
      const attributesCfds = await Promise.all(
        result.map(({cfd}) => getAttributes(cfd))
      )
      const attributes2Cfds = await Promise.all(
        result.map(({cfd}) => getAttributes2(cfd))
      )
      const marketCfdsStr = await Promise.all(
        result.map((cfd, idx) => getMarketStr(attributesCfds[idx][2]))
      )
      const strikePriceCfds = await Promise.all(
        result.map(({cfd}) => getStrikePrice(cfd, decimals))
      )
      // For each contract, set their specific market and status
      result = result.map((cfd, idx) => {
        cfd.cfd.details = cfd.cfd.details === undefined ? {} : cfd.cfd.details
        cfd.cfd.details.buyer = attributesCfds[idx][0]
        cfd.cfd.details.seller = attributesCfds[idx][1]
        cfd.cfd.details.market = marketCfdsStr[idx]
        cfd.cfd.details.notional = attributesCfds[idx][4]
        cfd.cfd.details.buyerDepositBalance = attributes2Cfds[idx][2]
        cfd.cfd.details.sellerDepositBalance = attributes2Cfds[idx][3]
        cfd.cfd.details.strikePrice = strikePriceCfds[idx]
        return cfd
      })
      return result
    }

    const event = this.cfdRegistry.LogCFDRegistryNew(
      {},
      {fromBlock: fromBlock, toBlock: 'latest'}
    )

    event.get((error, events) => {
      if (error) {
        onErrorCallback(error)
        return
      }
      this.eventsToCfdRecs(events)
        .then(cfdRecs => filterCfds(cfdRecs))
        .then(filteredCfds => getDetailsCfds(filteredCfds))
        .then(filteredDetailedCfds => onSuccessCallback(filteredDetailedCfds))
    })
  }

  /**
   * Get contracts that a party is or has been associated with (as buyer or
   * seller).
   * @param partyAddress Get contracts for this party
   * @param options Object with optional properties:
   *          fromBlock Block to query events from (default=0)
   *          includeLiquidated Include liquidated cfd's in the results
   *                            (default=false)
   *          includeTransferred Include cfd's that partyAddress transferred or
   *                             sold to another account (ie. cfd's they were
   *                             once a part of but no longer are)
   *                             (default=false)
   * @param onSuccessCallback Callback receives list of matching cfd address's
   * @param onErrorCallback Callback receives error details on error
   */
  contractsForParty (
    partyAddress,
    {fromBlock = 0, includeLiquidated = false, includeTransferred = false},
    onSuccessCallback,
    onErrorCallback
  ) {
    const self = this
    const getAttributes = async cfd => cfd.getCfdAttributes.call()
    const getMarketStr = async market => self.marketIdBytesToStr(market)
    const hasLiquidated = async cfd => cfd.closed.call()
    const hasTransferred = async (cfd, party) =>
      party !== (await cfd.buyer.call()) && party !== (await cfd.seller.call())

    // Filter the CFDS to get the one we want
    const filterCfds = async cfdRecs => {
      let result = cfdRecs
      if (includeLiquidated === false) {
        const hasLiquidatedArr = await Promise.all(
          result.map(({cfd}) => hasLiquidated(cfd))
        )
        result = result.filter((rec, idx) => hasLiquidatedArr[idx] === false)
      }
      if (includeTransferred === false) {
        const hasTransferredArr = await Promise.all(
          result.map(({cfd}) => hasTransferred(cfd, partyAddress))
        )
        result = result.filter((rec, idx) => hasTransferredArr[idx] === false)
      }
      return result
    }

    // For each CFD, get the market and the status
    const getDetailsCfds = async filteredCfds => {
      let result = filteredCfds
      const attributesCfds = await Promise.all(
        result.map(({cfd}) => getAttributes(cfd))
      )
      const marketCfdsStr = await Promise.all(
        result.map((cfd, idx) => getMarketStr(attributesCfds[idx][2]))
      )
      // For each contract, set their specific market and status
      result = result.map((cfd, idx) => {
        cfd.cfd.details = cfd.cfd.details === undefined ? {} : cfd.cfd.details
        cfd.cfd.details.buyer = attributesCfds[idx][0]
        cfd.cfd.details.seller = attributesCfds[idx][1]
        cfd.cfd.details.market = marketCfdsStr[idx]
        cfd.cfd.details.status = attributesCfds[idx][7]
        cfd.cfd.details.buyerIsSelling = attributesCfds[idx][5]
        cfd.cfd.details.sellerIsSelling = attributesCfds[idx][6]
        return cfd
      })

      return result
    }

    const event = this.cfdRegistry.LogCFDRegistryParty(
      {party: partyAddress},
      {fromBlock: fromBlock, toBlock: 'latest'}
    )

    event.get((error, events) => {
      if (error) {
        onErrorCallback(error)
        return
      }
      this.eventsToCfdRecs(events)
        .then(cfdRecs => filterCfds(cfdRecs))
        .then(filteredCfds => getDetailsCfds(filteredCfds))
        .then(filteredDetailedCfds => onSuccessCallback(filteredDetailedCfds))
    })
  }

  /**
   * Get all contracts for a specific market
   * @param marketId
   * @param options Object with optional properties:
   *          fromBlock Block to query events from (default=0)
   *          includeLiquidated Include liquidated cfd's in the results
   *                            (default=false)
   * @param onSuccessCallback Callback receives list of matching cfd address's
   * @param onErrorCallback Callback receives error details on error
   */
  contractsForMarket (
    marketId,
    {fromBlock = 0, includeLiquidated = false},
    onSuccessCallback,
    onErrorCallback
  ) {
    const self = this
    const hasLiquidated = async cfd => cfd.closed.call()
    const getDetailsCfd = async cfd => self.getCFD(cfd.address)
    const market = this.marketIdStrToBytes(marketId)
    const event = this.cfdFactory.LogCFDFactoryNew(
      {marketId: market},
      {fromBlock: fromBlock, toBlock: 'latest'}
    )

    const filterCfds = async cfdRecs => {
      let result = cfdRecs
      if (includeLiquidated === false) {
        const hasLiquidatedArr = await Promise.all(
          result.map(({cfd}) => hasLiquidated(cfd))
        )
        result = result.filter((rec, idx) => hasLiquidatedArr[idx] === false)
      }
      let results = await Promise.all(
        result.map(({cfd}) => {
          return getDetailsCfd(cfd)
        })
      )
      return results
    }

    event.get((error, events) => {
      if (error) {
        onErrorCallback(error)
        return
      }

      const eventsCfd = events.map((event, idx) => {
        return {cfd: self.cfd.at(event.args.newCFDAddr)}
      })
      filterCfds(eventsCfd).then(filteredCfds =>
        onSuccessCallback(filteredCfds)
      )
    })
  }

  /**
   * Get contracts available for sale (sellPrepare() called and waiting a buy())
   * @param options Object with optional properties:
   *          fromBlock Block to query events from (default=0)
   * @param onSuccessCallback Callback receives list of matching cfd address's
   * @param onErrorCallback Callback receives error details on error
   */
  contractsForSale ({fromBlock = 0}, onSuccessCallback, onErrorCallback) {
    const self = this
    const hasSideOnSale = async cfd =>
      ((await cfd.closed.call()) === false &&
      ((await cfd.isSellerSelling.call()) === true ||
        (await cfd.isBuyerSelling.call()) === true))
    const getAttributes = async cfd => cfd.getCfdAttributes.call()
    const getAttributes2 = async cfd => cfd.getCfdAttributes2.call()
    const getMarketStr = async market => self.marketIdBytesToStr(market)
    const getStrikePrice = async (cfd, decimals) =>
      fromContractBigNumber(await cfd.strikePrice.call(), decimals)

    // For each CFD, get the market and the status
    const getDetailsCfds = async filteredCfds => {
      let result = filteredCfds
      // Get decimals
      const decimals = await self.feeds.decimals.call()
      const attributesCfds = await Promise.all(
        result.map(({cfd}) => getAttributes(cfd))
      )
      const attributes2Cfds = await Promise.all(
        result.map(({cfd}) => getAttributes2(cfd))
      )
      const marketCfdsStr = await Promise.all(
        result.map((cfd, idx) => getMarketStr(attributesCfds[idx][2]))
      )
      const strikePriceCfds = await Promise.all(
        result.map(({cfd}) => getStrikePrice(cfd, decimals))
      )
      // For each contract, set their specific market and status
      result = result.map((cfd, idx) => {
        cfd.cfd.details = cfd.cfd.details === undefined ? {} : cfd.cfd.details
        cfd.cfd.details.buyer = attributesCfds[idx][0]
        cfd.cfd.details.buyerSelling = attributesCfds[idx][5]
        cfd.cfd.details.sellerSelling = attributesCfds[idx][6]
        cfd.cfd.details.buyerSaleStrikePrice = fromContractBigNumber(
          attributes2Cfds[idx][4],
          decimals
        )
        cfd.cfd.details.sellerSaleStrikePrice = fromContractBigNumber(
          attributes2Cfds[idx][5],
          decimals
        )
        cfd.cfd.details.seller = attributesCfds[idx][1]
        cfd.cfd.details.market = marketCfdsStr[idx]
        cfd.cfd.details.notional = attributesCfds[idx][4]
        cfd.cfd.details.buyerDepositBalance = attributes2Cfds[idx][2]
        cfd.cfd.details.sellerDepositBalance = attributes2Cfds[idx][3]
        cfd.cfd.details.strikePrice = strikePriceCfds[idx]
        return cfd
      })
      return result
    }
    
    const filterCfds = async cfdRecs => {
      let result = cfdRecs
      const hasSideOnSaleArr = await Promise.all(
        result.map(({cfd}) => hasSideOnSale(cfd))
      )
      result = result.filter((rec, idx) => hasSideOnSaleArr[idx] === true)
      let results = await Promise.all(
        result.map((cfd) => {
          return cfd
        })
      )
      return results
    }

    const event = this.cfdRegistry.LogCFDRegistrySale(
      {},
      {fromBlock: fromBlock, toBlock: 'latest'}
    )

    event.get((error, events) => {
      if (error) {
        onErrorCallback(error)
        return
      }
      this.eventsToCfdRecs(events)
        .then(cfdRecs => filterCfds(cfdRecs))
        .then(filteredCfds => getDetailsCfds(filteredCfds))
        .then(filteredDetailedCfds => onSuccessCallback(filteredDetailedCfds))
    })
  }

  /**
   * Update subscriber to check for liquidation
   * @param cfdAddress Address of the contract
   */
  attemptContractLiquidation (cfdAddress, account) {
    const cfd = this.cfd.at(cfdAddress)
    return cfd.liquidate({
      from: account,
      gas: 200000
    })
  }

  /**
   * Convert market id in string format to bytes32 format
   * @param marketIdStr eg. Poloniex_ETH_USD
   * @return bytes32 sha3 of the marketIdStr
   */
  marketIdStrToBytes (marketIdStr) {
    return this.web3.sha3(marketIdStr)
  }

  /**
   * Convert market id in bytes32 format to string format by looking up the
   * Feeds.marketNames smart contract list.
   * @param marketId sha3 of the market id string
   * @return Market id string
   */
  marketIdBytesToStr (marketId) {
    return this.feeds.marketNames.call(marketId)
  }

  /**
   * Get block timestamp for a given block number
   * @param blockNumber Block number
   * @return Date instance for block timestamp
   */
  async blockToDate (blockNumber) {
    const block = await this.web3.eth.getBlockAsync(blockNumber)
    return new Date(block.timestamp * 1000)
  }

  /**
   * Convert a list of CFD events to records that include a truffle-contract
   * handle to the cfd and the timestamp of the related event.
   * @param events CFD events
   * @return Array of {
   *    cfd: truffle-contract instance,
   *    ts: Date instance for block timestamp of the event
   * }
   */
  async eventsToCfdRecs (events) {
    const self = this
    const eventTimestamps = await Promise.all(
      events.map(event => self.blockToDate(event.blockNumber))
    )
    const seenCfd = {}
    return (
      events
        .map((event, idx) => {
          return {
            cfd: self.cfd.at(event.args.cfd),
            ts: eventTimestamps[idx]
          }
        })
        // #7 filter out duplicates
        .filter(({cfd}) => {
          if (cfd.address in seenCfd) return false
          seenCfd[cfd.address] = true
          return true
        })
    )
  }

  /**
   * Returns the current collateral for the buyer and the seller
   * @param strikePrice, Current market price
   * @param marketPrice, CFD strike price
   * @param notionalAmount, CFD notional amount
   * @param depositBalance, Deposit balance for this side
   * @param isBuyer, if we want the buyer or seller side
   * @return Array of current collateral for both the buyer and seller
   *         [buyerCollateral, sellerCollateral]
   */
  async currentCollateral (
    cfdAddress,
    strikePrice,
    marketPrice,
    notionalAmount,
    depositBalance,
    isBuyer
  ) {
    const cfd = this.cfd.at(cfdAddress)
    return cfd.calculateCollateralAmount.call(
      strikePrice,
      marketPrice,
      notionalAmount,
      depositBalance,
      isBuyer
    )
  }

  async joinFee (cfd) {
    const notionalAmount = await cfd.notionalAmountWei.call()
    return joinerFee(notionalAmount)
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
    this.cfd = cfdInstance(
      this.web3.currentProvider,
      this.config.ownerAccountAddr
    )
    this.cfdFactory = await cfdFactoryInstanceDeployed(this.config, this.web3)
    this.cfdRegistry = await cfdRegistryInstanceDeployed(this.config, this.web3)
    this.feeds = await feedsInstanceDeployed(this.config, this.web3)
    return this
  }
}
