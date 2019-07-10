pragma solidity ^0.5.0;

/**
 * Mock version of the KyberNetworkProxy contract for getting the
 * market rates in test and development.
 * see https://developer.kyber.network/docs/API_ABI-KyberNetworkProxy/
 */

contract KyberNetworkProxy {
    mapping(address => uint) rates;

    function getExpectedRate(address src, address dest, uint srcQty) public view
        returns (uint expectedRate, uint slippageRate)
    {
        uint rate = rates[address(dest)];
        return (rate, rate);
    }

    function put(address _tokenAddress, uint _rate) external {
        rates[_tokenAddress] = _rate;
    }

}
