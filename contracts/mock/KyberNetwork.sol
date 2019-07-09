pragma solidity ^0.5.0;

/**
 * Mock version of the KyberNetwork contract for getting the
 * market rates in test and development.
 */

// solium-disable no-empty-blocks
interface ERC20 {}

contract KyberNetwork {
    mapping(address => uint) rates;

    function getExpectedRateOnlyPermission(ERC20 src, ERC20 dest, uint srcQty)
        public
        view
        returns (uint expectedRate, uint slippageRate)
    {
        uint rate = rates[address(dest)];
        return (rate, rate);
    }

    function put(address _tokenAddress, uint _rate) external {
        rates[_tokenAddress] = _rate;
    }

}
