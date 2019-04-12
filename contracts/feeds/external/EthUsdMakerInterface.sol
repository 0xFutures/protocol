pragma solidity ^0.5.0;

/**
 * MakerDAO medianizer contract for the ETHUSD price.
 * Mainnet: 0x729D19f657BD0614b4985Cf1D82531c67569197B
 * Kovan: 0xa5aA4e07F5255E14F02B385b1f04b35cC50bdb66
 */
contract EthUsdMakerInterface {
    function read() public view returns (bytes32);
}
