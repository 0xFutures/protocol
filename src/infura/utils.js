var Tx = require('ethereumjs-tx')

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
  const bn = new BigNumber(contractBigNumber)
  return bn.div(new BigNumber(10).pow(numDecimals))
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

/*
 * Sign and send a raw transaction
 */
const signAndSendTransaction = (web3, account, privateKeyStr, contractAddr, data, gasPrice, chainId, pushGasLimit = 100000) => {
  return new Promise(function(resolve, reject) {
    // Get the transaction count for the nonce
    web3.eth.getTransactionCount(account).then((txCount) => {
      // Create the transaction object to call the contract function
      const txObject = {
        nonce: web3.utils.toHex(txCount),
        gasLimit: web3.utils.toHex(pushGasLimit),
        gasPrice: web3.utils.toHex(gasPrice),
        to: contractAddr,
        data: data,
        chainId: chainId,
        from: account
      }
      // Sign the transaction
      web3.eth.accounts.signTransaction(txObject, privateKeyStr, (err, resp) => {
        if (err || resp == undefined || resp.rawTransaction == undefined)
          reject(err);
        else {
          // Send the transaction
          web3.eth.sendSignedTransaction(resp.rawTransaction).once('receipt', function(receipt) {
            // Transaction has been mined
            console.log("[API-Infura] Transaction mined!");
            resolve(receipt);
          }).on('error', function(error) {
            // Error
            reject(error);
          });
        }
      });
    }).catch((err) => {
      reject(err);
    })
  });
}


/* List of all the events with its hash
 * Used to reverse match
 * (While waiting for web3 to be fixed...)
 */
const EVENTS = {
  '0xec0192f611133301ab5dd94a415ca4ed865668ca2f52cceee52eaa561044bafa': 'LogFeedsMarketAdded',
  '0x1de4d777747a0fae0f827374bf2373391fee95df6f6fc3e24af9c7ca46ecd372': 'LogFeedsMarketRemoved',
  '0x62a9ea16f13bd1758296411634390e5cfe2b3879cb368388a74714a03698cbd9': 'LogFeedsPush',
  '0x2d0c41699a808fef3dcfaa411d95703031d69229e73f5f3299fd6045deb4f962': 'LogCFDFactoryNew',
  '0xe77178664194a5b1c28f6ee0f3fcb6d4404d796abfdf7edee18b68617768f48a': 'LogCFDFactoryNewByUpgrade',
  '0x5180589a8efb07c77a3318d1c34775bb649df9d3e93ac2a75a8e9747e3aaccd4': 'LogCFDRegistryParty',
  '0xd58bd0566ead9ed32659fb925d8d03f4bc085d137fafff69ba9d390275a6eaaf': 'LogCFDRegistryNew',
  '0x15d100e262556a93dd6558ac262964e8c338b642a9a6530ee29521879cfb9f1a': 'LogCFDRegistrySale'
}
/* Return the events, and filter with the event name
 * @param eventName, the event name used to filter (e.g. LogFeedsPush)
 *        if left to undefined, all the events will be returned
 * @param contractInstance, the web3 contract instance
 * @param fromBlock, block number where we start looking for (default to 0)
 */
const getAllEventsWithName = (eventName, contractInstance, fromBlock = 0, toBlock = 'latest') => {
  return new Promise((resolve, reject) => {
    contractInstance.getPastEvents('allEvents', {fromBlock: fromBlock, toBlock: toBlock}, (error, events) => {
      // If there is an error
      if (error || events == undefined)
        reject(error);
      else {
        // Filter the events (using the topics array for now, since event name is missing)
        events = events.filter(function(ev) {
          if (ev == undefined || ev.raw == undefined || ev.raw.topics == undefined || ev.raw.topics.length <= 0 || EVENTS[ev.raw.topics[0]] == undefined)
            return false;
          // Check event is the one we are looking for
          return (eventName == undefined || EVENTS[ev.raw.topics[0].toLowerCase()] == eventName);
        });
        resolve(events);
      }
    });
  });
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
  STATUS,
  getAllEventsWithName,
  signAndSendTransaction
}
