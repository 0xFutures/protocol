pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "./DBC.sol";


contract Feeds is DBC, Ownable {

    event LogFeedsMarketAdded(bytes32 indexed bytesId, string strId);
    event LogFeedsMarketRemoved(bytes32 indexed marketId);
    event LogFeedsPush(bytes32 indexed marketId, uint indexed timestamp, uint value);

    string constant REASON_MUST_BE_FROM_DAEMON = "Caller must be the registered Daemon";
    string constant REASON_MUST_BE_ACTIVE_MARKET = "Market must be active to push a value";
    string constant REASON_FALLBACK = "Can't call fallback function";

    /**
     * As solidity doesn't support storing floats we'll store values as integers
     * adjusted by a predetermined number of decimals.
     *
     * For example if decimals is 18 then:
     *  1.23456789 is stored as 1234567890000000000.
     *
     * For now we have one fixed for all markets. Later we'll likely need to
     * support a different number for some markets.
     */
    uint public decimals = 30;


    /**
     * Active markets - market active if markets[market_id] is true
     */
    mapping(bytes32 => bool) public markets;

    function isMarketActive(bytes32 _marketId) public view returns (bool) {
        return markets[_marketId];
    }

    /**
     * Mapping from the market id to the string form. eg. "Poloniex_BTC_ETH"
     */
    mapping(bytes32 => string) public marketNames;


    /**
     * Daemon - account that pushes new price feed values
     */
    address public daemonAccount;

    function isDaemon() public view returns (bool) {
        return msg.sender == daemonAccount;
    }

    function setDaemonAccount(address _daemon) public onlyOwner {
        daemonAccount = _daemon;
    }


    /**
     * Feed data - by market
     */
    struct DataPoint {
        uint value;       // original value * (10**decimals)
        uint timestamp;   // UNIX milliseconds
    }
    mapping(bytes32 => DataPoint) latestData;


    /**
     * Push value and timestamp of read into the contract.
     * @param _value Read value * (10^decimals). See decimal description above.
     * @param _timestamp UNIX milliseconds timestamp of the read
     */
    function push(
        bytes32 _marketId,
        uint _value,
        uint _timestamp
    )
        external
        pre_cond(isDaemon(), REASON_MUST_BE_FROM_DAEMON)
        pre_cond(isMarketActive(_marketId), REASON_MUST_BE_ACTIVE_MARKET)
    {
        latestData[_marketId] = DataPoint(_value, _timestamp);
        emit LogFeedsPush(_marketId, _timestamp, _value);
    }

    /**
     * Read the latest value and timestamp from the contract.
     */
    function read(bytes32 _marketId)
        external
        view
        pre_cond(isMarketActive(_marketId), REASON_MUST_BE_ACTIVE_MARKET)
        returns (uint value, uint timestamp)
    {
        return readInternal(_marketId);
    }

    function readInternal(bytes32 _marketId)
        internal
        view
        returns (uint value, uint timestamp)
    {
        value = latestData[_marketId].value;
        timestamp = latestData[_marketId].timestamp;
    }


    /**
     * Add a new market
     * @param _marketStrId String id of market something like "Poloniex_BTC_ETH"
     * @return marketId bytes32 keccak256 of the _marketStrId
     */
    function addMarket(string calldata _marketStrId)
        external
        onlyOwner
        returns (bytes32 marketId)
    {
        marketId = keccak256(abi.encodePacked(_marketStrId));
        markets[marketId] = true;
        marketNames[marketId] = _marketStrId;
        emit LogFeedsMarketAdded(marketId, _marketStrId);
    }

    /**
     * Removes a market.
     */
    function removeMarket(bytes32 _marketId)
        external
        onlyOwner
        pre_cond(isMarketActive(_marketId), REASON_MUST_BE_ACTIVE_MARKET)
    {
        markets[_marketId] = false;
        latestData[_marketId] = DataPoint(0, 0);
        emit LogFeedsMarketRemoved(_marketId);
        // TODO: provide a withdraw and mark balances
    }

    // Disable the fallback
    function () external {
        revert(REASON_FALLBACK);
    }

}
