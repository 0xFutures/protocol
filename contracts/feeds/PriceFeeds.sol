pragma solidity ^0.5.0;

import "./PriceFeedsKyber.sol";

/**
 * Interface to market prices for the CFD contract.
 * Abstracts away the logic of reading from various market sources.
 */
contract PriceFeeds {
    string constant REASON_MARKET_INACTIVE_OR_UNKNOWN = "Price requested for inactive or unknown market";
    string constant REASON_MARKET_VALUE_ZERO = "Market price is zero";

    PriceFeedsKyber public feedKyber;

    constructor(address _kyber) public {
        feedKyber = PriceFeedsKyber(_kyber);
    }

    function read(bytes32 _marketId)
        public
        view
        returns (uint value)
    {
        if (feedKyber.isMarketActive(_marketId)) {
            value = feedKyber.read(_marketId);
        } else {
            revert(REASON_MARKET_INACTIVE_OR_UNKNOWN);
        }

        if (value == 0) {
            revert(REASON_MARKET_VALUE_ZERO);
        }
    }

    function marketName(bytes32 _marketId)
        public
        view
        returns (string memory name)
    {
        if (feedKyber.isMarketActive(_marketId)) {
            name = feedKyber.marketNames(_marketId);
        } else {
            revert(REASON_MARKET_INACTIVE_OR_UNKNOWN);
        }
    }

    function isMarketActive(bytes32 _marketId)
        public
        view
        returns (bool active)
    {
        active = false;
        if (feedKyber.isMarketActive(_marketId)) {
            active = true;
        }
    }

}
