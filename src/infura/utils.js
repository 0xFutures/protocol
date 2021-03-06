const BigNumber = require('bignumber.js')
BigNumber.config({ DECIMAL_PLACES: 30 })

const EMPTY_ACCOUNT = '0x' + '0'.repeat(40)

const NUMBER_DECIMALS = 18

/**
 * Feed values must be passed around as Bignumbers or strings due to the 15
 * significant digit limitation of Javascript numbers.
 *
 * Functions expecting numbers should use this assertion to guarantee inputs.
 */
const assertBigNumberOrString = number => {
  if (!number || (number.isBigNumber === false && typeof number !== 'string')) {
    throw new Error('number can only be a BigNumber or String')
  }
}

/**
 * Convert number to format expected in the smart contract - adjust it by
 * 18 places such that 11.8209 becomes 11820900000000000000.
 *
 * @param number BigNumber|String Actual number to be converted
 * @return BigNumber contract format value
 */
const toContractBigNumber = number => {
  assertBigNumberOrString(number)
  const bn = new BigNumber(number)
  return bn.times(Math.pow(10, NUMBER_DECIMALS))
}

/**
 * The reverse of toContractBigNumber (See above)
 *
 * @param contractBigNumber BigNumber Contract format number to be adjusted
 * @return BigNumber original value
 */
const fromContractBigNumber = number => {
  assertBigNumberOrString(number)
  const bn = new BigNumber(number)
  return bn.div(new BigNumber(10).pow(NUMBER_DECIMALS))
}

const nowSecs = () => Math.floor(Date.now() / 1000)

const isValidMarketId = id => /^[A-Za-z]+_[A-Z]+_[A-Z]+$/i.test(id)

const isValidContractAddr = contractAddr => /^0x.+/i.test(contractAddr)

const isEthereumAddress = addr => /0x[a-f0-9]{40,}/i.test(addr)

// convert from 64 digit long to 40 digit long
const unpackAddress = packed => packed.replace(/x0{24}/, 'x')

