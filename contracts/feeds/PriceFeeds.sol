pragma solidity ^0.5.0;

import "./PriceFeedsInternal.sol";
import "./PriceFeedsExternal.sol";

/**
 * Interface to market prices for the CFD contract.
 * Abstracts away the logic of reading from various market sources.
 */
contract PriceFeeds is Ownable {
    string constant REASON_MARKET_INACTIVE_OR_UNKNOWN = "Price requested for inactive or unknown market";

    PriceFeedsInternal feedInternal;
    PriceFeedsExternal feedExternal;

    constructor(address _internal, address _external) public {
        feedInternal = PriceFeedsInternal(_internal);
        feedExternal = PriceFeedsExternal(_external);
    }

    function read(bytes32 _marketId)
        public 
        view 
        returns (uint value) 
    {
        if (feedInternal.isMarketActive(_marketId)) {
            (value, ) = feedInternal.read(_marketId);
        } else if (feedExternal.isMarketActive(_marketId)) {
            value = feedExternal.read(_marketId);
        } else {
            revert(REASON_MARKET_INACTIVE_OR_UNKNOWN);
        }
    }

    function marketName(bytes32 _marketId) 
        public 
        view 
        returns (string memory name) 
    {
        if (feedInternal.isMarketActive(_marketId)) {
            name = feedInternal.marketNames(_marketId);
        } else if (feedExternal.isMarketActive(_marketId)) {
            name = feedExternal.marketNames(_marketId);
        } else {
            revert(REASON_MARKET_INACTIVE_OR_UNKNOWN);
        }
    }

}
