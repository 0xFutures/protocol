pragma solidity ^0.5.0;

/**
 * Market prices feeds coming from external sources. 
 * External here means any contract outside the 0xfutures protocol contracts.
 * Examples: MakerDAO price feed, EtherDelta DEX price, etc.
 */
contract PriceFeedsExternal is Ownable {
    struct Market {
        address priceContract;
        bytes32 callSig;
    }
    mapping(bytes32 => Market) markets;
    mapping(bytes32 => string) public marketNames;

    function isMarketActive(bytes32 _marketId) public view returns (bool);
    function addMarket(string calldata _marketStrId, address _priceContract, bytes32 _callsig) onlyOwner;
    function removeMarket(bytes32 _marketId) onlyOwner;

    /**
     * market = markets[_marketId]
     * market.staticcall(market.callSig)
     */
    function read(bytes32 _marketId) returns (uint value);
}
