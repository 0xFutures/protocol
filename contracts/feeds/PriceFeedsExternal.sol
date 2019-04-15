pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "../DBC.sol";


/**
 * Market prices feeds coming from external sources. 
 * External here means any contract outside the 0xfutures protocol contracts.
 * Examples: MakerDAO price feed, EtherDelta DEX price, etc.
 */
contract PriceFeedsExternal is DBC, Ownable {
    event LogPriceFeedsExternalMarketAdded(bytes32 indexed bytesId, string strId);
    event LogPriceFeedsExternalMarketRemoved(bytes32 indexed marketId);

    string constant REASON_MUST_BE_ACTIVE_MARKET = "Market must be active to push a value";
    string constant REASON_EXTERNAL_PRICE_CALL_FAILED = "External price call failed";

    struct Market {
        address priceContract;
        bytes32 callSig;
    }
    mapping(bytes32 => Market) markets;
    mapping(bytes32 => string) public marketNames;

    function isMarketActive(bytes32 _marketId) public view returns (bool) {
        return markets[_marketId].priceContract != address(0);
    }

    /**
     * Add a new market
     * @param _marketStrId String id of market. eg. "Poloniex_BTC_ETH"
     * @param _priceContract Address of contract to fetch price from
     * @param _callSig Call signature hash of the contract function to fetch 
     *                  the price from
     * @return marketId bytes32 keccak256 of the _marketStrId
     */
    function addMarket(
        string calldata _marketStrId, 
        address _priceContract, 
        bytes32 _callSig
    )
        external
        onlyOwner
        returns (bytes32 marketId)
    {
        marketId = keccak256(abi.encodePacked(_marketStrId));
        markets[marketId] = Market(_priceContract, _callSig);
        marketNames[marketId] = _marketStrId;
        emit LogPriceFeedsExternalMarketAdded(marketId, _marketStrId);
    }

    function removeMarket(bytes32 _marketId)
        external
        onlyOwner
        pre_cond(isMarketActive(_marketId), REASON_MUST_BE_ACTIVE_MARKET)
    {
        markets[_marketId] = Market(address(0x0), 0);
        emit LogPriceFeedsExternalMarketRemoved(_marketId);
    }

    function read(bytes32 _marketId) public view returns (uint priceValue) {
        Market storage market = markets[_marketId];

        bool success;
        bytes memory rspData;
        (success, rspData) = market.priceContract.staticcall(
            abi.encodePacked(market.callSig)
        );

        if (!success) {
            revert(REASON_EXTERNAL_PRICE_CALL_FAILED);
        }
        
        // TODO: assuming a bytes32 return convertable to uint here
        //   but shouldn't - generic unpack mechanism for other feeds workable?
        priceValue = abi.decode(rspData, (uint));
    }
}
