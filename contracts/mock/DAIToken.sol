pragma solidity ^0.4.23;
pragma experimental "v0.5.0";

import "openzeppelin-solidity/contracts/token/ERC20/StandardToken.sol";

contract DAIToken is StandardToken {
    string public constant symbol = "DAI";
    uint public constant initialSupply = 10000 * 1e18;

    constructor() public {
        totalSupply_ = initialSupply;
        balances[msg.sender] = initialSupply;
    }
}
