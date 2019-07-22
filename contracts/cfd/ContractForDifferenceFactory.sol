pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "../DBC.sol";
import "../Registry.sol";
import "../ForwardFactory.sol";
import "../kyber/KyberFacade.sol";
import "./ContractForDifference.sol";
import "./ContractForDifferenceRegistry.sol";

contract ContractForDifferenceFactory is DBC, Ownable {
    event LogCFDFactoryNew(
        bytes32 indexed marketId,
        address indexed creator,
        address newCFDAddr
    );
    event LogCFDFactoryNewByUpgrade(
        address indexed newCFDAddr,
        address oldCFDAddr
    );

    string constant REASON_MUST_BE_LATEST = "Can only upgrade on a factory that is the latest";
    string constant REASON_MUST_REGISTERED_CFD = "Caller must be a registered CFD";
    string constant REASON_UPGRADEABLE_FLAG_NOT_SET = "upgradeable is not set in the CFD";
    string constant REASON_DAI_TRANSFER_FAILED = "Failure transfering ownership of DAI tokens";
    string constant REASON_DAI_ALLOWANCE_TOO_LOW = "DAI allowance is less than the _value";

    Registry public registry;
    address public cfdModel;
    address public cfdRegistry;
    address public forwardFactory;
    address public feeds;
    KyberFacade public kyberFacade;

    constructor(
        address _registry,
        address _cfdModel,
        address _forwardFactory,
        address _feeds,
        address _kyberFacade
    ) public {
        setRegistry(_registry);
        setCFDModel(_cfdModel);
        setForwardFactory(_forwardFactory);
        setFeeds(_feeds);
        setKyberFacade(_kyberFacade);
    }

    function setRegistry(address _registry) public onlyOwner {
        registry = Registry(_registry);
    }

    function setCFDModel(address _cfdModel) public onlyOwner {
        cfdModel = _cfdModel;
    }

    function setCFDRegistry(address _cfdRegistry) public onlyOwner {
        cfdRegistry = _cfdRegistry;
    }

    function setForwardFactory(address _forwardFactory) public onlyOwner {
        forwardFactory = _forwardFactory;
    }

    function setFeeds(address _feeds) public onlyOwner {
        feeds = _feeds;
    }

    function setKyberFacade(address _kyberFacade) public onlyOwner {
        kyberFacade = KyberFacade(_kyberFacade);
    }

    /**
     * Create a new ContractForDifference instance given DAI.
     *
     * @param _marketId Contract for this market (see PriceFeeds.sol markets)
     * @param _strikePrice Contract strike price
     * @param _notionalAmountDai Contract notional amount in DAI
     * @param _isBuyer If the caller is to be the buyer, else they will be the seller
     * @param _value Amount of DAI to deposit
     *
     * @return address of new contract
     */
    function createContract(
        bytes32 _marketId,
        uint _strikePrice,
        uint _notionalAmountDai,
        bool _isBuyer,
        uint _value
    )
        external
        pre_cond(
            registry.getDAI().allowance(msg.sender, address(this)) >= _value,
            REASON_DAI_ALLOWANCE_TOO_LOW
        )
        returns (ContractForDifference cfd)
    {
        cfd = createContractInternal(
            _marketId,
            _strikePrice,
            _notionalAmountDai,
            _isBuyer,
            _value,
            true // DAI is with the caller
        );
    }

    /**
     * Create a new ContractForDifference instance given ETH.
     *
     * Sent ETH is traded for DAI on the fly and the resulting amount of DAI
     * is the contract collateral. So callers should calculate how much
     * DAI collateral they want ahead of time and send the appropriate amount
     * of ETH to match.
     *
     * @param _marketId Contract for this market (see Feeds.sol markets)
     * @param _strikePrice Contact strike price
     * @param _notionalAmountDai Contract notional amount
     * @param _isBuyer If the caller is to be the buyer, else they will be the seller
     *
     * @return address of new contract
     */
    function createContractWithETH(
        bytes32 _marketId,
        uint _strikePrice,
        uint _notionalAmountDai,
        bool _isBuyer
    )
        external
        payable
        returns (ContractForDifference cfd)
    {
        uint daiAmount = kyberFacade.ethToDai.value(msg.value)(address(this));
        cfd = createContractInternal(
            _marketId,
            _strikePrice,
            _notionalAmountDai,
            _isBuyer,
            daiAmount,
            false // DAI not with caller - is with this contract from the trade
        );
    }

    /**
     * Create a new ContractForDifference instance.
     *
     * @param _marketId Contract for this market (see PriceFeeds.sol markets)
     * @param _strikePrice Contract strike price
     * @param _notionalAmountDai Contract notional amount in DAI
     * @param _isBuyer If the caller is to be the buyer, else they will be the seller
     * @param _value Amount of DAI to deposit
     * @param _daiWithCaller DAI is either with the msg.sender or with this
     *      contract from an eth2dai trade executed just before this function
     *      call.
     *
     * @return address of new contract
     */
    function createContractInternal(
        bytes32 _marketId,
        uint _strikePrice,
        uint _notionalAmountDai,
        bool _isBuyer,
        uint _value,
        bool _daiWithCaller
    )
        private
        returns (ContractForDifference cfd)
    {
        cfd = ContractForDifference(
            ForwardFactory(forwardFactory).createForwarder(cfdModel)
        );

        if (_daiWithCaller == true) {
            require(
                registry.getDAI().transferFrom(
                    msg.sender,
                    address(cfd),
                    _value
                ),
                REASON_DAI_TRANSFER_FAILED
            );
        } else {
            require(
                registry.getDAI().transfer(address(cfd), _value),
                REASON_DAI_TRANSFER_FAILED
            );
        }

        address creator = msg.sender;
        cfd.createNew(
            address(registry),
            cfdRegistry,
            feeds,
            creator,
            _marketId,
            _strikePrice,
            _notionalAmountDai,
            _isBuyer
        );

        registry.addCFD(address(cfd));
        emit LogCFDFactoryNew(_marketId, creator, address(cfd));
        ContractForDifferenceRegistry(cfdRegistry).registerNew(
            address(cfd),
            creator
        );
    }

    /**
     * Upgrade a CFD at a different set of contracts to this set of contracts.
     * The old CFD itself will invoke this function to do the upgrade.

     * @return address of new contract
     */
    function createByUpgrade()
        external
        returns (ContractForDifference newCfd)
    {
        // can only upgrade this if factory is the latest version
        require(registry.getCFDFactoryLatest() == address(this), REASON_MUST_BE_LATEST);

        address cfdAddr = msg.sender;

        // can only upgrade if cfd registered and not with this latest version
        address registryEntry = registry.allCFDs(cfdAddr);
        require(
            registryEntry != address(0) && registryEntry != address(this),
            REASON_MUST_REGISTERED_CFD
        );

        ContractForDifference existingCfd = ContractForDifference(cfdAddr);
        require(existingCfd.upgradeable(), REASON_UPGRADEABLE_FLAG_NOT_SET);

        newCfd = ContractForDifference(
            ForwardFactory(forwardFactory).createForwarder(cfdModel)
        );

        // Register in the CFD registry before calling createByUpgrade as
        // createByUpgrade requires this to registerParty().
        ContractForDifferenceRegistry(cfdRegistry).registerNew(
            address(newCfd),
            existingCfd.buyer()
        );

        newCfd.createByUpgrade(
            cfdAddr,
            address(registry),
            cfdRegistry,
            feeds
        );

        // Put the CFD in the main Registry
        registry.addCFD(address(newCfd));

        // replicate logging for an ordinary create so queries will get this to
        emit LogCFDFactoryNew(newCfd.market(), newCfd.buyer(), address(newCfd));
        emit LogCFDFactoryNewByUpgrade(address(newCfd), address(existingCfd));
    }

}
