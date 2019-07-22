pragma solidity ^0.5.0;

/*
 * Taken from: https://github.com/KyberNetwork/smart-contracts/blob/23a81c19/contracts/KyberNetworkProxyInterface.sol
 *
 * Modified:
 *   change ERC20 types to address
 *   format changes to quiet solium
 *   add 'memory' to hint parameter - new solc requirement
 *   change public to external - new solc requirement - must be external on interfaces
 */

interface KyberNetworkProxyInterface {
    function maxGasPrice() external view returns(uint);
    function getUserCapInWei(address user) external view returns(uint);
    function getUserCapInTokenWei(address user, address token) external view returns(uint);
    function enabled() external view returns(bool);
    function info(bytes32 id) external view returns(uint);

    function getExpectedRate(address src, address dest, uint srcQty) external view
        returns (uint expectedRate, uint slippageRate);

    function tradeWithHint(
        address src,
        uint srcAmount,
        address dest,
        address destAddress,
        uint maxDestAmount,
        uint minConversionRate,
        address walletId,
        bytes calldata hint
    ) external payable returns(uint);
}
