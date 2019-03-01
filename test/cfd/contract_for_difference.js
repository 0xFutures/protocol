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
  cutOffPrice,
  creatorFee as creatorFeeCalc,
  joinerFee as joinerFeeCalc
} from '../../src/calc'
import { cfdInstance } from '../../src/infura/contracts'

import { assertEqualBN, assertLoggedParty, assertStatus } from '../helpers/assert'
import { deployAllForTest } from '../helpers/deploy'
import { config, web3 } from '../helpers/setup'

const REJECT_MESSAGE = 'VM Exception while processing transaction: revert'

const MINIMUM_COLLATERAL_PERCENT = new BigNumber(20)
const MAXIMUM_COLLATERAL_PERCENT = new BigNumber(500)

const ONE_DAI = new BigNumber('1e18')
const ONE_BN = new BigNumber(1)

describe('ContractForDifference', function () {
  const ContractForDifference = cfdInstance(web3.currentProvider, config)

  web3.eth.getAccounts().then((accounts) => {

    console.log(accounts);

    const DAEMON_ACCOUNT = accounts[3]
    const CREATOR_ACCOUNT = accounts[2]
    const COUNTERPARTY_ACCOUNT = accounts[4]
    const FEES_ACCOUNT = accounts[8]

    const strikePriceRaw = new BigNumber('800.0')
    const notionalAmount = ONE_DAI
    let strikePriceAdjusted

    let registry
    let feeds
    let cfdRegistry
    let daiToken
    let decimals
    let marketId

    let minimumCollateral
    let maximumCollateral

    const getBalance = addr => daiToken.balanceOf.call(addr)
    const deposit = async (cfd, from, amount) => {
      await daiToken.approve(cfd.address, amount, { from })
      return cfd.deposit(amount, { from })
    }
    const buy = async (cfd, from, buyBuyerSide, amount) => {
      await daiToken.approve(cfd.address, amount, { from })
      return cfd.buy(buyBuyerSide, amount, { from })
    }

    const creatorFee = () => creatorFeeCalc(notionalAmount)
    const joinerFee = (notional = notionalAmount) => joinerFeeCalc(notional)

    /**
     * Create a new CFD directly.
     * Implements the same steps that the CFDFactory contract does.
     */
    const newCFD = async ({
      strikePrice = strikePriceAdjusted,
      notionalAmount,
      isBuyer,
      daiValue = notionalAmount,
      creator = CREATOR_ACCOUNT
    }) => {
      const cfd = await ContractForDifference.new({
        gas: 6700000,
        from: creator
      })

      const transferAmount = creatorFee().plus(daiValue)
      await daiToken.transfer(cfd.address, transferAmount)

      await cfd.create(
        registry.address,
        cfdRegistry.address,
        feeds.address,
        creator,
        marketId,
        strikePrice,
        notionalAmount,
        isBuyer,
        {
          gas: 1000000,
          from: creator
        }
      )

      // from default web3 account masquerading as a factory (see setFactory call in setup)
      await cfdRegistry.registerNew(cfd.address, CREATOR_ACCOUNT)

      return cfd
    }

    before(async () => {
      // eslint-disable-next-line no-extra-semi
      ; ({ cfdRegistry, feeds, registry, daiToken, decimals, marketId } = await deployAllForTest(
        {
          web3,
          initialPrice: strikePriceRaw
        }
      ))
      strikePriceAdjusted = toContractBigNumber(strikePriceRaw, decimals)

      // set factory to default account so we can manually call registerNew
      await cfdRegistry.setFactory(config.ownerAccountAddr)

      minimumCollateral = notionalAmount.times(
        MINIMUM_COLLATERAL_PERCENT.dividedBy(100)
      )

      maximumCollateral = notionalAmount.times(
        MAXIMUM_COLLATERAL_PERCENT.dividedBy(100)
      )
      // give tokens to CFD parties
      const daiSendingTestAccounts = [CREATOR_ACCOUNT, COUNTERPARTY_ACCOUNT, accounts[5], accounts[9]]
      await Promise.all(daiSendingTestAccounts.map(acc => daiToken.transfer(acc, ONE_DAI.times(100))))
    })

    describe('initiation', async () => {
      it('creates a new CFD with contract terms', async () => {
        const feesBalBefore = await getBalance(FEES_ACCOUNT)

        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        assert.equal(await cfd.market.call(), marketId, 'market incorrect')
        assert.equal(await cfd.buyer.call(), CREATOR_ACCOUNT, 'buyer incorrect')
        assert.equal(await cfd.seller.call(), EMPTY_ACCOUNT, 'seller incorrect')
        assertEqualBN(
          await cfd.strikePrice.call(),
          strikePriceAdjusted,
          'strike price incorrect'
        )
        assertEqualBN(
          await cfd.sellerInitialStrikePrice.call(),
          strikePriceAdjusted,
          'seller strike price not 0'
        )
        assertEqualBN(
          await cfd.buyerInitialStrikePrice.call(),
          strikePriceAdjusted,
          'buyer strike price not 0'
        )
        assertEqualBN(
          await cfd.notionalAmountDai.call(),
          notionalAmount,
          'notionalAmountDai incorrect'
        )
        assertEqualBN(
          await getBalance(cfd.address),
          notionalAmount.plus(creatorFee()),
          'cfd balance incorrect'
        )
        assertEqualBN(
          await getBalance(FEES_ACCOUNT),
          feesBalBefore,
          'fees bal should not have changed'
        )
        assert.isFalse(await cfd.initiated.call(), 'should not be initiated')
        await assertStatus(cfd, STATUS.CREATED)
      })

      it('creates a new CFD with colateral exactly MINIMUM_COLLATERAL_PERCENT of the notional', async () => {
        const collateral = minimumCollateral
        const cfd = await newCFD({
          notionalAmount,
          isBuyer: true,
          daiValue: collateral
        })
        assert.equal(await cfd.buyer.call(), CREATOR_ACCOUNT, 'buyer incorrect')
        assertEqualBN(
          await getBalance(cfd.address),
          collateral.plus(creatorFee()),
          'cfd balance incorrect'
        )
      })

      it('initiates the contract on counterparty deposit()', async () => {
        const feesBalBefore = await getBalance(FEES_ACCOUNT)

        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        assert.equal(await cfd.buyer.call(), CREATOR_ACCOUNT, 'buyer incorrect')
        assert.equal(await cfd.seller.call(), EMPTY_ACCOUNT, 'seller incorrect')

        const txReceipt = await deposit(cfd, COUNTERPARTY_ACCOUNT, notionalAmount.plus(joinerFee()))

        // check party logged by CFDRegistry
        assertLoggedParty(
          txReceipt.receipt.logs[2],
          cfd.address,
          COUNTERPARTY_ACCOUNT
        )

        // check cfd details
        await assertStatus(cfd, STATUS.INITIATED)
        assert.equal(
          await cfd.seller.call(),
          COUNTERPARTY_ACCOUNT,
          'seller incorrect'
        )
        assert.equal(await cfd.buyer.call(), CREATOR_ACCOUNT, 'buyer incorrect')
        assert.isTrue(await cfd.initiated.call(), 'should be initiated')

        const expectedBalance = notionalAmount.times(2)
        assertEqualBN(
          await getBalance(cfd.address),
          expectedBalance,
          'cfd balance incorrect'
        )

        assertEqualBN(
          await getBalance(FEES_ACCOUNT),
          feesBalBefore.plus(notionalAmount.times(0.008)),
          'fees bal should have the 3% creator plus 5% depositor fee'
        )

        assert.equal(
          txReceipt.receipt.logs[3].topics[0],
          web3.utils.sha3(
            'LogCFDInitiated(address,uint256,address,address,bytes32,uint256,uint256,uint256,uint256)'
          ),
          'logged initiated: topic wrong'
        )
      })

      it('allows deposit with collateral exactly MINIMUM_COLLATERAL_PERCENT of the notional', async () => {
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        await deposit(cfd, COUNTERPARTY_ACCOUNT, minimumCollateral.plus(joinerFee()))
        await assertStatus(cfd, STATUS.INITIATED)
      })

      it('can cancel newly created contract before a deposit', async () => {
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        assert.isFalse(await cfd.initiated.call(), 'should not be initiated')
        assert.isFalse(await cfd.closed.call(), 'should not be closed')

        await cfd.cancelNew({ from: CREATOR_ACCOUNT })
        await assertStatus(cfd, STATUS.CLOSED)
        assert.isTrue(await cfd.closed.call(), 'should be closed')
        assert.isFalse(await cfd.initiated.call(), 'should not be initiated')
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
          await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral.plus(joinerFee()))
          assert.fail('expected reject deposit with low collateral')
        } catch (err) {
          assert.equal(`${REJECT_MESSAGE} collateralInRange false`, err.message)
        }
      })

      it('rejects deposit with collateral more then MAXIMUM_COLLATERAL_PERCENT of the notional', async () => {
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        try {
          const collateral = maximumCollateral.plus(1)
          await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral.plus(joinerFee()))
          assert.fail('expected reject deposit with high collateral')
        } catch (err) {
          assert.equal(`${REJECT_MESSAGE} collateralInRange false`, err.message)
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
        await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral1X.plus(joinerFee()))

        // move the market price up before terminating
        const priceRise = 0.1 // 10%
        await feeds.push(
          marketId,
          strikePriceAdjusted.times(1 + priceRise),
          nowSecs(),
          {
            from: DAEMON_ACCOUNT
          }
        )

        assert.isFalse(await cfd.terminated.call())

        const creatorBalBefore = await getBalance(CREATOR_ACCOUNT)
        const cpBalBefore = await getBalance(COUNTERPARTY_ACCOUNT)
        const feesBalBefore = await getBalance(FEES_ACCOUNT)

        const ftTx = await cfd.forceTerminate({
          from: CREATOR_ACCOUNT
        })

        await assertStatus(cfd, STATUS.CLOSED)
        assert.isTrue(await cfd.closed.call())
        assert.isTrue(await cfd.terminated.call())

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
          await getBalance(FEES_ACCOUNT),
          feesBalBefore,
          'fees balance should be unchanged'
        )
        assertEqualBN(
          await getBalance(cfd.address),
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
        await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral5X.plus(joinerFee()))

        // move the market price up before terminating
        const priceFall = 0.1 // 10%
        await feeds.push(
          marketId,
          strikePriceAdjusted.times(1 - priceFall),
          nowSecs(),
          {
            from: DAEMON_ACCOUNT
          }
        )

        assert.isFalse(await cfd.terminated.call())

        const creatorBalBefore = await getBalance(CREATOR_ACCOUNT)
        const cpBalBefore = await getBalance(COUNTERPARTY_ACCOUNT)

        await cfd.forceTerminate({
          from: CREATOR_ACCOUNT
        })

        await assertStatus(cfd, STATUS.CLOSED)
        assert.isTrue(await cfd.closed.call())
        assert.isTrue(await cfd.terminated.call())

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
          await getBalance(cfd.address),
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
        await deposit(cfd, seller, collateral1X.plus(joinerFee()))
        await cfd.sellPrepare(strikePriceAdjusted, 0, { from: seller })
        await buy(cfd, buyingParty, false, collateral1X.plus(joinerFee()))

        const buyerBalBefore = await getBalance(buyer)
        const buyingPartyBalBefore = await getBalance(buyingParty)

        // buyer teminates
        const ftTx = await cfd.forceTerminate({
          from: buyer
        })

        await assertStatus(cfd, STATUS.CLOSED)
        assert.isTrue(await cfd.closed.call())
        assert.isTrue(await cfd.terminated.call())

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
          await getBalance(cfd.address),
          0,
          'cfd balance should be 0'
        )
      })
    })

    describe('transferPosition()', async () => {
      const TRANSFER_TO_GUY = accounts[7]

      it('transfers seller side ownership', async () => {
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        await deposit(cfd, COUNTERPARTY_ACCOUNT, notionalAmount.plus(joinerFee()))
        assert.equal(
          await cfd.seller.call(),
          COUNTERPARTY_ACCOUNT,
          'seller incorrect'
        )
        assert.equal(await cfd.buyer.call(), CREATOR_ACCOUNT, 'buyer incorrect')

        const txReceipt = await cfd.transferPosition(TRANSFER_TO_GUY, {
          from: COUNTERPARTY_ACCOUNT,
          gas: 50000
        })

        // check party logged by CFDRegistry
        assertLoggedParty(txReceipt.receipt.logs[0], cfd.address, TRANSFER_TO_GUY)

        assert.equal(await cfd.seller.call(), TRANSFER_TO_GUY, 'seller incorrect')
        assert.equal(await cfd.buyer.call(), CREATOR_ACCOUNT, 'buyer incorrect')
      })

      it('transfers buyer side ownership', async () => {
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        await deposit(cfd, COUNTERPARTY_ACCOUNT, notionalAmount.plus(joinerFee()))
        assert.equal(
          await cfd.seller.call(),
          COUNTERPARTY_ACCOUNT,
          'seller incorrect'
        )
        assert.equal(await cfd.buyer.call(), CREATOR_ACCOUNT, 'buyer incorrect')

        const txReceipt = await cfd.transferPosition(TRANSFER_TO_GUY, {
          from: CREATOR_ACCOUNT
        })

        // check party logged by CFDRegistry
        assertLoggedParty(txReceipt.receipt.logs[0], cfd.address, TRANSFER_TO_GUY)

        assert.equal(
          await cfd.seller.call(),
          COUNTERPARTY_ACCOUNT,
          'seller incorrect'
        )
        assert.equal(await cfd.buyer.call(), TRANSFER_TO_GUY, 'buyer incorrect')
      })

      it('can transfer before initiated (before a counterparty via deposit())', async () => {
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        const txReceipt = await cfd.transferPosition(TRANSFER_TO_GUY, {
          from: CREATOR_ACCOUNT
        })
        // check party logged by CFDRegistry
        assertLoggedParty(txReceipt.receipt.logs[0], cfd.address, TRANSFER_TO_GUY)
        assert.equal(await cfd.buyer.call(), TRANSFER_TO_GUY, 'buyer incorrect')
        assert.equal(await cfd.seller.call(), EMPTY_ACCOUNT, 'not empty')
      })

      it("can't transfer to one of the 2 contract parties", async () => {
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        await deposit(cfd, COUNTERPARTY_ACCOUNT, notionalAmount.plus(joinerFee()))

        const assertFailure = async (to, from) => {
          try {
            await cfd.transferPosition(to, {
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

    describe('liquidation via threshold reached - call updateSubscriber()', async () => {
      // #11 ensures the contract does not disolve if the daemon is wrong for
      // some reason about the liquidate threshold being reached
      it('rejects the update if called and the threshold has not been reached', async () => {
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        await deposit(cfd, COUNTERPARTY_ACCOUNT, notionalAmount.plus(joinerFee()))

        const newStrikePrice = strikePriceAdjusted.times(1.1) // not enough to hit liquidate threshold
        await feeds.push(marketId, newStrikePrice, nowSecs(), {
          from: DAEMON_ACCOUNT
        })

        try {
          await cfd.liquidate({
            from: DAEMON_ACCOUNT,
            gas: 200000
          })
          assert.fail('expected reject of update by CFD.liquidate')
        } catch (err) {
          assert.equal(`${REJECT_MESSAGE} Liquidate threshold not yet reached`, err.message)
        }
      })

      it('disolves the contract - 1x leverage both sides, price rise', async () => {
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        await deposit(cfd, COUNTERPARTY_ACCOUNT, notionalAmount.plus(joinerFee()))

        // 5% threshold passed for seller
        const newStrikePrice = strikePriceAdjusted.times(1.951)
        await feeds.push(marketId, newStrikePrice, nowSecs(), {
          from: DAEMON_ACCOUNT
        })

        const cfdBalance = await getBalance(cfd.address)
        const creatorBalBefore = await getBalance(CREATOR_ACCOUNT)
        const cpBalBefore = await getBalance(COUNTERPARTY_ACCOUNT)

        await cfd.liquidate({
          from: DAEMON_ACCOUNT,
          gas: 200000
        })

        await assertStatus(cfd, STATUS.CLOSED)
        assert.isTrue(await cfd.closed.call())
        assert.isFalse(await cfd.terminated.call())

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
        await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral5X.plus(joinerFee()))

        // 5% threshold passed for seller at 5X - get cutoff price then add 1
        const sellerCutOffPrice = cutOffPrice({
          strikePrice: strikePriceAdjusted,
          notionalAmount,
          depositBalance: collateral5X,
          isBuyer: false
        })
        const newStrikePrice = sellerCutOffPrice.plus(1)
        await feeds.push(marketId, newStrikePrice, nowSecs(), {
          from: DAEMON_ACCOUNT
        })

        const cfdBalance = await getBalance(cfd.address)
        const creatorBalBefore = await getBalance(CREATOR_ACCOUNT)
        const cpBalBefore = await getBalance(COUNTERPARTY_ACCOUNT)

        await cfd.liquidate({
          from: DAEMON_ACCOUNT,
          gas: 200000
        })

        await assertStatus(cfd, STATUS.CLOSED)
        assert.isTrue(await cfd.closed.call())
        assert.isFalse(await cfd.terminated.call())

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
        await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral5X.plus(joinerFee()))

        // under 5% threshold
        const newStrikePrice = strikePriceAdjusted.times(0.04)
        await feeds.push(marketId, newStrikePrice, nowSecs(), {
          from: DAEMON_ACCOUNT
        })

        const cfdBalance = await getBalance(cfd.address)
        const creatorBalBefore = await getBalance(CREATOR_ACCOUNT)
        const cpBalBefore = await getBalance(COUNTERPARTY_ACCOUNT)

        await cfd.liquidate({
          from: DAEMON_ACCOUNT,
          gas: 200000
        })

        await assertStatus(cfd, STATUS.CLOSED)
        assert.isTrue(await cfd.closed.call())
        assert.isFalse(await cfd.terminated.call())

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

    describe('price movement calculations', async () => {
      it('percentOf() calculates percentage of an amount', async () => {
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        assertEqualBN(await cfd.percentOf.call(1000, 1), new BigNumber('10'))
        assertEqualBN(await cfd.percentOf.call(1000, 10), new BigNumber('100'))
        assertEqualBN(
          await cfd.percentOf.call(1000, 200),
          new BigNumber('2000')
        )
      })

      it('percentChange() calculates percentage change of 2 amounts', async () => {
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        assertEqualBN(
          await cfd.percentChange.call(10000, 9000),
          new BigNumber('10')
        )
        assertEqualBN(
          await cfd.percentChange.call(10000, 11000),
          new BigNumber('10')
        )
        assertEqualBN(
          await cfd.percentChange.call(10000, 10),
          new BigNumber('99')
        )
      })

      it('changeInDai() calculates value change based on new price', async () => {
        const price = toContractBigNumber('100', decimals)
        const amount = ONE_DAI
        const cfd = await newCFD({
          notionalAmount: amount,
          isBuyer: true,
          strikePrice: price
        })

        const assertChange = async (newPrice, expected) =>
          assertEqualBN(
            await cfd.changeInDai.call(price, newPrice, amount),
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
        const strikePrice = toContractBigNumber('1000', decimals)

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
            await cfd.cutOffPrice.call(
              notional,
              deposits,
              strikePrice,
              buyerSide
            ),
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
      let decimals

      const assertCollateral = async ({
        cfd = defaultCFD,
        strikePrice = defaultInitialStrikePrice,
        marketPrice,
        deposits,
        isBuyer,
        expected
      }) => {
        const collateral = await cfd.calculateCollateralAmount.call(
          strikePrice,
          marketPrice,
          await cfd.notionalAmountDai.call(),
          deposits,
          isBuyer
        )
        assertEqualBN(collateral, expected)
      }

      before(async () => {
        decimals = await feeds.decimals.call()

        // setup a default CFD for some of the test cases
        defaultInitialStrikePrice = toContractBigNumber('1000', decimals)
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
          await cfd.calculateNewNotional.call(
            notionalAmount,
            strikePriceAdjusted,
            strikePriceAdjusted.times(2)
          ),
          notionalAmount.times(2)
        )
        assertEqualBN(
          await cfd.calculateNewNotional.call(
            notionalAmount,
            strikePriceAdjusted,
            strikePriceAdjusted.times(0.5)
          ),
          notionalAmount.times(0.5)
        )
      })
    })

    describe('fee calculations', async () => {
      let cfd

      before(async () => {
        cfd = await newCFD({ notionalAmount, isBuyer: true })
      })

      it('creatorFee() calculates 0.3% of a notional amount', async () => {
        assertEqualBN(
          await cfd.creatorFee.call(notionalAmount),
          notionalAmount.times(0.003)
        )
      })
      it('joinerFee() calculates 0.5% of a notional amount', async () => {
        assertEqualBN(
          await cfd.joinerFee.call(notionalAmount),
          notionalAmount.times(0.005)
        )
      })
    })

    describe('sale', async () => {
      const buyer = CREATOR_ACCOUNT
      const seller = COUNTERPARTY_ACCOUNT
      const buyingParty = accounts[5]

      before(async () => {
        // push in the original strike price (in case another test has changed it)
        await feeds.push(marketId, strikePriceAdjusted, nowSecs(), {
          from: DAEMON_ACCOUNT
        })
      })

      it(
        `view functions isBuyerSelling, isSellerSelling, isSelling ` +
        `work correctly`,
        async () => {
          // initiate contract
          const cfd = await newCFD({ notionalAmount, isBuyer: true })
          await deposit(cfd, seller, notionalAmount.plus(joinerFee()))
          // put seller side on sale
          await cfd.sellPrepare(strikePriceAdjusted, 0, { from: seller })

          await assertStatus(cfd, STATUS.SALE)

          assert.isTrue(await cfd.sellerSelling.call(), 'isSellerSelling true')
          assert.isFalse(await cfd.buyerSelling.call(), 'isBuyerSelling false')

          assert.isTrue(await cfd.isSellerSelling.call(), 'isSellerSelling true')
          assert.isFalse(await cfd.isBuyerSelling.call(), 'isBuyerSelling false')

          assert.isTrue(
            await cfd.isSelling.call(seller),
            'isSelling(seller) true'
          )
          assert.isFalse(
            await cfd.isSelling.call(buyer),
            'isSelling(buyer) false'
          )
        }
      )

      /*
       * Summary:
       *  - seller at 1X puts side on sale
       *  - a buyer comes along and buys that side with 2x leverage
       *  - seller gets back full collateral
       */
      it('a buyer buys the "on sale" position with enough collateral - 2X', async () => {
        // initiate contract
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        await deposit(cfd, seller, notionalAmount.plus(joinerFee()))
        // put seller side on sale
        await cfd.sellPrepare(strikePriceAdjusted, 0, { from: seller })
        await assertStatus(cfd, STATUS.SALE)

        // assert sale details in the contract
        assertEqualBN(await cfd.sellerSaleStrikePrice.call(), strikePriceAdjusted)
        assert.equal(await cfd.sellerSaleTimeLimit.call(), 0)
        assert.isTrue(await cfd.isSellerSelling.call(), 'isSellerSelling true')

        // save balances
        const buyerBalBefore = await getBalance(buyer)
        const sellerBalBefore = await getBalance(seller)
        const buyingPartyBalBefore = await getBalance(buyingParty)
        const feesBalBefore = await getBalance(FEES_ACCOUNT)

        // buyingParty buys the seller side
        const collateral = notionalAmount.dividedBy(2) // 2X leverage
        const buyBuyerSide = false // buying seller side
        const joinFee = joinerFee()
        const buyTx = await buy(cfd, buyingParty, buyBuyerSide, collateral.plus(joinerFee()))

        // check new party logged by CFDRegistry
        assertLoggedParty(buyTx.receipt.logs[4], cfd.address, buyingParty)

        // check the contract has been updated
        assert.equal(await cfd.seller.call(), buyingParty)
        assert.equal(await cfd.buyer.call(), buyer) // unchanged

        // all notionals unchanged as the strike price hasn't changed:
        assertEqualBN(await cfd.notionalAmountDai.call(), notionalAmount)
        assertEqualBN(await cfd.notionalAmountDai.call(), notionalAmount)
        assertEqualBN(await cfd.buyerInitialNotional.call(), notionalAmount)

        // all strike prices unchanged as the strike price hasn't changed:
        assertEqualBN(await cfd.strikePrice.call(), strikePriceAdjusted)
        assertEqualBN(
          await cfd.sellerInitialStrikePrice.call(),
          strikePriceAdjusted
        )
        assertEqualBN(
          await cfd.buyerInitialStrikePrice.call(),
          strikePriceAdjusted
        ) // unchanged

        assertEqualBN(
          await cfd.sellerDepositBalance.call(),
          collateral,
          'sellerDepositBalance'
        )
        assertEqualBN(
          await cfd.buyerDepositBalance.call(),
          notionalAmount,
          'buyerDepositBalance'
        ) // unchanged

        // sale details all reset
        assert.isFalse(await cfd.buyerSelling.call(), 'buyerSelling false')
        assert.isFalse(await cfd.sellerSelling.call(), 'sellerSelling false')
        assert.equal(
          await cfd.sellerSaleTimeLimit.call(),
          0,
          'sellerSaleTimeLimit = 0'
        )
        assert.equal(
          await cfd.sellerSaleStrikePrice.call(),
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
            .minus(collateral)
            .minus(joinerFeeCalc(notionalAmount)),
          'buyingParty balance'
        )

        // check balance of cfd includes both deposits
        assertEqualBN(
          await getBalance(cfd.address),
          notionalAmount.plus(collateral),
          'new cfd balance'
        )

        // check fees has received the 0.5% joiner fee
        assertEqualBN(
          await getBalance(FEES_ACCOUNT),
          feesBalBefore.plus(joinFee),
          'fees balance'
        )
      })

      /*
       * Summary:
       *  - buyer at 1X puts side on sale at a strike price 20% above
       *  - a buyer comes along and buys that side
       *  - new notional amount is set
       */
      it('new notional correct when buyer sells at 20% higher strike price', async () => {
        // initiate contract
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        await deposit(cfd, seller, notionalAmount.plus(joinerFee()))
        // put seller side on sale
        const saleStrikePrice = strikePriceAdjusted.times(1.2)
        await cfd.sellPrepare(saleStrikePrice, 0, { from: buyer })
        await assertStatus(cfd, STATUS.SALE)

        // assert sale details in the contract
        assertEqualBN(await cfd.buyerSaleStrikePrice.call(), saleStrikePrice)

        // buyingParty buys the seller side
        const buyBuyerSide = true
        const joinFee = joinerFee()
        await buy(cfd, buyingParty, buyBuyerSide, notionalAmount.plus(joinFee))

        const expectedNewNotional = notionalAmount.times(1.2)
        assertEqualBN(
          await cfd.notionalAmountDai.call(),
          expectedNewNotional,
          'new notional'
        )
        assertEqualBN(
          await cfd.buyerInitialNotional.call(),
          expectedNewNotional,
          'buyer initial notional same as new notional'
        )
        assertEqualBN(
          await cfd.sellerInitialNotional.call(),
          notionalAmount,
          'seller initial notional unchanged'
        ) // unchanged
      })

      /*
       * Summary:
       *  - seller at 1X puts side on sale at a strike price 20% below
       *  - a buyer comes along and buys that side
       *  - new notional amount is set
       */
      it('new notional correct when seller sells at 20% lower strike price', async () => {
        // initiate contract
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        await deposit(cfd, seller, notionalAmount.plus(joinerFee()))
        // put seller side on sale
        const saleStrikePrice = strikePriceAdjusted.times(0.8)
        await cfd.sellPrepare(saleStrikePrice, 0, { from: seller })
        await assertStatus(cfd, STATUS.SALE)

        // assert sale details in the contract
        assertEqualBN(await cfd.sellerSaleStrikePrice.call(), saleStrikePrice)

        // buyingParty buys the seller side
        const buyBuyerSide = false // buying seller side
        const joinFee = joinerFee()
        await buy(cfd, buyingParty, buyBuyerSide, notionalAmount.plus(joinFee))

        const expectedNewNotional = notionalAmount.times(0.8)
        assertEqualBN(
          await cfd.notionalAmountDai.call(),
          expectedNewNotional,
          'new notional'
        )
        assertEqualBN(
          await cfd.sellerInitialNotional.call(),
          expectedNewNotional,
          'seller initial notional same as new notional'
        )
        assertEqualBN(
          await cfd.buyerInitialNotional.call(),
          notionalAmount,
          'buyer initial notional unchanged'
        ) // unchanged
      })

      /*
       * Summary:
       *  - a buyer in at 1X puts side on sale at price 10% more
       *  - a seller in at 2X puts side on sale at price 20% more
       *  - a new buyer buys the buyer side at 2x collateral
       *  - a new buyer buys the seller side at 4x collateral
       *  - assert the selling parties receive collateral amounts
       *  - assert CFD values are all correct after the sales
       *  - assert fees are sent to fees address
       */
      it('both sides can be on sale at once with different terms', async () => {
        const buyBuyerSide = true
        const collateral1X = notionalAmount
        const collateral2X = notionalAmount.dividedBy(2)
        const joinFee = joinerFee()

        // initiate contract
        const cfd = await newCFD({ notionalAmount, isBuyer: true }) // defaults to 1X
        await deposit(cfd, seller, collateral2X.plus(joinerFee()))
        // buyer side put on sale
        const buyerDesiredPrice = strikePriceAdjusted.times(1.1)
        await cfd.sellPrepare(buyerDesiredPrice, 0, { from: buyer })
        assert.isTrue(await cfd.buyerSelling.call())

        // seller side put on sale
        const sellerDesiredPrice = strikePriceAdjusted.times(1.2)
        await cfd.sellPrepare(sellerDesiredPrice, 0, { from: seller })
        assert.isTrue(await cfd.sellerSelling.call())

        // buying parties
        const buyingParty1 = buyingParty
        const buyingParty2 = accounts[9]

        // save balances
        const buyerBalBefore = await getBalance(buyer)
        const sellerBalBefore = await getBalance(seller)
        const buyingParty1BalBefore = await getBalance(buyingParty1)
        const buyingParty2BalBefore = await getBalance(buyingParty2)
        const feesBalBefore = await getBalance(FEES_ACCOUNT)

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

        const buy1Tx = await buy(cfd, buyingParty1, buyBuyerSide, collateral2X.plus(joinFee))

        // check the state
        assert.equal(await cfd.buyer.call(), buyingParty1)
        assertLoggedParty(buy1Tx.receipt.logs[4], cfd.address, buyingParty1)
        assertEqualBN(await cfd.strikePrice.call(), buyerDesiredPrice)
        assertEqualBN(await cfd.buyerInitialStrikePrice.call(), buyerDesiredPrice)
        assertEqualBN(
          await cfd.buyerDepositBalance.call(),
          collateral2X,
          'buyer deposits balance after buyer buy'
        )
        assertEqualBN(
          await cfd.sellerDepositBalance.call(),
          (await getBalance(cfd.address)).minus(collateral2X),
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
          strikePrice: await cfd.strikePrice.call(),
          marketPrice: sellerDesiredPrice,
          notionalAmount: newNotional,
          depositBalance: await cfd.sellerDepositBalance.call(),
          calcBuyerSide: false
        })

        const collateral4XBuy2 = newNotional.dividedBy(4)
        const joinFeeBuy2 = joinerFee(newNotional)
        const buy2Tx = await buy(cfd, buyingParty2, !buyBuyerSide, collateral4XBuy2.plus(joinFeeBuy2))

        // check the state
        assert.equal(await cfd.seller.call(), buyingParty2)
        assertLoggedParty(buy2Tx.receipt.logs[4], cfd.address, buyingParty2)
        assertEqualBN(await cfd.strikePrice.call(), sellerDesiredPrice)
        assertEqualBN(
          await cfd.sellerInitialStrikePrice.call(),
          sellerDesiredPrice
        )

        assertEqualBN(
          await cfd.sellerDepositBalance.call(),
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
            .minus(collateral2X)
            .minus(joinerFee()),
          'buyingParty1 balance'
        )
        assertEqualBN(
          await getBalance(buyingParty2),
          buyingParty2BalBefore
            .minus(collateral4XBuy2)
            .minus(joinFeeBuy2),
          'buyingParty2 balance'
        )

        // check balance of cfd includes both new deposits plus a single read fee
        assertEqualBN(
          await getBalance(cfd.address),
          collateral4XBuy2.plus(await cfd.buyerDepositBalance.call()),
          'new cfd balance'
        )

        // check fees has received 0.5% join fee plus the buy fee
        assertEqualBN(
          await getBalance(FEES_ACCOUNT),
          feesBalBefore.plus(joinFee).plus(joinFeeBuy2),
          'fees balance'
        )

        // sale details all reset
        assert.isFalse(await cfd.buyerSelling.call())
        assert.equal(await cfd.buyerSaleTimeLimit.call(), 0)
        assert.equal(await cfd.buyerSaleStrikePrice.call(), 0)

        assert.isFalse(await cfd.sellerSelling.call())
        assert.equal(await cfd.sellerSaleTimeLimit.call(), 0)
        assert.equal(await cfd.sellerSaleStrikePrice.call(), 0)
      })

      it('buyer buy rejected with collateral less then 20% of the notional', async () => {
        // initiate contract
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        await deposit(cfd, seller, notionalAmount.plus(joinerFee()))
        // mark seller side on sale
        await cfd.sellPrepare(strikePriceAdjusted, 0, { from: seller })
        await assertStatus(cfd, STATUS.SALE)

        // 1 under the minimum
        const collateral = notionalAmount.dividedBy(5).minus(1)

        const buyBuyerSide = true
        try {
          await buy(cfd, buyingParty, !buyBuyerSide, collateral.plus(joinerFee()))
          assert.fail('expected reject buy')
        } catch (err) {
          assert.equal(`${REJECT_MESSAGE} collateralInRange false`, err.message)
        }
      })

      it('buyer can cancel a sale', async () => {
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        await deposit(cfd, seller, notionalAmount.plus(joinerFee()))
        const saleStrikePrice = strikePriceAdjusted.times(1.05)
        await cfd.sellPrepare(saleStrikePrice, 0, { from: buyer })

        await assertStatus(cfd, STATUS.SALE)
        assertEqualBN(await cfd.buyerSaleStrikePrice.call(), saleStrikePrice)

        // cancel and check state set back to no sale
        await cfd.sellCancel({ from: buyer })

        await assertStatus(cfd, STATUS.INITIATED)
        assert.isFalse(await cfd.buyerSelling.call())
        assert.equal(await cfd.buyerSaleStrikePrice.call(), 0)
      })

      it('seller can cancel a sale', async () => {
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        await deposit(cfd, seller, notionalAmount.plus(joinerFee()))
        const saleStrikePrice = strikePriceAdjusted.times(1.05)
        await cfd.sellPrepare(saleStrikePrice, 0, { from: seller })

        await assertStatus(cfd, STATUS.SALE)
        assertEqualBN(await cfd.sellerSaleStrikePrice.call(), saleStrikePrice)

        // cancel and check state set back to no sale
        await cfd.sellCancel({ from: seller })

        await assertStatus(cfd, STATUS.INITIATED)
        assert.isFalse(await cfd.sellerSelling.call())
        assert.equal(await cfd.sellerSaleStrikePrice.call(), 0)
      })

      it('buyer can update sale price', async () => {
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        await deposit(cfd, seller, notionalAmount.plus(joinerFee()))
        const saleStrikePrice = strikePriceAdjusted.times(1.05)
        await cfd.sellPrepare(saleStrikePrice, 0, { from: buyer })

        // update the sale price
        const newPrice = saleStrikePrice.times(1.1)
        await cfd.sellUpdate(newPrice, { from: buyer })
        assertEqualBN(await cfd.buyerSaleStrikePrice.call(), newPrice)
      })

      it('seller can update sale price', async () => {
        const cfd = await newCFD({ notionalAmount, isBuyer: true })
        await deposit(cfd, seller, notionalAmount.plus(joinerFee()))
        const saleStrikePrice = strikePriceAdjusted.times(1.05)
        await cfd.sellPrepare(saleStrikePrice, 0, { from: seller })

        // update the sale price
        const newPrice = saleStrikePrice.times(1.1)
        await cfd.sellUpdate(newPrice, { from: seller })

        assertEqualBN(await cfd.sellerSaleStrikePrice.call(), newPrice)
      })

      it('rejects buy after time limit expiry')
      it('allows buy before time limit expiry')
    })

    describe('topup and withdraw', async () => {
      before(async () => {
        await feeds.push(marketId, strikePriceAdjusted, nowSecs(), {
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
        await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral2X.plus(joinerFee()))
        assertEqualBN(await cfd.buyerDepositBalance.call(), collateral2X)
        assertEqualBN(await cfd.sellerDepositBalance.call(), collateral2X)

        const topupAmount = notionalAmount.dividedBy(4)
        const expectedAmount = collateral2X.plus(topupAmount)

        await daiToken.approve(cfd.address, topupAmount, { from: CREATOR_ACCOUNT })
        await cfd.topup(topupAmount, { from: CREATOR_ACCOUNT })
        assertEqualBN(await cfd.buyerDepositBalance.call(), expectedAmount)
        assertEqualBN(await cfd.sellerDepositBalance.call(), collateral2X)

        await daiToken.approve(cfd.address, topupAmount, { from: COUNTERPARTY_ACCOUNT })
        await cfd.topup(topupAmount, { from: COUNTERPARTY_ACCOUNT, topupAmount })
        assertEqualBN(await cfd.buyerDepositBalance.call(), expectedAmount)
        assertEqualBN(await cfd.sellerDepositBalance.call(), expectedAmount)
      })

      it('allows withdraw and returns money to callers', async () => {
        const collateral1X = notionalAmount
        const cfd = await newCFD({
          notionalAmount,
          isBuyer: true,
          daiValue: collateral1X
        })
        await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral1X.plus(joinerFee()))
        assertEqualBN(await cfd.buyerDepositBalance.call(), collateral1X)
        assertEqualBN(await cfd.sellerDepositBalance.call(), collateral1X)

        const withdrawAmount = notionalAmount.dividedBy(4)
        const expectedAmount = collateral1X.minus(withdrawAmount)

        const creatorBalBefore = await getBalance(CREATOR_ACCOUNT)
        const counterpartyBalBefore = await getBalance(COUNTERPARTY_ACCOUNT)

        const tx1 = await cfd.withdraw(withdrawAmount, {
          from: CREATOR_ACCOUNT
        })
        assertEqualBN(await cfd.buyerDepositBalance.call(), expectedAmount)
        assertEqualBN(await cfd.sellerDepositBalance.call(), collateral1X)
        assertEqualBN(
          await getBalance(CREATOR_ACCOUNT),
          creatorBalBefore.plus(withdrawAmount),
          'creator account balance incorrect'
        )

        const tx2 = await cfd.withdraw(withdrawAmount, {
          from: COUNTERPARTY_ACCOUNT
        })
        assertEqualBN(await cfd.buyerDepositBalance.call(), expectedAmount)
        assertEqualBN(await cfd.sellerDepositBalance.call(), expectedAmount)
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
        await deposit(cfd, COUNTERPARTY_ACCOUNT, collateral1X.plus(joinerFee()))
        assertEqualBN(
          await cfd.buyerDepositBalance.call(),
          collateral1X,
          'buyer deposit bal'
        )
        assertEqualBN(
          await cfd.sellerDepositBalance.call(),
          collateral1X,
          'seller deposit bal'
        )

        const withdrawAmountExceedsMin = collateral1X
          .minus(minimumCollateral)
          .plus(1) // 1 under the miniumum balance

        try {
          await cfd.withdraw(withdrawAmountExceedsMin, {
            from: CREATOR_ACCOUNT
          })
          assert.fail('expected reject withdraw')
        } catch (err) {
          assert.equal(`${REJECT_MESSAGE} collateralInRange false`, err.message)
        }

        try {
          await cfd.withdraw(withdrawAmountExceedsMin, {
            from: COUNTERPARTY_ACCOUNT
          })
          assert.fail('expected reject withdraw')
        } catch (err) {
          assert.equal(`${REJECT_MESSAGE} collateralInRange false`, err.message)
        }
      })
    })

  }).catch((err) => {
    console.log(err)
    process.exit(-1)
  })
})
