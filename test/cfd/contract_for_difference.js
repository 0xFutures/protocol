import { assert } from 'chai'
import { BigNumber } from 'bignumber.js'

import {
  nowSecs,
  toContractBigNumber,
  EMPTY_ACCOUNT,
  STATUS
} from '../../src/infura/utils'
import {
  calculateCollateral,
  calculateNewNotional,
  cutOffPrice
} from '../../src/calc'
import { cfdInstance } from '../../src/infura/contracts'

import { assertEqualAddress, assertEqualBN, assertLoggedParty, assertStatus } from '../helpers/assert'
import { deployAllForTest, mockMakerPut } from '../helpers/deploy'
import { config, web3 } from '../helpers/setup'

const REJECT_MESSAGE = 'Returned error: VM Exception while processing transaction: revert'

const MINIMUM_COLLATERAL_PERCENT = new BigNumber(20)
const MAXIMUM_COLLATERAL_PERCENT = new BigNumber(500)

const ONE_DAI = new BigNumber('1e18')
const ONE_BN = new BigNumber(1)

describe('ContractForDifference', function () {
  const ContractForDifference = cfdInstance(web3.currentProvider, config)

  web3.eth.getAccounts().then((accounts) => {

    const DAEMON_ACCOUNT = accounts[3]
    const CREATOR_ACCOUNT = accounts[2]
    const COUNTERPARTY_ACCOUNT = accounts[4]

    // some defaults for testing
    const strikePriceRaw = new BigNumber('800.0')
    const notionalAmount = ONE_DAI

    // the following get set up in the before() block
    let marketId
    let strikePriceAdjusted

    let registry
    let priceFeeds
    let priceFeedsExternal
    let priceFeedsInternal
    let cfdRegistry
    let daiToken
    let ethUsdMaker
    let markets
    let marketNames

    let minimumCollateral
    let maximumCollateral

    const getBalance = addr => {
      return new Promise((resolve, reject) => {
        daiToken.methods.balanceOf(addr).call().then((val) => {
          resolve(new BigNumber(val));
        }, (err) => reject());
      });
    }
    const deposit = async (cfd, from, amount) => {
      await daiToken.methods.approve(cfd.options.address, amount).send({ from: from })
      return cfd.methods.deposit(amount).send({ from: from })
    }
    const buy = async (cfd, from, buyBuyerSide, amount) => {
      await daiToken.methods.approve(cfd.options.address, amount).send({ from: from })
      return cfd.methods.buy(buyBuyerSide, amount).send({ from: from })
    }

    /**
     * Create a new CFD directly.
     * Implements the same steps that the CFDFactory contract does.
     */
    const newCFD = async ({
      strikePrice = strikePriceAdjusted,
      notionalAmount,
      isBuyer,
      daiValue = notionalAmount,
      creator = CREATOR_ACCOUNT,
      market = marketId
    }) => {

      const cfd = await ContractForDifference.deploy({}).send({
        from: creator,
        gas: 6700000
      })

      const transferAmount = daiValue
      await daiToken.methods.transfer(cfd.options.address, transferAmount.toFixed()).send()

      await cfd.methods.createNew(
        registry.options.address,
        cfdRegistry.options.address,
        priceFeeds.options.address,
        creator,
        market,
        new BigNumber(strikePrice).toFixed(),
        new BigNumber(notionalAmount).toFixed(),
        isBuyer
      ).send({
        gas: 1000000,
        from: creator
      })

      // from default web3 account masquerading as a factory (see setFactory call in setup)
      await cfdRegistry.methods.registerNew(cfd.options.address, CREATOR_ACCOUNT).send()

      return cfd
    }

    before(async () => {

      // eslint-disable-next-line no-extra-semi
      ; ({
        cfdRegistry,
        priceFeeds,
        priceFeedsInternal,
        priceFeedsExternal,
        registry,
        daiToken,
        ethUsdMaker,
        markets,
        marketNames
      } = await deployAllForTest({
        web3,
        initialPriceInternal: strikePriceRaw
      })
      )
      strikePriceAdjusted = toContractBigNumber(strikePriceRaw)
      marketId = markets[marketNames.poloniexEthUsd]

      // set factory to default account so we can manually call registerNew
      await cfdRegistry.methods.setFactory(config.ownerAccountAddr).send()

      minimumCollateral = notionalAmount.times(
        MINIMUM_COLLATERAL_PERCENT.dividedBy(100)
      )

      maximumCollateral = notionalAmount.times(
        MAXIMUM_COLLATERAL_PERCENT.dividedBy(100)
      )
      // give tokens to CFD parties
      const daiSendingTestAccounts = [CREATOR_ACCOUNT, COUNTERPARTY_ACCOUNT, accounts[5], accounts[9]]
      await Promise.all(daiSendingTestAccounts.map(acc => daiToken.methods.transfer(acc, ONE_DAI.times(100).toFixed()).send()))
    })

    setTimeout(function () {

      describe('initiation', async () => {
        it('creates a new CFD with contract terms', async () => {

          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          assert.equal(await cfd.methods.market().call(), marketId, 'market incorrect')
          assert.equal(await cfd.methods.buyer().call(), CREATOR_ACCOUNT, 'buyer incorrect')
          assert.equal(await cfd.methods.seller().call(), EMPTY_ACCOUNT, 'seller incorrect')
          assertEqualBN(
            await cfd.methods.strikePrice().call(),
            strikePriceAdjusted,
            'strike price incorrect'
          )
          assertEqualBN(
            await cfd.methods.sellerInitialStrikePrice().call(),
            strikePriceAdjusted,
            'seller strike price not 0'
          )
          assertEqualBN(
            await cfd.methods.buyerInitialStrikePrice().call(),
            strikePriceAdjusted,
            'buyer strike price not 0'
          )
          assertEqualBN(
            await cfd.methods.notionalAmountDai().call(),
            notionalAmount,
            'notionalAmountDai incorrect'
          )
          assertEqualBN(
            await getBalance(cfd.options.address),
            notionalAmount,
            'cfd balance incorrect'
          )
          assert.isFalse(await cfd.methods.initiated().call(), 'should not be initiated')
          await assertStatus(cfd, STATUS.CREATED)
        })


        it('creates a new CFD with colateral exactly MINIMUM_COLLATERAL_PERCENT of the notional', async () => {
          const collateral = minimumCollateral
          const cfd = await newCFD({
            notionalAmount,
            isBuyer: true,
            daiValue: collateral
          })
          assert.equal(await cfd.methods.buyer().call(), CREATOR_ACCOUNT, 'buyer incorrect')
          assertEqualBN(
            await getBalance(cfd.options.address),
            collateral,
            'cfd balance incorrect'
          )
        })

        it('initiates the contract on counterparty deposit()', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          assert.equal(await cfd.methods.buyer().call(), CREATOR_ACCOUNT, 'buyer incorrect')
          assert.equal(await cfd.methods.seller().call(), EMPTY_ACCOUNT, 'seller incorrect')

          const txReceipt = await deposit(cfd, COUNTERPARTY_ACCOUNT, notionalAmount.toFixed())

          // check party logged by CFDRegistry
          assertLoggedParty(
            txReceipt.events['2'].raw,
            cfd.options.address,
            COUNTERPARTY_ACCOUNT
          )

          // check cfd details
          await assertStatus(cfd, STATUS.INITIATED)
          assert.equal(
            await cfd.methods.seller().call(),
            COUNTERPARTY_ACCOUNT,
            'seller incorrect'
          )
          assert.equal(await cfd.methods.buyer().call(), CREATOR_ACCOUNT, 'buyer incorrect')
          assert.isTrue(await cfd.methods.initiated().call(), 'should be initiated')

          const expectedBalance = notionalAmount.times(2)
          assertEqualBN(
            await getBalance(cfd.options.address),
            expectedBalance,
            'cfd balance incorrect'
          )

          assert.equal(
            txReceipt.events.LogCFDInitiated.raw.topics[0],
            web3.utils.sha3(
              'LogCFDInitiated(address,uint256,address,address,bytes32,uint256,uint256,uint256,uint256)'
            ),
            'logged initiated: topic wrong'
          )
        })

        it('allows deposit with collateral exactly MINIMUM_COLLATERAL_PERCENT of the notional', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          await deposit(cfd, COUNTERPARTY_ACCOUNT, minimumCollateral.toFixed())
          await assertStatus(cfd, STATUS.INITIATED)
        })

        it('can cancel newly created contract before a deposit', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          assert.isFalse(await cfd.methods.initiated().call(), 'should not be initiated')
          assert.isFalse(await cfd.methods.closed().call(), 'should not be closed')

          await cfd.methods.cancelNew().send({ from: CREATOR_ACCOUNT })
          await assertStatus(cfd, STATUS.CLOSED)
          assert.isTrue(await cfd.methods.closed().call(), 'should be closed')
          assert.isFalse(await cfd.methods.initiated().call(), 'should not be initiated')
        })

        it('rejects create with collateral less then MINIMUM_COLLATERAL_PERCENT of the notional', async () => {
          const collateral = minimumCollateral.minus(1)
          try {
            await newCFD({ notionalAmount, isBuyer: true, daiValue: collateral })
            assert.fail('expected reject create with low collateral')
          } catch (err) {
            assert.equal(`${REJECT_MESSAGE} collateralInRange false`, err.message)
          }
        })

        it('rejects create with collateral more then MAXIMUM_COLLATERAL_PERCENT of the notional', async () => {
          const collateral = maximumCollateral.plus(1)
          try {
            await newCFD({ notionalAmount, isBuyer: true, daiValue: collateral })
            assert.fail('expected reject create with high collateral')
          } catch (err) {
            assert.equal(`${REJECT_MESSAGE} collateralInRange false`, err.message)
          }
        })

        it('rejects create with notional amount less then minimum', async () => {
          const notionalBelowMinimum = ONE_DAI.minus(1)
          const collateral = notionalBelowMinimum
          try {
            await newCFD({ notionalAmount: notionalBelowMinimum, isBuyer: true, daiValue: collateral })
            assert.fail('expected reject create with low notional')
          } catch (err) {
            assert.equal(`${REJECT_MESSAGE} Notional below minimum`, err.message)
          }
        })

        it('rejects deposit with collateral less then MINIMUM_COLLATERAL_PERCENT of the notional', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          try {
            const collateral = minimumCollateral.minus(1)
            await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral.toFixed())
            assert.fail('expected reject deposit with low collateral')
          } catch (err) {
            assert.equal(`${REJECT_MESSAGE} collateralInRange false`, err.message)
          }
        })

        it('rejects deposit with collateral more then MAXIMUM_COLLATERAL_PERCENT of the notional', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          try {
            const collateral = maximumCollateral.plus(1)
            await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral.toFixed())
            assert.fail('expected reject deposit with high collateral')
          } catch (err) {
            assert.equal(`${REJECT_MESSAGE} collateralInRange false`, err.message)
          }
        })

        it('rejects if market is not registered with price feeds', async () => {
          const badMarket = web3.utils.keccak256('Coinbase_No_Market')
          try {
            await newCFD({ market: badMarket, notionalAmount, isBuyer: true })
            assert.fail('expected reject for bad market')
          } catch (err) {
            assert.equal(`${REJECT_MESSAGE} Price requested for inactive or unknown market`, err.message)
          }
        })
      })

      describe('forceTerminate()', async () => {
        const penaltyPercent = new BigNumber('0.05') // 5%

        it('disolves contract and penalises terminator - 1x leverage price up', async () => {
          const collateral1X = notionalAmount
          const cfd = await newCFD({
            notionalAmount,
            isBuyer: true,
            daiValue: collateral1X
          })
          await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral1X.toFixed())

          // move the market price up before terminating
          const priceRise = 0.1 // 10%
          await priceFeedsInternal.methods.push(
            marketId,
            strikePriceAdjusted.times(1 + priceRise).toFixed(),
            nowSecs())
            .send(
              {
                from: DAEMON_ACCOUNT
              }
            )

          assert.isFalse(await cfd.methods.terminated().call())

          const creatorBalBefore = await getBalance(CREATOR_ACCOUNT)
          const cpBalBefore = await getBalance(COUNTERPARTY_ACCOUNT)

          await cfd.methods.forceTerminate().send({
            from: CREATOR_ACCOUNT
          })

          await assertStatus(cfd, STATUS.CLOSED)
          assert.isTrue(await cfd.methods.closed().call())
          assert.isTrue(await cfd.methods.terminated().call())

          const terminatorBaseCollateral = collateral1X.times(1 + priceRise)
          const terminationFee = terminatorBaseCollateral.times(penaltyPercent)
          assertEqualBN(
            await getBalance(CREATOR_ACCOUNT),
            creatorBalBefore
              .plus(terminatorBaseCollateral.minus(terminationFee)),
            'creator balance incorrect'
          )
          assertEqualBN(
            await getBalance(COUNTERPARTY_ACCOUNT),
            cpBalBefore.plus(collateral1X.times(1 - priceRise).plus(terminationFee)),
            'counterparty balance incorrect'
          )
          assertEqualBN(
            await getBalance(cfd.options.address),
            0,
            'cfd balance should be 0'
          )
        })

        it('disolves contract and penalises terminator - 5x leverage price down', async () => {
          const leverage = 5
          const collateral5X = minimumCollateral

          const cfd = await newCFD({
            notionalAmount,
            isBuyer: true,
            daiValue: collateral5X
          })
          await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral5X.toFixed())

          // move the market price up before terminating
          const priceFall = 0.1 // 10%
          await priceFeedsInternal.methods.push(
            marketId,
            strikePriceAdjusted.times(1 - priceFall).toFixed(),
            nowSecs())
            .send(
              {
                from: DAEMON_ACCOUNT
              }
            )

          assert.isFalse(await cfd.methods.terminated().call())

          const creatorBalBefore = await getBalance(CREATOR_ACCOUNT)
          const cpBalBefore = await getBalance(COUNTERPARTY_ACCOUNT)

          await cfd.methods.forceTerminate().send({
            from: CREATOR_ACCOUNT
          })

          await assertStatus(cfd, STATUS.CLOSED)
          assert.isTrue(await cfd.methods.closed().call())
          assert.isTrue(await cfd.methods.terminated().call())

          const difference = leverage * priceFall
          const terminatorBaseCollateral = collateral5X.times(1 - difference)
          const terminationFee = terminatorBaseCollateral.times(penaltyPercent)
          assertEqualBN(
            await getBalance(CREATOR_ACCOUNT),
            creatorBalBefore
              .plus(terminatorBaseCollateral.minus(terminationFee)),
            'creator balance incorrect'
          )
          assertEqualBN(
            await getBalance(COUNTERPARTY_ACCOUNT),
            cpBalBefore.plus(
              collateral5X.times(1 + difference).plus(terminationFee)
            ),
            'counterparty balance incorrect'
          )
          assertEqualBN(
            await getBalance(cfd.options.address),
            0,
            'cfd balance should be 0'
          )
        })

        it('disolves contract and penalises terminator - after seller side has been sold', async () => {
          const buyer = accounts[9]
          const seller = COUNTERPARTY_ACCOUNT
          const buyingParty = accounts[5]

          const collateral1X = notionalAmount

          const cfd = await newCFD({
            creator: buyer,
            notionalAmount,
            isBuyer: true,
            daiValue: collateral1X
          })
          await deposit(cfd, seller, collateral1X.toFixed())
          await cfd.methods.sellPrepare(strikePriceAdjusted.toFixed(), 0).send({ from: seller })
          await buy(cfd, buyingParty, false, collateral1X.toFixed())

          // buyer teminates
          await cfd.methods.forceTerminate().send({
            from: buyer
          })

          await assertStatus(cfd, STATUS.CLOSED)
          assert.isTrue(await cfd.methods.closed().call())
          assert.isTrue(await cfd.methods.terminated().call())

          // TODO: The following 2 assertions fail when all tests are run
          //   simultaneously but pass when run alone. I can't see why yet:

          // assertEqualBN(
          //   await getBalance(buyer),
          //   buyerBalBefore
          //     .plus(collateral1X.times(ONE_BN.minus(penaltyPercent))),
          //   'buyer balance'
          // )
          // assertEqualBN(
          //   await getBalance(buyingParty),
          //   buyingPartyBalBefore.plus(
          //     collateral1X.times(ONE_BN.plus(penaltyPercent))
          //   ),
          //   'buying party balance'
          // )
          assertEqualBN(
            await getBalance(cfd.options.address),
            0,
            'cfd balance should be 0'
          )
        })
      })

      describe('transferPosition()', async () => {
        const TRANSFER_TO_GUY = accounts[7]

        it('transfers seller side ownership', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          await deposit(cfd, COUNTERPARTY_ACCOUNT, notionalAmount.toFixed())
          assert.equal(
            await cfd.methods.seller().call(),
            COUNTERPARTY_ACCOUNT,
            'seller incorrect'
          )
          assert.equal(await cfd.methods.buyer().call(), CREATOR_ACCOUNT, 'buyer incorrect')

          const txReceipt = await cfd.methods.transferPosition(TRANSFER_TO_GUY).send({
            from: COUNTERPARTY_ACCOUNT,
            gas: 50000
          })

          // check party logged by CFDRegistry
          assertLoggedParty(txReceipt.events['0'].raw, cfd.options.address, TRANSFER_TO_GUY)

          assert.equal(await cfd.methods.seller().call(), TRANSFER_TO_GUY, 'seller incorrect')
          assert.equal(await cfd.methods.buyer().call(), CREATOR_ACCOUNT, 'buyer incorrect')
        })

        it('transfers buyer side ownership', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          await deposit(cfd, COUNTERPARTY_ACCOUNT, notionalAmount.toFixed())
          assert.equal(
            await cfd.methods.seller().call(),
            COUNTERPARTY_ACCOUNT,
            'seller incorrect'
          )
          assert.equal(await cfd.methods.buyer().call(), CREATOR_ACCOUNT, 'buyer incorrect')

          const txReceipt = await cfd.methods.transferPosition(TRANSFER_TO_GUY).send({
            from: CREATOR_ACCOUNT
          })

          // check party logged by CFDRegistry
          assertLoggedParty(txReceipt.events['0'].raw, cfd.options.address, TRANSFER_TO_GUY)

          assert.equal(
            await cfd.methods.seller().call(),
            COUNTERPARTY_ACCOUNT,
            'seller incorrect'
          )
          assert.equal(await cfd.methods.buyer().call(), TRANSFER_TO_GUY, 'buyer incorrect')
        })

        it('can transfer before initiated (before a counterparty via deposit())', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          const txReceipt = await cfd.methods.transferPosition(TRANSFER_TO_GUY).send({
            from: CREATOR_ACCOUNT
          })
          // check party logged by CFDRegistry
          assertLoggedParty(txReceipt.events['0'].raw, cfd.options.address, TRANSFER_TO_GUY)
          assert.equal(await cfd.methods.buyer().call(), TRANSFER_TO_GUY, 'buyer incorrect')
          assert.equal(await cfd.methods.seller().call(), EMPTY_ACCOUNT, 'not empty')
        })

        it("can't transfer to one of the 2 contract parties", async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          await deposit(cfd, COUNTERPARTY_ACCOUNT, notionalAmount.toFixed())

          const assertFailure = async (to, from) => {
            try {
              await cfd.methods.transferPosition(to).send({
                from: from
              })
              assert.fail('expected reject transfering to existing party')
            } catch (err) {
              assert.equal(`${REJECT_MESSAGE} Contract party can't call this`, err.message)
            }
          }

          await assertFailure(COUNTERPARTY_ACCOUNT, COUNTERPARTY_ACCOUNT)
          await assertFailure(COUNTERPARTY_ACCOUNT, CREATOR_ACCOUNT)
          await assertFailure(CREATOR_ACCOUNT, CREATOR_ACCOUNT)
          await assertFailure(CREATOR_ACCOUNT, COUNTERPARTY_ACCOUNT)
        })
      })

      describe('liquidation via threshold reached - call liquidate()', async () => {
        // #11 ensures the contract does not disolve if the daemon is wrong for
        // some reason about the liquidate threshold being reached
        it('rejects the update if called and the threshold has not been reached', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          await deposit(cfd, COUNTERPARTY_ACCOUNT, notionalAmount.toFixed())

          const newStrikePrice = strikePriceAdjusted.times(1.1) // not enough to hit liquidate threshold
          await priceFeedsInternal.methods.push(marketId, newStrikePrice.toFixed(), nowSecs()).send({
            from: DAEMON_ACCOUNT
          })

          try {
            await cfd.methods.liquidate().send({
              from: DAEMON_ACCOUNT,
              gas: 200000
            })
            assert.fail('expected reject of update by CFD.liquidate')
          } catch (err) {
            assert.equal(`${REJECT_MESSAGE} Liquidate threshold not yet reached`, err.message)
          }
        })

        it('disolves the contract - 1x leverage both sides, price rise - INTERNAL price feed', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          await deposit(cfd, COUNTERPARTY_ACCOUNT, notionalAmount.toFixed())

          // 5% threshold passed for seller
          const newStrikePrice = strikePriceAdjusted.times(1.951)
          await priceFeedsInternal.methods.push(marketId, newStrikePrice.toFixed(), nowSecs()).send({
            from: DAEMON_ACCOUNT
          })

          const cfdBalance = await getBalance(cfd.options.address)
          const creatorBalBefore = await getBalance(CREATOR_ACCOUNT)
          const cpBalBefore = await getBalance(COUNTERPARTY_ACCOUNT)

          await cfd.methods.liquidate().send({
            from: DAEMON_ACCOUNT,
            gas: 200000
          })

          await assertStatus(cfd, STATUS.CLOSED)
          assert.isTrue(await cfd.methods.closed().call())
          assert.isFalse(await cfd.methods.terminated().call())

          // full cfd balance transferred
          assertEqualBN(
            await getBalance(CREATOR_ACCOUNT),
            creatorBalBefore.plus(cfdBalance),
            'buyer should have full balance transferred'
          )
          // unchanged
          assertEqualBN(
            await getBalance(COUNTERPARTY_ACCOUNT),
            cpBalBefore,
            'seller balance should be unchanged'
          )
        })

        it('disolves the contract - 1x leverage both sides, price rise - EXTERNAL price feed', async () => {
          // push price onto the mock maker price feed contract
          const makerEthPrice = '211.99'
          const makerEthPriceAdjusted = toContractBigNumber(makerEthPrice)
          await mockMakerPut(ethUsdMaker, makerEthPrice)

          const cfd = await newCFD({
            notionalAmount,
            isBuyer: true,
            market: markets[marketNames.makerEthPrice],
            strikePrice: makerEthPriceAdjusted
          })
          await deposit(cfd, COUNTERPARTY_ACCOUNT, notionalAmount.toFixed())

          // 5% threshold passed for seller
          const newMarketPrice = makerEthPriceAdjusted.times(1.951)
          await mockMakerPut(ethUsdMaker, newMarketPrice)

          const cfdBalance = await getBalance(cfd.options.address)
          const creatorBalBefore = await getBalance(CREATOR_ACCOUNT)
          const cpBalBefore = await getBalance(COUNTERPARTY_ACCOUNT)

          await cfd.methods.liquidate().send({
            from: DAEMON_ACCOUNT,
            gas: 200000
          })

          await assertStatus(cfd, STATUS.CLOSED)
          assert.isTrue(await cfd.methods.closed().call())
          assert.isFalse(await cfd.methods.terminated().call())

          // full cfd balance transferred
          assertEqualBN(
            await getBalance(CREATOR_ACCOUNT),
            creatorBalBefore.plus(cfdBalance),
            'buyer should have full balance transferred'
          )
          // unchanged
          assertEqualBN(
            await getBalance(COUNTERPARTY_ACCOUNT),
            cpBalBefore,
            'seller balance should be unchanged'
          )
        })

        it('disolves the contract - 5x leverage both sides, price rise', async () => {
          const collateral5X = minimumCollateral

          const cfd = await newCFD({
            notionalAmount,
            isBuyer: true,
            daiValue: collateral5X
          })
          await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral5X.toFixed())

          // 5% threshold passed for seller at 5X - get cutoff price then add 1
          const sellerCutOffPrice = cutOffPrice({
            strikePrice: strikePriceAdjusted,
            notionalAmount,
            depositBalance: collateral5X,
            isBuyer: false
          })
          const newStrikePrice = sellerCutOffPrice.plus(1)
          await priceFeedsInternal.methods.push(marketId, newStrikePrice.toFixed(), nowSecs()).send({
            from: DAEMON_ACCOUNT
          })

          const cfdBalance = await getBalance(cfd.options.address)
          const creatorBalBefore = await getBalance(CREATOR_ACCOUNT)
          const cpBalBefore = await getBalance(COUNTERPARTY_ACCOUNT)

          await cfd.methods.liquidate().send({
            from: DAEMON_ACCOUNT,
            gas: 200000
          })

          await assertStatus(cfd, STATUS.CLOSED)
          assert.isTrue(await cfd.methods.closed().call())
          assert.isFalse(await cfd.methods.terminated().call())

          // full cfd balance transferred
          assertEqualBN(
            await getBalance(CREATOR_ACCOUNT),
            creatorBalBefore.plus(cfdBalance),
            'buyer should have full balance transferred'
          )
          // unchanged
          assertEqualBN(
            await getBalance(COUNTERPARTY_ACCOUNT),
            cpBalBefore,
            'seller balance should be unchanged'
          )
        })

        it('disolves the contract - 5x leverage both sides, price falls', async () => {
          const collateral5X = minimumCollateral

          const cfd = await newCFD({
            notionalAmount,
            isBuyer: true,
            daiValue: collateral5X
          })
          await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral5X.toFixed())

          // under 5% threshold
          const newStrikePrice = strikePriceAdjusted.times(0.04)
          await priceFeedsInternal.methods.push(marketId, newStrikePrice.toFixed(), nowSecs()).send({
            from: DAEMON_ACCOUNT
          })

          const cfdBalance = await getBalance(cfd.options.address)
          const creatorBalBefore = await getBalance(CREATOR_ACCOUNT)
          const cpBalBefore = await getBalance(COUNTERPARTY_ACCOUNT)

          await cfd.methods.liquidate().send({
            from: DAEMON_ACCOUNT,
            gas: 200000
          })

          await assertStatus(cfd, STATUS.CLOSED)
          assert.isTrue(await cfd.methods.closed().call())
          assert.isFalse(await cfd.methods.terminated().call())

          // unchanged
          assertEqualBN(
            await getBalance(CREATOR_ACCOUNT),
            creatorBalBefore,
            'buyer balance should be unchanged'
          )
          assertEqualBN(
            await getBalance(COUNTERPARTY_ACCOUNT),
            cpBalBefore.plus(cfdBalance),
            'seller should have full balance transferred'
          )
        })
      })

      describe('liquidation via liquidateMutual()', async () => {
        it('succeeds when both parties call', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          await deposit(cfd, COUNTERPARTY_ACCOUNT, notionalAmount.toFixed())

          await cfd.methods.liquidateMutual().send({
            from: CREATOR_ACCOUNT
          })
          assertEqualAddress(
            CREATOR_ACCOUNT,
            await cfd.methods.liquidateMutualCalledBy().call(),
            'liquidate caller marked'
          )

          await cfd.methods.liquidateMutual().send({
            from: COUNTERPARTY_ACCOUNT
          })
          await assertStatus(cfd, STATUS.CLOSED)
          assert.isTrue(await cfd.methods.liquidatedMutually().call())
        })

        it('first caller can reverse intent to liquidate', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          await deposit(cfd, COUNTERPARTY_ACCOUNT, notionalAmount.toFixed())
          await cfd.methods.liquidateMutual().send({
            from: CREATOR_ACCOUNT
          })
          assertEqualAddress(
            CREATOR_ACCOUNT,
            await cfd.methods.liquidateMutualCalledBy().call(),
            'liquidate caller marked'
          )

          await cfd.methods.liquidateMutualCancel().send({
            from: CREATOR_ACCOUNT
          })
          assertEqualAddress(
            EMPTY_ACCOUNT,
            await cfd.methods.liquidateMutualCalledBy().call(),
            'liquidate caller back to 0x0'
          )
        })
      })

      describe('price movement calculations', async () => {
        it('percentOf() calculates percentage of an amount', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          assertEqualBN(await cfd.methods.percentOf(1000, 1).call(), new BigNumber('10'))
          assertEqualBN(await cfd.methods.percentOf(1000, 10).call(), new BigNumber('100'))
          assertEqualBN(
            await cfd.methods.percentOf(1000, 200).call(),
            new BigNumber('2000')
          )
        })

        it('percentChange() calculates percentage change of 2 amounts', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          assertEqualBN(
            await cfd.methods.percentChange(10000, 9000).call(),
            new BigNumber('10')
          )
          assertEqualBN(
            await cfd.methods.percentChange(10000, 11000).call(),
            new BigNumber('10')
          )
          assertEqualBN(
            await cfd.methods.percentChange(10000, 10).call(),
            new BigNumber('99')
          )
        })

        it('changeInDai() calculates value change based on new price', async () => {
          const price = toContractBigNumber('100')
          const amount = ONE_DAI
          const cfd = await newCFD({
            notionalAmount: amount,
            isBuyer: true,
            strikePrice: price.toFixed()
          })

          const assertChange = async (newPrice, expected) =>
            assertEqualBN(
              await cfd.methods.changeInDai(price.toFixed(), newPrice.toFixed(), amount.toFixed()).call(),
              expected
            )

          // price down 10% / change amount 10%
          await assertChange(price.times(0.9), amount.times(0.1))
          // price up 10% / change amount 10%
          await assertChange(price.times(1.1), amount.times(0.1))
          // price up 500% / change amount 400%
          await assertChange(price.times(5), amount.times(4))
          // price down 99% / change amount 99%
          await assertChange(price.times(0.01), amount.times(0.99))
          // price unchanged
          await assertChange(price, 0)
        })
      })

      describe('cutOffPrice()', async () => {
        it('calculates dynamic percentage correctly for each side', async () => {
          const notional = ONE_DAI.times(10)
          const strikePrice = toContractBigNumber('1000')

          const cfd = await newCFD({
            isBuyer: true,
            notionalAmount: notional,
            strikePrice
          })

          const assertCutOffPrice = async ({ leverage, buyerSide, msg }) => {
            const deposits = notional.dividedBy(leverage)
            const expected = cutOffPrice({
              notionalAmount: notional,
              depositBalance: deposits,
              strikePrice,
              buyerSide
            })
            assertEqualBN(
              await cfd.methods.cutOffPrice(notional.toFixed(), deposits.toFixed(), strikePrice.toFixed(), buyerSide).call(),
              expected,
              msg
            )
          }

          // buyer
          await assertCutOffPrice({ leverage: 1, buyerSide: true, msg: 'buyer 1X' })
          await assertCutOffPrice({ leverage: 4, buyerSide: true, msg: 'buyer 4X' })
          await assertCutOffPrice({ leverage: 5, buyerSide: true, msg: 'buyer 5X' })

          // seller
          await assertCutOffPrice({ leverage: 1, buyerSide: false, msg: 'seller 1X' })
          await assertCutOffPrice({ leverage: 4, buyerSide: false, msg: 'seller 4X' })
          await assertCutOffPrice({ leverage: 5, buyerSide: false, msg: 'seller 5X' })

          // leverages < 1
          await assertCutOffPrice({
            leverage: 0.5,
            buyerSide: true,
            msg: 'buyer 0.5X'
          })
          await assertCutOffPrice({
            leverage: 0.5,
            buyerSide: false,
            msg: 'seller 0.5X'
          })
        })
      })

      describe('calculateCollateralAmount()', async () => {
        let defaultInitialStrikePrice
        let defaultNotional = notionalAmount
        let defaultCFD

        const assertCollateral = async ({
          cfd = defaultCFD,
          strikePrice = defaultInitialStrikePrice,
          marketPrice,
          deposits,
          isBuyer,
          expected
        }) => {
          const collateral = await cfd.methods.calculateCollateralAmount(
            strikePrice.toFixed(),
            marketPrice.toFixed(),
            await cfd.methods.notionalAmountDai().call(),
            deposits.toFixed(),
            isBuyer
          ).call()
          assertEqualBN(collateral, expected)
        }

        before(async () => {
          // setup a default CFD for some of the test cases
          defaultInitialStrikePrice = toContractBigNumber('1000')
          defaultNotional = notionalAmount
          defaultCFD = await newCFD({
            strikePrice: defaultInitialStrikePrice,
            notionalAmount: defaultNotional,
            isBuyer: true
          })
        })

        const adjustPrice = ({ price = defaultInitialStrikePrice, by }) => {
          return price.plus(price.times(new BigNumber(by)))
        }

        it('buyer and seller 1x leverage and price goes up', async () => {
          const priceMovement = '0.1'
          const newPrice = adjustPrice({ by: priceMovement })
          await assertCollateral({
            marketPrice: newPrice,
            deposits: notionalAmount, // 1x
            expected: notionalAmount.times(ONE_BN.plus(priceMovement)),
            isBuyer: true
          })
          await assertCollateral({
            marketPrice: newPrice,
            deposits: notionalAmount, // 1x
            expected: notionalAmount.times(ONE_BN.minus(priceMovement)),
            isBuyer: false
          })
        })

        it('buyer and seller 1x leverage and price goes down', async () => {
          const priceMovement = '-0.1'
          const newPrice = adjustPrice({ by: priceMovement })
          await assertCollateral({
            marketPrice: newPrice,
            deposits: notionalAmount, // 1x
            expected: notionalAmount.times(ONE_BN.plus(priceMovement)),
            isBuyer: true
          })
          await assertCollateral({
            marketPrice: newPrice,
            deposits: notionalAmount, // 1x
            expected: notionalAmount.times(ONE_BN.minus(priceMovement)),
            isBuyer: false
          })
        })

        it('buyer and seller 5x leverage and price goes up', async () => {
          const leverage = 5
          const priceMovement = new BigNumber('0.1')
          const newPrice = adjustPrice({ by: priceMovement })
          const depositsAt5X = notionalAmount.dividedBy(leverage)
          await assertCollateral({
            marketPrice: newPrice,
            deposits: depositsAt5X,
            expected: depositsAt5X.times(ONE_BN.plus(priceMovement.times(leverage))),
            isBuyer: true
          })
          await assertCollateral({
            marketPrice: newPrice,
            deposits: depositsAt5X,
            expected: depositsAt5X.times(
              ONE_BN.minus(priceMovement.times(leverage))
            ),
            isBuyer: false
          })
        })

        it('buyer and seller 5x leverage and price goes down', async () => {
          const leverage = 5
          const priceMovement = new BigNumber('-0.1')
          const newPrice = adjustPrice({ by: priceMovement })
          const depositsAt5X = notionalAmount.dividedBy(leverage)
          await assertCollateral({
            marketPrice: newPrice,
            deposits: depositsAt5X,
            expected: depositsAt5X.times(ONE_BN.plus(priceMovement.times(leverage))),
            isBuyer: true
          })
          await assertCollateral({
            marketPrice: newPrice,
            deposits: depositsAt5X,
            expected: depositsAt5X.times(
              ONE_BN.minus(priceMovement.times(leverage))
            ),
            isBuyer: false
          })
        })

        it('buyer at 1x and seller at 5x leverage and price goes up', async () => {
          const leverageBuyer = 1
          const leverageSeller = 5

          const depositsBuyer = notionalAmount.dividedBy(leverageBuyer)
          const depositsSeller = notionalAmount.dividedBy(leverageSeller)

          const priceMovement = new BigNumber('0.03')
          const newPrice = adjustPrice({ by: priceMovement })

          const expectedBuyerCollateral = depositsBuyer.times(
            ONE_BN.plus(priceMovement.times(leverageBuyer))
          )
          const expectedSellerCollateral = depositsSeller.times(
            ONE_BN.minus(priceMovement.times(leverageSeller))
          )

          await assertCollateral({
            marketPrice: newPrice,
            deposits: depositsBuyer,
            expected: expectedBuyerCollateral,
            isBuyer: true
          })

          await assertCollateral({
            marketPrice: newPrice,
            deposits: depositsSeller,
            expected: expectedSellerCollateral,
            isBuyer: false
          })
        })
      })

      describe('calculateNewNotional', async () => {
        let cfd

        before(async () => {
          cfd = await newCFD({ notionalAmount, isBuyer: true })
        })

        it('calculates the new notional correctly', async () => {
          assertEqualBN(
            await cfd.methods.calculateNewNotional(
              notionalAmount.toFixed(),
              strikePriceAdjusted.toFixed(),
              strikePriceAdjusted.times(2).toFixed()
            ).call(),
            notionalAmount.times(2)
          )
          assertEqualBN(
            await cfd.methods.calculateNewNotional(
              notionalAmount.toFixed(),
              strikePriceAdjusted.toFixed(),
              strikePriceAdjusted.times(0.5).toFixed()
            ).call(),
            notionalAmount.times(0.5)
          )
        })
      })

      describe('sale', async () => {
        const buyer = CREATOR_ACCOUNT
        const seller = COUNTERPARTY_ACCOUNT
        const buyingParty = accounts[5]

        before(async () => {
          // push in the original strike price (in case another test has changed it)
          await priceFeedsInternal.methods.push(marketId, strikePriceAdjusted.toFixed(), nowSecs()).send({
            from: DAEMON_ACCOUNT
          })
        })

        it(
          `view functions isBuyerSelling, isSellerSelling, isSelling ` +
          `work correctly`,
          async () => {
            // initiate contract
            const cfd = await newCFD({ notionalAmount, isBuyer: true })
            await deposit(cfd, seller, notionalAmount.toFixed())
            // put seller side on sale
            await cfd.methods.sellPrepare(strikePriceAdjusted.toFixed(), 0).send({ from: seller })

            await assertStatus(cfd, STATUS.SALE)

            assert.isTrue(await cfd.methods.sellerSelling().call(), 'isSellerSelling true')
            assert.isFalse(await cfd.methods.buyerSelling().call(), 'isBuyerSelling false')

            assert.isTrue(await cfd.methods.isSellerSelling().call(), 'isSellerSelling true')
            assert.isFalse(await cfd.methods.isBuyerSelling().call(), 'isBuyerSelling false')

            assert.isTrue(
              await cfd.methods.isSelling(seller).call(),
              'isSelling(seller) true'
            )
            assert.isFalse(
              await cfd.methods.isSelling(buyer).call(),
              'isSelling(buyer) false'
            )
          }
        )

        //
        // Summary:
        //  - seller at 1X puts side on sale
        //  - a buyer comes along and buys that side with 2x leverage
        //  - seller gets back full collateral
        //
        it('a buyer buys the "on sale" position with enough collateral - 2X', async () => {
          // initiate contract
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          await deposit(cfd, seller, notionalAmount.toFixed())
          // put seller side on sale
          await cfd.methods.sellPrepare(strikePriceAdjusted.toFixed(), 0).send({ from: seller })
          await assertStatus(cfd, STATUS.SALE)

          // assert sale details in the contract
          assertEqualBN(await cfd.methods.sellerSaleStrikePrice().call(), strikePriceAdjusted)
          assert.equal(await cfd.methods.sellerSaleTimeLimit().call(), 0)
          assert.isTrue(await cfd.methods.isSellerSelling().call(), 'isSellerSelling true')

          // save balances
          const buyerBalBefore = await getBalance(buyer)
          const sellerBalBefore = await getBalance(seller)
          const buyingPartyBalBefore = await getBalance(buyingParty)

          // buyingParty buys the seller side
          const collateral = notionalAmount.dividedBy(2) // 2X leverage
          const buyBuyerSide = false // buying seller side
          const buyTx = await buy(cfd, buyingParty, buyBuyerSide, collateral.toFixed())

          // check new party logged by CFDRegistry
          assertLoggedParty(buyTx.events['3'].raw, cfd.options.address, buyingParty)

          // check the contract has been updated
          assert.equal(await cfd.methods.seller().call(), buyingParty)
          assert.equal(await cfd.methods.buyer().call(), buyer) // unchanged

          // all notionals unchanged as the strike price hasn't changed:
          assertEqualBN(await cfd.methods.notionalAmountDai().call(), notionalAmount)
          assertEqualBN(await cfd.methods.notionalAmountDai().call(), notionalAmount)
          assertEqualBN(await cfd.methods.buyerInitialNotional().call(), notionalAmount)

          // all strike prices unchanged as the strike price hasn't changed:
          assertEqualBN(await cfd.methods.strikePrice().call(), strikePriceAdjusted)
          assertEqualBN(
            await cfd.methods.sellerInitialStrikePrice().call(),
            strikePriceAdjusted
          )
          assertEqualBN(
            await cfd.methods.buyerInitialStrikePrice().call(),
            strikePriceAdjusted
          ) // unchanged

          assertEqualBN(
            await cfd.methods.sellerDepositBalance().call(),
            collateral,
            'sellerDepositBalance'
          )
          assertEqualBN(
            await cfd.methods.buyerDepositBalance().call(),
            notionalAmount,
            'buyerDepositBalance'
          ) // unchanged

          // sale details all reset
          assert.isFalse(await cfd.methods.buyerSelling().call(), 'buyerSelling false')
          assert.isFalse(await cfd.methods.sellerSelling().call(), 'sellerSelling false')
          assert.equal(
            await cfd.methods.sellerSaleTimeLimit().call(),
            0,
            'sellerSaleTimeLimit = 0'
          )
          assert.equal(
            await cfd.methods.sellerSaleStrikePrice().call(),
            0,
            'sellerSaleStrikePrice = 0'
          )

          // check balances of all 3 parties
          assertEqualBN(await getBalance(buyer), buyerBalBefore, 'buyer balance') // unchanged
          assertEqualBN(
            await getBalance(seller),
            sellerBalBefore.plus(notionalAmount),
            'seller balance'
          )
          assertEqualBN(
            await getBalance(buyingParty),
            buyingPartyBalBefore
              .minus(collateral),
            'buyingParty balance'
          )

          // check balance of cfd includes both deposits
          assertEqualBN(
            await getBalance(cfd.options.address),
            notionalAmount.plus(collateral),
            'new cfd balance'
          )
        })

        //
        // Summary:
        //  - buyer at 1X puts side on sale at a strike price 20% above
        //  - a buyer comes along and buys that side
        //  - new notional amount is set
        //
        it('new notional correct when buyer sells at 20% higher strike price', async () => {
          // initiate contract
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          await deposit(cfd, seller, notionalAmount.toFixed())
          // put seller side on sale
          const saleStrikePrice = strikePriceAdjusted.times(1.2)
          await cfd.methods.sellPrepare(saleStrikePrice.toFixed(), 0).send({ from: buyer })
          await assertStatus(cfd, STATUS.SALE)

          // assert sale details in the contract
          assertEqualBN(await cfd.methods.buyerSaleStrikePrice().call(), saleStrikePrice)

          // buyingParty buys the seller side
          const buyBuyerSide = true
          await buy(cfd, buyingParty, buyBuyerSide, notionalAmount.toFixed())

          const expectedNewNotional = notionalAmount.times(1.2)
          assertEqualBN(
            await cfd.methods.notionalAmountDai().call(),
            expectedNewNotional,
            'new notional'
          )
          assertEqualBN(
            await cfd.methods.buyerInitialNotional().call(),
            expectedNewNotional,
            'buyer initial notional same as new notional'
          )
          assertEqualBN(
            await cfd.methods.sellerInitialNotional().call(),
            notionalAmount,
            'seller initial notional unchanged'
          ) // unchanged
        })

        //
        // Summary:
        //  - seller at 1X puts side on sale at a strike price 20% below
        //  - a buyer comes along and buys that side
        //  - new notional amount is set
        //
        it('new notional correct when seller sells at 20% lower strike price', async () => {
          // initiate contract
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          await deposit(cfd, seller, notionalAmount.toFixed())
          // put seller side on sale
          const saleStrikePrice = strikePriceAdjusted.times(0.8)
          await cfd.methods.sellPrepare(saleStrikePrice.toFixed(), 0).send({ from: seller })
          await assertStatus(cfd, STATUS.SALE)

          // assert sale details in the contract
          assertEqualBN(await cfd.methods.sellerSaleStrikePrice().call(), saleStrikePrice)

          // buyingParty buys the seller side
          const buyBuyerSide = false // buying seller side
          await buy(cfd, buyingParty, buyBuyerSide, notionalAmount.toFixed())

          const expectedNewNotional = notionalAmount.times(0.8)
          assertEqualBN(
            await cfd.methods.notionalAmountDai().call(),
            expectedNewNotional,
            'new notional'
          )
          assertEqualBN(
            await cfd.methods.sellerInitialNotional().call(),
            expectedNewNotional,
            'seller initial notional same as new notional'
          )
          assertEqualBN(
            await cfd.methods.buyerInitialNotional().call(),
            notionalAmount,
            'buyer initial notional unchanged'
          ) // unchanged
        })

        //
        // Summary:
        //  - a buyer in at 1X puts side on sale at price 10% more
        //  - a seller in at 2X puts side on sale at price 20% more
        //  - a new buyer buys the buyer side at 2x collateral
        //  - a new buyer buys the seller side at 4x collateral
        //  - assert the selling parties receive collateral amounts
        //  - assert CFD values are all correct after the sales
        //
        it('both sides can be on sale at once with different terms', async () => {
          const buyBuyerSide = true
          const collateral1X = notionalAmount
          const collateral2X = notionalAmount.dividedBy(2)

          // initiate contract
          const cfd = await newCFD({ notionalAmount, isBuyer: true }) // defaults to 1X
          await deposit(cfd, seller, collateral2X.toFixed())
          // buyer side put on sale
          const buyerDesiredPrice = strikePriceAdjusted.times(1.1)
          await cfd.methods.sellPrepare(buyerDesiredPrice.toFixed(), 0).send({ from: buyer })
          assert.isTrue(await cfd.methods.buyerSelling().call())

          // seller side put on sale
          const sellerDesiredPrice = strikePriceAdjusted.times(1.2)
          await cfd.methods.sellPrepare(sellerDesiredPrice.toFixed(), 0).send({ from: seller })
          assert.isTrue(await cfd.methods.sellerSelling().call())

          // buying parties
          const buyingParty1 = buyingParty
          const buyingParty2 = accounts[9]

          // save balances
          const buyerBalBefore = await getBalance(buyer)
          const sellerBalBefore = await getBalance(seller)
          const buyingParty1BalBefore = await getBalance(buyingParty1)
          const buyingParty2BalBefore = await getBalance(buyingParty2)

          //
          // Buyer side buy
          //
          const buyerSideCollateralAtSale = calculateCollateral({
            strikePrice: strikePriceAdjusted,
            marketPrice: buyerDesiredPrice,
            notionalAmount,
            depositBalance: collateral1X,
            calcBuyerSide: true
          })

          const buy1Tx = await buy(cfd, buyingParty1, buyBuyerSide, collateral2X.toFixed())

          // check the state
          assert.equal(await cfd.methods.buyer().call(), buyingParty1)
          assertLoggedParty(buy1Tx.events['3'].raw, cfd.options.address, buyingParty1)
          assertEqualBN(await cfd.methods.strikePrice().call(), buyerDesiredPrice)
          assertEqualBN(await cfd.methods.buyerInitialStrikePrice().call(), buyerDesiredPrice)
          assertEqualBN(
            await cfd.methods.buyerDepositBalance().call(),
            collateral2X,
            'buyer deposits balance after buyer buy'
          )
          assertEqualBN(
            await cfd.methods.sellerDepositBalance().call(),
            (await getBalance(cfd.options.address)).minus(collateral2X),
            'seller deposits balance after buyer buy'
          )
          assertEqualBN(
            await getBalance(buyer),
            buyerBalBefore.plus(buyerSideCollateralAtSale),
            'buyer balance has collateral from sale'
          )

          const newNotional = calculateNewNotional({
            oldNotional: notionalAmount,
            oldStrikePrice: strikePriceAdjusted,
            newStrikePrice: buyerDesiredPrice
          })
          const expectedNewNotional = notionalAmount.times(
            buyerDesiredPrice.dividedBy(strikePriceAdjusted)
          )
          assertEqualBN(newNotional, expectedNewNotional, 'new notional')

          //
          // Seller side buy
          //
          const sellerSideCollateralAtSale = calculateCollateral({
            strikePrice: await cfd.methods.strikePrice().call(),
            marketPrice: sellerDesiredPrice,
            notionalAmount: newNotional,
            depositBalance: await cfd.methods.sellerDepositBalance().call(),
            calcBuyerSide: false
          })

          const collateral4XBuy2 = newNotional.dividedBy(4)
          const buy2Tx = await buy(cfd, buyingParty2, !buyBuyerSide, collateral4XBuy2.toFixed())

          // check the state
          assert.equal(await cfd.methods.seller().call(), buyingParty2)
          assertLoggedParty(buy2Tx.events['3'].raw, cfd.options.address, buyingParty2)
          assertEqualBN(await cfd.methods.strikePrice().call(), sellerDesiredPrice)
          assertEqualBN(
            await cfd.methods.sellerInitialStrikePrice().call(),
            sellerDesiredPrice
          )

          assertEqualBN(
            await cfd.methods.sellerDepositBalance().call(),
            collateral4XBuy2,
            'seller deposits balance after seller buy'
          )

          // check balances of all parties
          assertEqualBN(
            await getBalance(seller),
            sellerBalBefore.plus(
              sellerSideCollateralAtSale.dividedToIntegerBy(1).plus(1) // truncated and rounded up 1
            ),
            'seller balance has collateral from sale'
          )

          assertEqualBN(
            await getBalance(buyingParty1),
            buyingParty1BalBefore
              .minus(collateral2X),
            'buyingParty1 balance'
          )
          assertEqualBN(
            await getBalance(buyingParty2),
            buyingParty2BalBefore
              .minus(collateral4XBuy2),
            'buyingParty2 balance'
          )

          // check balance of cfd includes both new deposits plus a single read fee
          assertEqualBN(
            await getBalance(cfd.options.address),
            collateral4XBuy2.plus(await cfd.methods.buyerDepositBalance().call()),
            'new cfd balance'
          )

          // sale details all reset
          assert.isFalse(await cfd.methods.buyerSelling().call())
          assert.equal(await cfd.methods.buyerSaleTimeLimit().call(), 0)
          assert.equal(await cfd.methods.buyerSaleStrikePrice().call(), 0)

          assert.isFalse(await cfd.methods.sellerSelling().call())
          assert.equal(await cfd.methods.sellerSaleTimeLimit().call(), 0)
          assert.equal(await cfd.methods.sellerSaleStrikePrice().call(), 0)
        })

        it('buyer buy rejected with collateral less then 20% of the notional', async () => {
          // initiate contract
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          await deposit(cfd, seller, notionalAmount.toFixed())
          // mark seller side on sale
          await cfd.methods.sellPrepare(strikePriceAdjusted.toFixed(), 0).send({ from: seller })
          await assertStatus(cfd, STATUS.SALE)

          // 1 under the minimum
          const collateral = notionalAmount.dividedBy(5).minus(1)

          const buyBuyerSide = true
          try {
            await buy(cfd, buyingParty, !buyBuyerSide, collateral.toFixed())
            assert.fail('expected reject buy')
          } catch (err) {
            assert.equal(`${REJECT_MESSAGE} collateralInRange false`, err.message)
          }
        })

        it('buyer can cancel a sale', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          await deposit(cfd, seller, notionalAmount.toFixed())
          const saleStrikePrice = strikePriceAdjusted.times(1.05)
          await cfd.methods.sellPrepare(saleStrikePrice.toFixed(), 0).send({ from: buyer })

          await assertStatus(cfd, STATUS.SALE)
          assertEqualBN(await cfd.methods.buyerSaleStrikePrice().call(), saleStrikePrice)

          // cancel and check state set back to no sale
          await cfd.methods.sellCancel().send({ from: buyer })

          await assertStatus(cfd, STATUS.INITIATED)
          assert.isFalse(await cfd.methods.buyerSelling().call())
          assert.equal(await cfd.methods.buyerSaleStrikePrice().call(), 0)
        })

        it('seller can cancel a sale', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          await deposit(cfd, seller, notionalAmount.toFixed())
          const saleStrikePrice = strikePriceAdjusted.times(1.05)
          await cfd.methods.sellPrepare(saleStrikePrice.toFixed(), 0).send({ from: seller })

          await assertStatus(cfd, STATUS.SALE)
          assertEqualBN(await cfd.methods.sellerSaleStrikePrice().call(), saleStrikePrice)

          // cancel and check state set back to no sale
          await cfd.methods.sellCancel().send({ from: seller })

          await assertStatus(cfd, STATUS.INITIATED)
          assert.isFalse(await cfd.methods.sellerSelling().call())
          assert.equal(await cfd.methods.sellerSaleStrikePrice().call(), 0)
        })

        it('buyer can update sale price', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          await deposit(cfd, seller, notionalAmount.toFixed())
          const saleStrikePrice = strikePriceAdjusted.times(1.05)
          await cfd.methods.sellPrepare(saleStrikePrice.toFixed(), 0).send({ from: buyer })

          // update the sale price
          const newPrice = saleStrikePrice.times(1.1)
          await cfd.methods.sellUpdate(newPrice.toFixed()).send({ from: buyer })
          assertEqualBN(await cfd.methods.buyerSaleStrikePrice().call(), newPrice)
        })

        it('seller can update sale price', async () => {
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          await deposit(cfd, seller, notionalAmount.toFixed())
          const saleStrikePrice = strikePriceAdjusted.times(1.05)
          await cfd.methods.sellPrepare(saleStrikePrice.toFixed(), 0).send({ from: seller })

          // update the sale price
          const newPrice = saleStrikePrice.times(1.1)
          await cfd.methods.sellUpdate(newPrice.toFixed()).send({ from: seller })

          assertEqualBN(await cfd.methods.sellerSaleStrikePrice().call(), newPrice)
        })
      })

      describe('topup and withdraw', async () => {
        before(async () => {
          await priceFeedsInternal.methods.push(marketId, strikePriceAdjusted.toFixed(), nowSecs()).send({
            from: DAEMON_ACCOUNT
          })
        })

        it('allows topup up', async () => {
          const collateral2X = notionalAmount.dividedBy(2)
          const cfd = await newCFD({
            notionalAmount,
            isBuyer: true,
            daiValue: collateral2X
          })
          await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral2X.toFixed())
          assertEqualBN(await cfd.methods.buyerDepositBalance().call(), collateral2X)
          assertEqualBN(await cfd.methods.sellerDepositBalance().call(), collateral2X)

          const topupAmount = notionalAmount.dividedBy(4)
          const expectedAmount = collateral2X.plus(topupAmount)

          await daiToken.methods.approve(cfd.options.address, topupAmount.toFixed()).send({ from: CREATOR_ACCOUNT })
          await cfd.methods.topup(topupAmount.toFixed()).send({ from: CREATOR_ACCOUNT })
          assertEqualBN(await cfd.methods.buyerDepositBalance().call(), expectedAmount)
          assertEqualBN(await cfd.methods.sellerDepositBalance().call(), collateral2X)

          await daiToken.methods.approve(cfd.options.address, topupAmount.toFixed()).send({ from: COUNTERPARTY_ACCOUNT })
          await cfd.methods.topup(topupAmount.toFixed()).send({ from: COUNTERPARTY_ACCOUNT, topupAmount })
          assertEqualBN(await cfd.methods.buyerDepositBalance().call(), expectedAmount)
          assertEqualBN(await cfd.methods.sellerDepositBalance().call(), expectedAmount)
        })

        it('allows withdraw and returns money to callers', async () => {
          const collateral1X = notionalAmount
          const cfd = await newCFD({
            notionalAmount,
            isBuyer: true,
            daiValue: collateral1X
          })
          await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral1X.toFixed())
          assertEqualBN(await cfd.methods.buyerDepositBalance().call(), collateral1X)
          assertEqualBN(await cfd.methods.sellerDepositBalance().call(), collateral1X)

          const withdrawAmount = notionalAmount.dividedBy(4)
          const expectedAmount = collateral1X.minus(withdrawAmount)

          const creatorBalBefore = await getBalance(CREATOR_ACCOUNT)
          const counterpartyBalBefore = await getBalance(COUNTERPARTY_ACCOUNT)

          await cfd.methods.withdraw(withdrawAmount.toFixed()).send({
            from: CREATOR_ACCOUNT
          })
          assertEqualBN(await cfd.methods.buyerDepositBalance().call(), expectedAmount)
          assertEqualBN(await cfd.methods.sellerDepositBalance().call(), collateral1X)
          assertEqualBN(
            await getBalance(CREATOR_ACCOUNT),
            creatorBalBefore.plus(withdrawAmount),
            'creator account balance incorrect'
          )

          await cfd.methods.withdraw(withdrawAmount.toFixed()).send({
            from: COUNTERPARTY_ACCOUNT
          })
          assertEqualBN(await cfd.methods.buyerDepositBalance().call(), expectedAmount)
          assertEqualBN(await cfd.methods.sellerDepositBalance().call(), expectedAmount)
          assertEqualBN(
            await getBalance(COUNTERPARTY_ACCOUNT),
            counterpartyBalBefore
              .plus(withdrawAmount),
            'counterparty account balance incorrect'
          )
        })

        it('rejects withdraw that brings the collateral down below minimum', async () => {
          const collateral1X = notionalAmount

          const cfd = await newCFD({
            notionalAmount,
            isBuyer: true,
            daiValue: collateral1X
          })
          await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral1X.toFixed())
          assertEqualBN(
            await cfd.methods.buyerDepositBalance().call(),
            collateral1X,
            'buyer deposit bal'
          )
          assertEqualBN(
            await cfd.methods.sellerDepositBalance().call(),
            collateral1X,
            'seller deposit bal'
          )

          const withdrawAmountExceedsMin = collateral1X
            .minus(minimumCollateral)
            .plus(1) // 1 under the miniumum balance

          try {
            await cfd.methods.withdraw(withdrawAmountExceedsMin.toFixed()).send({
              from: CREATOR_ACCOUNT
            })
            assert.fail('expected reject withdraw')
          } catch (err) {
            assert.equal(`${REJECT_MESSAGE} collateralInRange false`, err.message)
          }

          try {
            await cfd.methods.withdraw(withdrawAmountExceedsMin.toFixed()).send({
              from: COUNTERPARTY_ACCOUNT
            })
            assert.fail('expected reject withdraw')
          } catch (err) {
            assert.equal(`${REJECT_MESSAGE} collateralInRange false`, err.message)
          }
        })
      })

      describe('check selling over liquidation price', async () => {
        const buyer = CREATOR_ACCOUNT
        const seller = COUNTERPARTY_ACCOUNT

        before(async () => {
          // push in the original strike price (in case another test has changed it)
          await priceFeedsInternal.methods.push(marketId, strikePriceAdjusted.toFixed(), nowSecs()).send({
            from: DAEMON_ACCOUNT
          })
        })

        it('selling at liquidation price as buyer',
          async () => {
            // initiate contract
            const cfd = await newCFD({ notionalAmount, isBuyer: true })
            await deposit(cfd, seller, notionalAmount.toFixed())
            const deposits = notionalAmount.dividedBy(1)
            const buyerLiqPrice = await cfd.methods.cutOffPrice(notionalAmount.toFixed(), deposits.toFixed(), strikePriceAdjusted.toFixed(), true).call()
            // put buyer side on sale at liquidation price
            try {
              await cfd.methods.sellPrepare(new BigNumber(buyerLiqPrice / 2).toFixed(), 0).send({ from: buyer })
              assert.fail('expected reject sale with liquidation price error')
            } catch (err) {
              assert.equal(`${REJECT_MESSAGE} Must be more than liquidation price`, err.message)
            }
          }
        )

        it('selling at liquidation price as seller',
          async () => {
            // initiate contract
            const cfd = await newCFD({ notionalAmount, isBuyer: true })
            await deposit(cfd, seller, notionalAmount.toFixed())
            const deposits = notionalAmount.dividedBy(1)
            const sellerLiqPrice = await cfd.methods.cutOffPrice(notionalAmount.toFixed(), deposits.toFixed(), strikePriceAdjusted.toFixed(), false).call()
            // put seller side on sale at liquidation price
            try {
              await cfd.methods.sellPrepare(new BigNumber(sellerLiqPrice * 2).toFixed(), 0).send({ from: seller })
              assert.fail('expected reject sale with liquidation price error')
            } catch (err) {
              assert.equal(`${REJECT_MESSAGE} Must be less than liquidation price`, err.message)
            }
          }
        )

        it('selling over liquidation price as buyer',
          async () => {
            // initiate contract
            const cfd = await newCFD({ notionalAmount, isBuyer: true })
            await deposit(cfd, seller, notionalAmount.toFixed())
            const deposits = notionalAmount.dividedBy(1)
            const buyerLiqPrice = await cfd.methods.cutOffPrice(notionalAmount.toFixed(), deposits.toFixed(), strikePriceAdjusted.toFixed(), true).call()
            // put buyer side on sale over liquidation price
            await cfd.methods.sellPrepare(new BigNumber(buyerLiqPrice * 2).toFixed(), 0).send({ from: buyer })
            assert.isTrue(await cfd.methods.buyerSelling().call())
          }
        )

        it('selling under liquidation price as seller',
          async () => {
            // initiate contract
            const cfd = await newCFD({ notionalAmount, isBuyer: true })
            await deposit(cfd, seller, notionalAmount.toFixed())
            const deposits = notionalAmount.dividedBy(1)
            const sellerLiqPrice = await cfd.methods.cutOffPrice(notionalAmount.toFixed(), deposits.toFixed(), strikePriceAdjusted.toFixed(), false).call()
            // put seller side on sale under liquidation price
            await cfd.methods.sellPrepare(new BigNumber(sellerLiqPrice / 2).toFixed(), 0).send({ from: seller })
            assert.isTrue(await cfd.methods.sellerSelling().call())
          }
        )

      })

      run()

    }, 2000)

  }).catch((err) => {
    console.log(err)
    process.exit(-1)
  })
})
