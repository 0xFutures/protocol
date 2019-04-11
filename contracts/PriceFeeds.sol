pragma solidity ^0.5.0;

import "./PriceFeedsInternal.sol";
import "./PriceFeedsExternal.sol";

/**
 * Interface to market prices for the CFD contract.
 * Abstracts away the logic of reading from various market sources.
 */
contract PriceFeeds {
    mapping(bytes32 => bool) public marketIsInternal;

    PriceFeedsInternal feedInternal;
    PriceFeedsExternal feedExternal;

    function read(bytes32 _marketId) returns (uint value) {
        return (marketIsInternal[_marketId]) ? 
            feedInternal.read(_marketId) :
            feedExternal.read(_marketId);
    }
}
