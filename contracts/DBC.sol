pragma solidity ^0.4.23;
pragma experimental "v0.5.0";

/// @title Desing by contract (Hoare logic)
/// @author Melonport AG <team@melonport.com>
/// @notice Gives deriving contracts design by contract modifiers
contract DBC {

    // MODIFIERS

    modifier pre_cond(bool condition, string reason) {
        require(condition, reason);
        _;
    }

    /* 
     * SOLIUM DISABLE: intentional require without reason. See comments in
     * ContractForDifference.sol for explanation of gas limit restricting
     * including reasons in all require/reverts 
     */
     
    /* solium-disable error-reason */
    modifier pre_cond_no_msg(bool condition) {
        require(condition);
        _;
    }

    modifier post_cond(bool condition) {
        _;
        assert(condition);
    }

    modifier invariant(bool condition) {
        require(condition);
        _;
        assert(condition);
    }
}
