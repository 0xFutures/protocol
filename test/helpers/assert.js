import { assert } from 'chai'
import { web3 } from './setup'
import { BigNumber } from 'bignumber.js'

const assertEqualBN = (actual, expected, msg = 'numbers not equal') => {
  actual = new BigNumber(actual)
  assert.isTrue(
    actual.eq(expected),
    `
\tmsg: ${msg}
\tactual: ${actual.toString()}
\texpected: ${expected.toString()}
`
  )
}

/**
 * A case insensitve compare of 2 ethereum addresses.
 */
const assertEqualAddress = (actual, expected, msg = 'addresses not equal') =>
  assert.equal(actual.toLowerCase(), expected.toLowerCase(), msg)

// check log record correctly logged cfd/party in a LogCFDRegistryParty
const assertLoggedParty = (logRec, expectedCFD, expectedParty) => {
  const zeroPad24 = hexStr => `0x${'0'.repeat(24)}${hexStr.substring(2)}`
  assert.equal(
    logRec.topics[0],
    web3.utils.sha3('LogCFDRegistryParty(address,address)'),
    'logged party: topic wrong'
  )
  assert.equal(logRec.topics[1].toLowerCase(), zeroPad24(expectedCFD).toLowerCase(), 'logged party: cfd')
  assert.equal(
    logRec.topics[2].toLowerCase(),
    zeroPad24(expectedParty).toLowerCase(),
    'logged party: party'
  )
}

const assertStatus = async (cfd, expected) =>
  assert.equal(
    await cfd.methods.status().call(),
    expected,
    `status incorrect`
  )

export { assertEqualAddress, assertEqualBN, assertLoggedParty, assertStatus }
