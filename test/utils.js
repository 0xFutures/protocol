const { assert } = require('chai')
const BigNumber = require('bignumber.js')
const {
  fromContractBigNumber,
  toContractBigNumber,
  isValidMarketId,
  txGas
} = require('../src/infura/utils')
const { assertEqualBN } = require('./helpers/assert')

describe('utils.js', () => {
  // TEST DATA
  const acutalValue = new BigNumber('11.8209')
  const contractAdjustedValue = new BigNumber(
    '11820900000000000000'
  )

  it('fromContractBigNumber() should adjust a contract stored value back to the actual value', () => {
    assertEqualBN(
      fromContractBigNumber(contractAdjustedValue),
      acutalValue
    )
  })

  it('toContractBigNumber() should adjust a read value to contract format', () => {
    assertEqualBN(
      toContractBigNumber(acutalValue),
      contractAdjustedValue
    )
  })

  it('txGas() should pull the gasUsed amount out of a transaction receipt', () => {
    assert.equal(txGas({ receipt: { gasUsed: 66000 } }), 66000)
  })

  it('isValidMarketId() should correctly validate market id strings', () => {
    assert.isTrue(isValidMarketId('Poloniex_ETH_USD'))
    assert.isTrue(isValidMarketId('Kraken_XLM_BTC'))

    assert.isFalse(isValidMarketId())
    assert.isFalse(isValidMarketId(''))
    assert.isFalse(isValidMarketId(null))

    assert.isFalse(isValidMarketId('ETH'))
    assert.isFalse(isValidMarketId('ETH_USD'))
    assert.isFalse(isValidMarketId('ETH_USD_'))
    assert.isFalse(isValidMarketId('ETH_USD_1_2'))
  })
})
