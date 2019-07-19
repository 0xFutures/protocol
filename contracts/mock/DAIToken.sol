pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

/**
 * Mock DAIToken for test and development.
 */
contract DAIToken is ERC20 {
    string public constant symbol = "DAI";
    uint public constant initialSupply = 1e6 * 1e18; // 1 million DAI

    constructor() public {
        _mint(msg.sender, initialSupply);
    }
}
