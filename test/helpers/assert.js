import {assert} from 'chai'
import {web3} from './setup'

const assertEqualBN = (actual, expected, msg = 'numbers not equal') => {
  assert.isTrue(
    actual.equals(expected),
    `
\tmsg: ${msg}
\tactual: ${actual.toString()}
\texpected: ${expected.toString()}
`
  )
}

// check log record correctly logged cfd/party in a LogCFDRegistryParty
const assertLoggedParty = (logRec, expectedCFD, expectedParty) => {
  const zeroPad24 = hexStr => `0x${'0'.repeat(24)}${hexStr.substring(2)}`
  assert.equal(
    logRec.topics[0],
    web3.sha3('LogCFDRegistryParty(address,address)'),
    'logged party: topic wrong'
  )
  assert.equal(logRec.topics[1], zeroPad24(expectedCFD), 'logged party: cfd')
  assert.equal(
    logRec.topics[2],
    zeroPad24(expectedParty),
    'logged party: party'
  )
}

const assertStatus = async (cfd, expected) =>
  assert.equal(
    (await cfd.status.call()).toNumber(),
    expected,
    `status incorrect`
  )

export {assertEqualBN, assertLoggedParty, assertStatus}
