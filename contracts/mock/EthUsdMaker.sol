pragma solidity ^0.5.0;

/**
 * Mock version of the MakerDAO medianizer price feeds contract for getting the
 * ETHUSD price in test and development.
 *
 * See also interface contracts/feeds/EthUsdMakerInterface.sol.
 */
contract EthUsdMaker {
    bytes32 price;

    function read() public view returns (bytes32) {
        return price;
    }

    function put(bytes32 _price) external {
        price = _price;
    }
    
}
