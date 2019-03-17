pragma solidity ^0.5.0;

/// @title Desing by contract (Hoare logic)
/// @author Melonport AG <team@melonport.com>
/// @notice Gives deriving contracts design by contract modifiers
contract DBC {

    // MODIFIERS

    modifier pre_cond(bool condition, string memory reason) {
        require(condition, reason);
        _;
    }

    modifier post_cond(bool condition) {
        _;
        assert(condition);
    }

    modifier invariant(bool condition, string memory reason) {
        require(condition, reason);
        _;
        assert(condition);
    }
}
