const BigNumber = require('bignumber.js')
const {
  calculateCollateral,
  cutOffPrice,
  creatorFee,
  joinerFee
} = require('../src/calc')
const {assertEqualBN} = require('./helpers/assert')

const notional = new BigNumber('100000')
const strikePrice = new BigNumber('1000')
const buyerSide = true

describe('calc.js', () => {
  describe('calculateCollateral', () => {
    const deposit1X = notional
    const deposit5X = notional.dividedBy(5)

    const assertCollateral = (marketPrice, deposits, buyerSide, expected) =>
      assertEqualBN(
        calculateCollateral({
          strikePrice,
          marketPrice,
          notionalAmount: notional,
          depositBalance: deposits,
          calcBuyerSide: buyerSide
        }),
        expected
      )

    it('unchanged when no price change', () => {
      const marketPrice = strikePrice // market price unchanged

      const deposit1X = notional
      const expected1X = notional
      assertCollateral(marketPrice, deposit1X, buyerSide, expected1X)
      assertCollateral(marketPrice, deposit1X, !buyerSide, expected1X)

      const deposit5X = notional.dividedBy(5)
      const expected5X = notional.dividedBy(5)
      assertCollateral(marketPrice, deposit5X, buyerSide, expected5X)
      assertCollateral(marketPrice, deposit5X, !buyerSide, expected5X)
    })

    it('price rise at 1X', () => {
      const marketPrice = strikePrice.times(1.1) // market up 10%
      assertCollateral(
        marketPrice,
        deposit1X,
        buyerSide,
        deposit1X.times(1.1) // expect: collateral up 10%
      )
      assertCollateral(
        marketPrice,
        deposit1X,
        !buyerSide,
        deposit1X.times(0.9) // expect: collateral down 10%
      )
    })

    it('price fall at 1X', () => {
      const marketPrice = strikePrice.times(0.9) // market down 10%
      assertCollateral(
        marketPrice,
        deposit1X,
        buyerSide,
        deposit1X.times(0.9) // expect: collateral down 10%
      )
      assertCollateral(
        marketPrice,
        deposit1X,
        !buyerSide,
        deposit1X.times(1.1) // expect: collateral up 10%
      )
    })

    it('price rise at 5X', () => {
      const marketPrice = strikePrice.times(1.1) // market up 10%
      assertCollateral(
        marketPrice,
        deposit5X,
        buyerSide,
        deposit5X.times(1.5) // expect: collateral up 10%
      )
      assertCollateral(
        marketPrice,
        deposit5X,
        !buyerSide,
        deposit5X.times(0.5) // expect: collateral down 10%
      )
    })

    it('price fall at 5X', () => {
      const marketPrice = strikePrice.times(0.9) // market down 10%
      assertCollateral(
        marketPrice,
        deposit5X,
        buyerSide,
        deposit5X.times(0.5) // expect: collateral down 50%
      )
      assertCollateral(
        marketPrice,
        deposit5X,
        !buyerSide,
        deposit5X.times(1.5) // expect: collateral up 50%
      )
    })
  })

  describe('cutOffPrice', () => {
    // buyer
    it('1X buyer', () =>
      assertEqualBN(
        cutOffPrice({
          notionalAmount: notional,
          depositBalance: notional.dividedBy(1),
          strikePrice,
          buyerSide
        }),
        50,
        'cutOffPrice at 1x for buyer'
      ))
    it('2X buyer', () =>
      assertEqualBN(
        cutOffPrice({
          notionalAmount: notional,
          depositBalance: notional.dividedBy(2),
          strikePrice,
          buyerSide
        }),
        550,
        'cutOffPrice at 2x for buyer'
      ))
    it('5X buyer', () =>
      assertEqualBN(
        cutOffPrice({
          notionalAmount: notional,
          depositBalance: notional.dividedBy(5),
          strikePrice,
          buyerSide
        }),
        850,
        'cutOffPrice at 5x for buyer'
      ))
    it('0.5X buyer', () =>
      assertEqualBN(
        cutOffPrice({
          notionalAmount: notional,
          depositBalance: notional.dividedBy(0.5),
          strikePrice,
          buyerSide
        }),
        0,
        'cutOffPrice at 0.5x for buyer'
      ))

    // seller
    it('1X seller', () =>
      assertEqualBN(
        cutOffPrice({
          notionalAmount: notional,
          depositBalance: notional.dividedBy(1),
          strikePrice,
          buyerSide: !buyerSide
        }),
        1950,
        'cutOffPrice at 1x for seller'
      ))
    it('2X seller', () =>
      assertEqualBN(
        cutOffPrice({
          notionalAmount: notional,
          depositBalance: notional.dividedBy(2),
          strikePrice,
          buyerSide: !buyerSide
        }),
        1450,
        'cutOffPrice at 2x for seller'
      ))
    it('5X seller', () =>
      assertEqualBN(
        cutOffPrice({
          notionalAmount: notional,
          depositBalance: notional.dividedBy(5),
          strikePrice,
          buyerSide: !buyerSide
        }),
        1150,
        'cutOffPrice at 5x for seller'
      ))
    it('0.5X seller', () =>
      assertEqualBN(
        cutOffPrice({
          notionalAmount: notional,
          depositBalance: notional.dividedBy(0.5),
          strikePrice,
          buyerSide: !buyerSide
        }),
        2950,
        'cutOffPrice at 0.5x for seller'
      ))
  })

  describe('fee calculations', async () => {
    it('creatorFee() calculates correct fee', async () => {
      assertEqualBN(creatorFee(notional), notional.times(0.003))
    })

    it('joinerFee() calculates correct fee', async () => {
      assertEqualBN(joinerFee(notional), notional.times(0.005))
    })
  })
})
