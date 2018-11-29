const BigNumber = require('bignumber.js')
BigNumber.config({DECIMAL_PLACES: 30})

const EMPTY_ACCOUNT = '0x' + '0'.repeat(40)

/**
 * Feed values must be passed around as Bignumbers or strings due to the 15
 * significant digit limitation of Javascript numbers.
 *
 * Functions expecting numbers should use this assertion to guarantee inputs.
 */
const assertBigNumberOrString = number => {
  if (number.isBigNumber === false && typeof number !== 'string') {
    throw new Error('number can only be a BigNumber or String')
  }
}

/**
 * Convert number to format expected in the smart contract - Adjust it by
 * numDecimals places such that 11.8209 becomes 11820900000000000000 if
 * numDecimals is 18.
 *
 * @param number BigNumber|String Actual number to be converted
 * @param numDecimals Number of decimals to adjust (see Feeds.sol decimals)
 * @return BigNumber contract format value
 */
const toContractBigNumber = (number, numDecimals) => {
  assertBigNumberOrString(number)
  const bn = new BigNumber(number)
  return bn.times(Math.pow(10, numDecimals))
}

/**
 * The reverse of toContractBigNumber (See above)
 *
 * @param contractBigNumber BigNumber Contract format number to be adjusted
 * @param numDecimals Number of decimals to adjust (see Feeds.sol decimals)
 * @return BigNumber original value
 */
const fromContractBigNumber = (contractBigNumber, numDecimals) => {
  assertBigNumberOrString(contractBigNumber)
  return contractBigNumber.div(new BigNumber(10).pow(numDecimals))
}

const nowSecs = () => Math.floor(Date.now() / 1000)

const isValidMarketId = id => /^[A-Za-z]+_[A-Z]+_[A-Z]+$/i.test(id)

const isEthereumAddress = addr => /0x[a-f0-9]{40,}/i.test(addr)

const txGas = txReceipt => txReceipt.receipt.gasUsed

// extract the gas cost in wei for a given transaction
const txGasCost = (txHash, web3) => {
  const {gasPrice} = web3.eth.getTransaction(txHash)
  const {gasUsed} = web3.eth.getTransactionReceipt(txHash)
  return gasPrice.times(gasUsed)
}

/**
 * Determine if the given status is a failure status or not.
 * Different Ethereum clients return the status in different ways.
 * So check all the possible formats of a success status here.
 *
 * @param string|number Transaction status as stored in a transaction receipt object
 * @return bool  True if the transaction failed
 */
const txFailed = status =>
  status !== 1 && status !== '0x1' && status !== '0x01'

/**
 * Mapping of values returned by ContractForDifference.status() function.
 */
const STATUS = {
  CREATED: 0,
  INITIATED: 1,
  SALE: 2,
  CLOSED: 3
}

module.exports = {
  assertBigNumberOrString,
  fromContractBigNumber,
  isEthereumAddress,
  isValidMarketId,
  nowSecs,
  toContractBigNumber,
  txGas,
  txGasCost,
  txFailed,
  EMPTY_ACCOUNT,
  STATUS
}
