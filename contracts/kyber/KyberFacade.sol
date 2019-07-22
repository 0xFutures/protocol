pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "../Registry.sol";
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
    uint constant MAX_DEST_AMOUNT = 1e18 * 1e9; // 1 billion DAI

    /*
     * State
     */

    Registry public registry;
    address kyberWalletId;

    constructor(address _registry, address _kyberWalletId) public {
        setRegistry(_registry);
        setKyberWalletId(_kyberWalletId);
    }

    function setRegistry(address _registry) public onlyOwner {
        registry = Registry(_registry);
    }

    function setKyberWalletId(address _kyberWalletId) public onlyOwner {
        kyberWalletId = _kyberWalletId;
    }

    /**
     * Trade ETH for DAI with:
     *  - only permissioned reserves
     *  - 0xfutures kyber wallet id
     *  - a maximum 2% slip from the current expected rate
     *  - an unreachable maximum destination token amount (effectively no max)
     *
     * @param _destAddress Receiver of DAI tokens
     */
    function ethToDai(address _destAddress)
        public
        payable
        returns (uint destAmount)
    {
        address daiToken = address(registry.getDAI());
        (uint currentExpectedRate,) = registry.getKyberNetworkProxy().getExpectedRate(
            NATIVE_ETH,
            daiToken,
            msg.value
        );
        destAmount = registry.getKyberNetworkProxy().tradeWithHint.value(msg.value)(
            NATIVE_ETH, // src token - ETH
            msg.value, // ETH amount
            daiToken, // dest token - DAI
            _destAddress, // DAI transferred to here
            MAX_DEST_AMOUNT,
            currentExpectedRate / 100 * 98, // allow a maximum 2% slip
            kyberWalletId, // will receive 30% of fees in KNC
            PERMISSIONED_ONLY_HINT
        );
    }

    /**
     * Get the expected ETH to DAI rate for the next trade
     * (see getExpectedRate for details).
     * @param _ethValue An amount of ETH to get the expected rate for.
     */
    function daiRate(uint _ethValue)
        public
        view
        returns (uint rate)
    {
        (rate,) = registry.getKyberNetworkProxy().getExpectedRate(
            NATIVE_ETH,
            address(registry.getDAI()),
            _ethValue
        );
    }
}
