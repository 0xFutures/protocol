pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "../DBC.sol";
import "../Registry.sol";


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

    bytes4 constant getExpectedRateCallSig = bytes4(
        keccak256(
            "getExpectedRate(address,address,uint256)"
        )
    );

    struct Market  {
        address tokenContract;
        address tokenContractTo;
        bytes encodedCall;
    }
    mapping(bytes32 => Market) public markets;
    mapping(bytes32 => string) public marketNames;

    Registry public registry;

    constructor(address _registry) public {
        setRegistry(_registry);
    }

    function setRegistry(address _registry) public onlyOwner {
        registry = Registry(_registry);
    }

    function isMarketActive(bytes32 _marketId) public view returns (bool) {
        return markets[_marketId].tokenContract != address(0) && markets[_marketId].tokenContractTo != address(0);
    }

    /**
     * Add a new Kyber market
     * @param _marketStrId String id of market. eg. "ETH/DAI"
     * @param _tokenContract Address "From" of ERC20 Token on Kyber market.
     * @param _tokenContractTo Address "To" of ERC20 Token on Kyber market.
     * @return marketId bytes32 keccak256 of the _marketStrId
     */
    function addMarket(
        string calldata _marketStrId,
        address _tokenContract,
        address _tokenContractTo
    )
        external
        onlyOwner
        returns (bytes32 marketId)
    {
        marketId = keccak256(abi.encodePacked(_marketStrId));

        markets[marketId] = Market(
            _tokenContract,
            _tokenContractTo,
            // store the call signature to the get market price for
            // 1 ETH of the token
            abi.encodeWithSelector(
                getExpectedRateCallSig,
                _tokenContractTo,
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
        markets[_marketId] = Market(address(0x0), address(0x0), abi.encode(0x0));
        emit LogPriceFeedsKyberMarketRemoved(_marketId);
    }

    function getMarket(bytes32 _marketId)
        public
        view
        returns (address tokenContract, address tokenContractTo, bytes memory encodedCall)
    {
        Market memory market = markets[_marketId];
        tokenContract = market.tokenContract;
        tokenContractTo = market.tokenContractTo;
        encodedCall = market.encodedCall;
    }

    function read(bytes32 _marketId) public view returns (uint priceValue) {
        Market storage market = markets[_marketId];

        bool success;
        bytes memory rspData;
        (success, rspData) = address(registry.getKyberNetworkProxy()).staticcall(
            market.encodedCall
        );

        if (!success) {
            revert(REASON_KYBER_PRICE_CALL_FAILED);
        }

        (priceValue, ) = abi.decode(rspData, (uint, uint));
    }
}
