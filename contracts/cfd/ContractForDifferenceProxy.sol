pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./ContractForDifference.sol";
import "./ContractForDifferenceFactory.sol";


contract ContractForDifferenceProxy {

    string constant REASON_PROXY_NEEDS_FUNDS = "Proxy needs to obtain amount from the sender";

    /**
     * ContractForDifferenceFactory.createContract
     */
    function createContract(
        ContractForDifferenceFactory _cfdf,
        ERC20 _daiToken,
        bytes32 _marketId,
        uint _strikePrice,
        uint _notionalAmountDai,
        bool _isBuyer,
        uint _value
    )
        external
        returns (ContractForDifference cfd)
    {
        require(
            _daiToken.transferFrom(msg.sender, address(this), _value), 
            REASON_PROXY_NEEDS_FUNDS
        );
        if (_daiToken.allowance(address(this), address(_cfdf)) < _value) {
            _daiToken.approve(address(_cfdf), uint(-1));
        }
        cfd = _cfdf.createContract(
            _marketId, 
            _strikePrice, 
            _notionalAmountDai, 
            _isBuyer, 
            _value
        );
    }

    /**
     * ContractForDifference.deposit
     */
    function deposit(
        ContractForDifference _cfd,
        ERC20 _daiToken,
        uint _value
    )
        external
    {
        require(
            _daiToken.transferFrom(msg.sender, address(this), _value), 
            REASON_PROXY_NEEDS_FUNDS
        );
        if (_daiToken.allowance(address(this), address(_cfd)) < _value) {
            _daiToken.approve(address(_cfd), uint(-1));
        }
        _cfd.deposit(_value);
    }

}
