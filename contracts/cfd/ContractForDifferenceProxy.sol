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

    /**
     * ContractForDifference.sellPrepare
     */
    function sellPrepare(
        ContractForDifference _cfd,
        uint _desiredStrikePrice,
        uint _timeLimit
    )
        external
    {
        _cfd.sellPrepare(_desiredStrikePrice, _timeLimit);
    }

    /**
     * ContractForDifference.sellUpdate
     */
    function sellUpdate(ContractForDifference _cfd, uint _newPrice) external {
        _cfd.sellUpdate(_newPrice);
    }

    /**
     * ContractForDifference.sellCancel
     */
    function sellCancel(ContractForDifference _cfd) external {
        _cfd.sellCancel();
    }

    /**
     * ContractForDifference.buy
     */
    function buy(
        ContractForDifference _cfd,
        ERC20 _daiToken,
        bool _buyBuyerSide,
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
        _cfd.buy(_buyBuyerSide, _value);
    }

    /**
     * ContractForDifference.topup
     */
    function topup(
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
        _cfd.topup(_value);
    }

    /**
     * ContractForDifference.withdraw
     */
    function withdraw(ContractForDifference _cfd, uint _value) external {
        _cfd.withdraw(_value);
    }

    /**
     * ContractForDifference.upgrade
     */
    function upgrade(ContractForDifference _cfd) external {
        _cfd.upgrade();
    }

    /**
     * ContractForDifference.transferPosition
     */
    function transferPosition(ContractForDifference _cfd, address _newAddress) external {
        _cfd.transferPosition(_newAddress);
    }

    /**
     * ContractForDifference.liquidateMutual
     */
    function liquidateMutual(ContractForDifference _cfd) external {
        _cfd.liquidateMutual();
    }

    /**
     * ContractForDifference.liquidateMutualCancel
     */
    function liquidateMutualCancel(ContractForDifference _cfd) external {
        _cfd.liquidateMutualCancel();
    }

    /**
     * ContractForDifference.forceTerminate
     */
    function forceTerminate(ContractForDifference _cfd) external {
        _cfd.forceTerminate();
    }

    /**
     * ContractForDifference.cancelNew
     */
    function cancelNew(ContractForDifference _cfd) external {
        _cfd.cancelNew();
    }


    /**
     * ContractForDifference.changeStrikePrice
     */
    function changeStrikePrice(ContractForDifference _cfd, uint _newPrice) external {
        _cfd.changeStrikePrice(_newPrice);
    }

}
