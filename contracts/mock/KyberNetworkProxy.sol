pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

/**
 * Mock version of the KyberNetworkProxy contract for getting the
 * market rates in test and development.
 * see https://developer.kyber.network/docs/API_ABI-KyberNetworkProxy/
 */

contract KyberNetworkProxy {
    ERC20 public daiToken;

    mapping(address => uint) public rates;

    constructor(address _daiToken) public {
        daiToken = ERC20(_daiToken);
    }

    function getExpectedRate(
        address,
        address dest,
        uint
    )
        public
        view
        returns (uint expectedRate, uint slippageRate)
    {
        uint rate = rates[address(dest)];
        return (rate, rate);
    }

    function tradeWithHint(
        address src,
        uint srcAmount,
        address dest,
        address destAddress,
        uint,
        uint,
        address,
        bytes memory
    )
        public
        payable
        returns(uint destAmount)
    {
        (uint rate,) = getExpectedRate(src, dest, srcAmount);
        destAmount = rate * srcAmount;
        daiToken.transfer(destAddress, destAmount);
    }

    function put(address _tokenAddress, uint _rate) external {
        rates[_tokenAddress] = _rate;
    }

}