const logGasOn = false
const logGas = (title, txReceipt) => {
  if (logGasOn) console.log(`${title}: ${txReceipt.gasUsed}`)
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
  status !== 1 && status !== '0x1' && status !== '0x01' && status !== true

/**
 * Mapping of values returned by ContractForDifference.status() function.
 */
const STATUS = {
  CREATED: 0,
  INITIATED: 1,
  SALE: 2,
  CLOSED: 3
}

/**
 * Helper function to sign and send a transaction when using mobile
 * @param {Web3} web3 The web3 instance
 * @param {Object} txParams Transaction object
 * @param {string} privateKey Private key used to sign transaction
 */
const signSendTransactionForMobile = (web3, txParams, privateKey) => {
  return new Promise((resolve, reject) => {
    try {
      web3.eth.accounts.signTransaction(txParams, privateKey).then((signedTx) => {
        const sentTx = web3.eth.sendSignedTransaction(signedTx.raw || signedTx.rawTransaction);
        sentTx.on('receipt', receipt => {
          // do something when receipt comes back
          return resolve(receipt);
        });
        sentTx.on('error', err => {
          // do something on transaction error
          return reject(err);
        });
      }, (err) => {
        return reject(err);
      });
    } catch(err) {
      return reject(err);
    }
  });
}

/*
 * Sign and send a raw transaction
 */
const signAndSendTransaction = (
  web3,
  account,
  privateKeyStr,
  contractAddr,
  data,
  gasPrice,
  pushGasLimit = 100000
) => {
  return new Promise(function (resolve, reject) {
    // Get the transaction count for the nonce
    web3.eth
      .getTransactionCount(account)
      .then(txCount => {
        // Create the transaction object to call the contract function
        const txObject = {
          nonce: web3.utils.toHex(txCount),
          gasLimit: web3.utils.toHex(pushGasLimit),
          gasPrice: web3.utils.toHex(gasPrice),
          to: contractAddr,
          data: data,
          from: account
        }
        // Sign the transaction
        web3.eth.accounts.signTransaction(
          txObject,
          privateKeyStr,
          (err, resp) => {
            if (err || resp == undefined || resp.rawTransaction == undefined)
              reject(err)
            else {
              // Send the transaction
              web3.eth
                .sendSignedTransaction(resp.rawTransaction)
                .once('receipt', function (receipt) {
                  // Transaction has been mined
                  console.log('[API-Infura] Transaction mined!')
                  resolve(receipt)
                })
                .on('error', function (error) {
                  // Error
                  reject(error)
                })
            }
          }
        )
      })
      .catch(err => {
        reject(err)
      })
  })
}

/* List of all the events with its hash
 * Used to reverse match
 * (While waiting for web3 to be fixed...)
 */
const EVENTS = {
  '0xa5a61bd6a6ada80224b49aa7fae9b176c38f70934cfc65e1c34495527cd91e23':
    'LogPriceFeedsKyberMarketAdded',
  '0xb54c2b8928a495bb6488be8bfd8a852a5815f53d28e2c454b49f5635e5d1d6a8':
    'LogPriceFeedsKyberMarketRemoved',
  '0x2d0c41699a808fef3dcfaa411d95703031d69229e73f5f3299fd6045deb4f962':
    'LogCFDFactoryNew',
  '0xe77178664194a5b1c28f6ee0f3fcb6d4404d796abfdf7edee18b68617768f48a':
    'LogCFDFactoryNewByUpgrade',
  '0x5180589a8efb07c77a3318d1c34775bb649df9d3e93ac2a75a8e9747e3aaccd4':
    'LogCFDRegistryParty',
  '0xd58bd0566ead9ed32659fb925d8d03f4bc085d137fafff69ba9d390275a6eaaf':
    'LogCFDRegistryNew',
  '0x15d100e262556a93dd6558ac262964e8c338b642a9a6530ee29521879cfb9f1a':
    'LogCFDRegistrySale'
}
/* Return the events, and filter with the event name
 * @param eventName, the event name used to filter (e.g. LogFeedsPush)
 *        if left to undefined, all the events will be returned
 * @param contractInstance, the web3 contract instance
 * @param fromBlock, block number where we start looking for (default to 0)
 */
const getAllEventsWithName = (
  eventName,
  contractInstance,
  fromBlock = 0,
  toBlock = 'latest'
) => {
  return new Promise((resolve, reject) => {
    contractInstance.getPastEvents(
      'allEvents',
      { fromBlock: fromBlock, toBlock: toBlock },
      (error, events) => {
        // If there is an error
        if (error || events == undefined) reject(error)
        else {
          // Filter the events (using the topics array for now, since event name is missing)
          events = events.filter(function (ev) {
            if (
              ev == undefined ||
              ev.raw == undefined ||
              ev.raw.topics == undefined ||
              ev.raw.topics.length <= 0 ||
              (EVENTS[ev.raw.topics[0]] == undefined && eventName != undefined)
            )
              return false
            // Check event is the one we are looking for
            return (
              eventName == undefined ||
              EVENTS[ev.raw.topics[0].toLowerCase()] == eventName
            )
          })
          resolve(events)
        }
      }
    )
  })
}

// For web3 latest version, use this instead:
//    contract.jsonInterface.abi.methods[fnName].signature
const getFunctionSignature = (contract, fnName) =>
  contract._jsonInterface.find(el => el.name === fnName).signature

module.exports = {
  assertBigNumberOrString,
  fromContractBigNumber,
  isEthereumAddress,
  isValidMarketId,
  nowSecs,
  toContractBigNumber,
  logGas,
  txFailed,
  EMPTY_ACCOUNT,
  STATUS,
  getAllEventsWithName,
  getFunctionSignature,
  signAndSendTransaction,
  signSendTransactionForMobile,
  unpackAddress,
  isValidContractAddr
}
