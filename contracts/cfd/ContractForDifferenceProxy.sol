pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./ContractForDifference.sol";
import "./ContractForDifferenceFactory.sol";


contract ContractForDifferenceProxy {
    event LogBlah();

    string constant REASON_PROXY_NEEDS_FUNDS = "Proxy needs to obtain amount from the sender";

    /**
     * Proxy to ContractForDifferenceFactory.createContract
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

    function justLog() external {
        emit LogBlah();
    }

}
