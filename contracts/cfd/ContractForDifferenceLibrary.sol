pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title Contract for difference
 *
 * Contract for difference for a given market between a
 * "buyer" (long position) and "seller" (short position).
 */
library ContractForDifferenceLibrary {
    using SafeMath for uint;

    uint internal constant FACTOR_UINT = 10 ** 20; // raise numbers to avoid fractions
    int  internal constant FACTOR_INT = int(FACTOR_UINT);

    uint internal constant MINIMUM_COLLATERAL_PERCENT = 20; // 5x leverage
    uint internal constant MAXIMUM_COLLATERAL_PERCENT = 500; // 0.2x leverage

    // 5% of collateral triggers a liquidate
    uint internal constant LIQUIDATE_THRESHOLD_PERCENT = 5;

    // 5% as 0.05 adjusted up by the FACTOR (to avoid a fraction)
    uint internal constant LIQUIDATE_THRESHOLD_PERCENT_RAISED = LIQUIDATE_THRESHOLD_PERCENT * FACTOR_UINT / 100;

    // Buyer and seller initial adjustment in cut off formulas.
    // Declare constants up here to save gas.
    uint constant BUYER_CUTOFF_ADJUSTMENT = (FACTOR_UINT * 105) / 100; // 1.05
    uint constant SELLER_CUTOFF_ADJUSTMENT = (FACTOR_UINT * 95) / 100; // 0.95


    /**
     * Creator fee - 0.3% of notional.
     */
    function creatorFee(uint _notional) internal pure returns (uint fee) {
        fee = percentOf(_notional, 3) / 10;
    }

    /**
     * Joiner (deposit or buy) percentage fee - 0.5% of notional.
     */
    function joinerFee(uint _notional) internal pure returns (uint fee) {
        fee = percentOf(_notional, 5) / 10;
    }

    /**
     * @dev Return a percentage change comparing a value with a new value.
     * @param _value The existing value to compare against
     * @param _newValue The new value to compare the change against
     * @return Percentage change (eg. _value = 100, _newValue = 90 then return 10)
     */
    function percentChange(uint _value, uint _newValue)
        internal
        pure
        returns (uint percent)
    {
        if (_value == _newValue) return 0;
        int changeAmount = int(_newValue) - int(_value);
        int percentInt = (changeAmount * 100) / int(_value);
        percent = uint((percentInt > 0) ? percentInt : -percentInt);
    }

    /**
     * @dev Return a percentage of a given amount.
     * @param _amount Amount to calculate the percentage of
     * @param _percent Percent amount (1 - 100)
     */
    function percentOf(uint _amount, uint _percent)
        internal
        pure
        returns (uint adjusted)
    {
        adjusted = (_amount * _percent) / 100;
    }

    /**
     * @dev Calculate the collateral amount for one party given the current
     *      market price and original strike price, notional amount and the
     *      amount the party has deposited into the contract.
     *
     * @param _strikePrice CFD strike price (S)
     * @param _marketPrice Current market price (P)
     * @param _notionalAmount CFD notional amount (N)
     * @param _depositBalance Balances of deposits into the contract
     * @param _isBuyer Buyer or Seller / Long or short party?
     *
     * @return collateral Amount of collateral for the party
     */
    function calculateCollateralAmount(
        uint _strikePrice,
        uint _marketPrice,
        uint _notionalAmount,
        uint _depositBalance,
        bool _isBuyer
    )
        internal
        pure
        returns (uint collateral)
    {
        // Formulas are:
        //     Cl = depositBalanceLong  + N * (P - S) / S
        //     Cs = depositBalanceShort - N * (P - S) / S
        // however we need to use a multiplication factor to avoid fractions in
        // solidity so these formulas are a little different to the above:
        int N = int(_notionalAmount) * FACTOR_INT;
        int So = int(_strikePrice);
        int P = int(_marketPrice);
        int D = int(_depositBalance);

        int difference = (
            N * (((P - So) * FACTOR_INT) / So) / FACTOR_INT
        ) / FACTOR_INT;
        int collateralInt = _isBuyer ? D + difference : D - difference;

        assert(collateralInt >= 0);
        collateral = uint(collateralInt);
    }

    function collateralInRange(
        uint _notionalAmount,
        uint _amount
    )
        internal
        pure
        returns (bool inRange)
    {
        inRange = (_amount >= percentOf(_notionalAmount, MINIMUM_COLLATERAL_PERCENT)) &&
            (_amount <= percentOf(_notionalAmount, MAXIMUM_COLLATERAL_PERCENT));
    }

    /**
     * @dev Calculate the cut off price for buyer or seller.
     *
     * This is the price that if passed would raise a liquidation event.
     *
     * Base Formulas are:
     *     Buyer:  1.05 * S - depositBalanceLong  * S / N
     *     Seller: 0.95 * S + depositBalanceShort * S / N
     *
     * However for Solidity we need to adjust parts by FACTOR_UINT to ensure
     * no fractions.
     *
     * @param _notionalAmountDai Contract notional amount
     * @param _depositBalance Balance of deposits for one party
     *
     * @return cut off price
     */

    function cutOffPrice(
        uint _notionalAmountDai,
        uint _depositBalance,
        uint _strikePrice,
        bool _calcForBuyerSide
    )
        internal
        pure
        returns (uint price)
    {
        // 1st part: Buyer: [1.05 * S] or Seller: [0.95 * S]
        uint strikePriceAdjuster = (_calcForBuyerSide) ?
            BUYER_CUTOFF_ADJUSTMENT :
            SELLER_CUTOFF_ADJUSTMENT;
        uint strikeFivePercent = (_strikePrice * strikePriceAdjuster) / FACTOR_UINT;


        // 2nd part: [depositBalance * S / N]
        uint difference = (
            _depositBalance * (_strikePrice * FACTOR_UINT) / _notionalAmountDai
        ) / FACTOR_UINT;

        // check for case where difference is greater (when buyer has deposits > notional)
        // in this case we set the price to 0
        if (_calcForBuyerSide && difference > strikeFivePercent)
            return 0;

        // finally: add or subtract the difference
        price = (_calcForBuyerSide) ?
            strikeFivePercent - difference :
            strikeFivePercent + difference;
    }

}
