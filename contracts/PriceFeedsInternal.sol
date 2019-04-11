pragma solidity ^0.5.0;


/**
 * Market prices feeds coming from 0xfutures managed price feeds. 
 * These are centralised feeds pushed on to the blockchain.
 * Example: Coinbase BTCUSD price feed
 */
 contract PriceFeedsInternal is Ownable {
    address public daemonAccount;

    function isDaemon() public view returns (bool);
    function setDaemonAccount(address _daemon) public onlyOwner;

    mapping(bytes32 => bool) public markets;
    mapping(bytes32 => string) public marketNames;

    function isMarketActive(bytes32 _marketId) public view returns (bool);
    function addMarket(string calldata _marketStrId) onlyOwner returns (bytes32 marketId);
    function removeMarket(bytes32 _marketId) onlyOwner;

    struct DataPoint {
        uint value;       // original value * (10**decimals)
        uint timestamp;   // UNIX milliseconds
    }
    mapping(bytes32 => DataPoint) latestData;

    function push(bytes32 _marketId, uint _value, uint _timestamp) isDaemon;
    function read(bytes32 _marketId) returns (uint value, uint timestamp);
}
