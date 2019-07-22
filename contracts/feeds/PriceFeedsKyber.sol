pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "../DBC.sol";


/**
 * Market prices from the Kyber Network:
 * https://developer.kyber.network/docs/API_ABI-KyberNetworkProxy/
 */
contract PriceFeedsKyber is DBC, Ownable {
    event LogPriceFeedsKyberMarketAdded(bytes32 indexed bytesId, string strId);
    event LogPriceFeedsKyberMarketRemoved(bytes32 indexed marketId);

    string constant REASON_MUST_BE_ACTIVE_MARKET = "Market must be active to push a value";
    string constant REASON_KYBER_PRICE_CALL_FAILED = "Kyber price call failed";

    /* Adding this bit to the srcQty excludes permissionless reserves from
       the price fetch */
    uint public constant BITMASK_EXCLUDE_PERMISSIONLESS = 1 << 255;

    /* When getting a price for ETH to some ERC20 then ETH is represented
       by the following address: */
    address constant kyberNativeEthAddr = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);

    bytes4 constant getExpectedRateCallSig = bytes4(
        keccak256(
            "getExpectedRate(address,address,uint256)"
        )
    );

    struct Market  {
        address tokenContract;
        bytes encodedCall;
    }
    mapping(bytes32 => Market) markets;
    mapping(bytes32 => string) public marketNames;

    address kyberNetworkProxyContract;

    constructor(address _kyberNetworkProxyContract) public {
        setKyberNetworkProxyContract(_kyberNetworkProxyContract);
    }

    function setKyberNetworkProxyContract(address _kyberNetworkProxyContract) public onlyOwner {
        kyberNetworkProxyContract = _kyberNetworkProxyContract;
    }

    function isMarketActive(bytes32 _marketId) public view returns (bool) {
        return markets[_marketId].tokenContract != address(0);
    }

    /**
     * Add a new Kyber market
     * @param _marketStrId String id of market. eg. "Kyber_ETH_DAI"
     * @param _tokenContract Address of ERC20 Token on Kyber market.
     * @return marketId bytes32 keccak256 of the _marketStrId
     */
    function addMarket(
        string calldata _marketStrId,
        address _tokenContract
    )
        external
        onlyOwner
        returns (bytes32 marketId)
    {
        marketId = keccak256(abi.encodePacked(_marketStrId));

        markets[marketId] = Market(
            _tokenContract,
            // store the call signature to the get market price for
            // 1 ETH of the token
            abi.encodeWithSelector(
                getExpectedRateCallSig,
                kyberNativeEthAddr,
                _tokenContract,
                1 ether | BITMASK_EXCLUDE_PERMISSIONLESS
            )
        );
        marketNames[marketId] = _marketStrId;

        emit LogPriceFeedsKyberMarketAdded(marketId, _marketStrId);
    }

    function removeMarket(bytes32 _marketId)
        external
        onlyOwner
        pre_cond(isMarketActive(_marketId), REASON_MUST_BE_ACTIVE_MARKET)
    {
        markets[_marketId] = Market(address(0x0), abi.encode(0x0));
        emit LogPriceFeedsKyberMarketRemoved(_marketId);
    }

    function getMarket(bytes32 _marketId)
        public
        view
        returns (address tokenContract, bytes memory encodedCall)
    {
        Market memory market = markets[_marketId];
        tokenContract = market.tokenContract;
        encodedCall = market.encodedCall;
    }

    function read(bytes32 _marketId) public view returns (uint priceValue) {
        Market storage market = markets[_marketId];

        bool success;
        bytes memory rspData;
        (success, rspData) = kyberNetworkProxyContract.staticcall(
            market.encodedCall
        );

        if (!success) {
            revert(REASON_KYBER_PRICE_CALL_FAILED);
        }

        (priceValue, ) = abi.decode(rspData, (uint, uint));
    }
}