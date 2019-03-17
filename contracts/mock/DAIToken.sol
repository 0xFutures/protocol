pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

contract DAIToken is ERC20 {
    string public constant symbol = "DAI";
    uint public constant initialSupply = 10000 * 1e18;

    constructor() public {
        _mint(msg.sender, initialSupply);
    }
}
