pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "./KyberNetworkProxyInterface.sol";

/**
 * A facade for 0xfutures interactions with the Kyber network contracts.
 *
 * Interfacing with KyberNetworkProxy:
 * https://developer.kyber.network/docs/API_ABI-KyberNetworkProxy/
 */

contract KyberFacade is Ownable {

    /*
     * Constants
     */

    // Use only permissioned reserves
    bytes constant PERMISSIONED_ONLY_HINT = bytes("PERM");

    // Denotes native ETH in Kyber
    address constant NATIVE_ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // Kyber trades require a non 0 maximum destination amount. Since we don't
    // need to restrict on a maximum set it to a very large amount that won't
    // be hit
    uint constant MAX_DEST_AMOUNT = 10**18 * 10**9; // 1 billion DAI

    /*
     * State
     */

    KyberNetworkProxyInterface kyber;
    address kyberWalletId;


    constructor(
        address _kyberNetworkProxyAddr,
        address _kyberWalletId
    ) public {
        kyber = KyberNetworkProxyInterface(_kyberNetworkProxyAddr);
        kyberWalletId = _kyberWalletId;
    }


    /**
     * Trade ETH for DAI with:
     *  - only permissioned reserves
     *  - 0xfutures kyber wallet id
     *  - a maximum 2% slip from the current expected rate
     *  - an unreachable maximum destination token amount (effectively no max)
     *
     * @param _daiToken DAI ERC20 token contract address
     * @param _destAddress Receiver of DAI tokens
     */
    function ethToDai(
        address _daiToken,
        address _destAddress
    )
        public
        payable
        returns (uint destAmount)
    {
        (uint currentExpectedRate,) = kyber.getExpectedRate(
            NATIVE_ETH,
            _daiToken,
            msg.value
        );
        destAmount = kyber.tradeWithHint(
            NATIVE_ETH, // src token - ETH
            msg.value, // ETH amount
            _daiToken, // dest token - DAI
            _destAddress, // DAI transferred to here
            MAX_DEST_AMOUNT,
            currentExpectedRate / 100 * 98, // allow a maximum 2% slip
            kyberWalletId, // will receive 30% of fees in KNC
            PERMISSIONED_ONLY_HINT
        );
    }
}
