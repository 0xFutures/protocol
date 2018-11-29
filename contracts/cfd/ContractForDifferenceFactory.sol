pragma solidity ^0.4.23;
pragma experimental "v0.5.0";

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "../DBC.sol";
import "../Registry.sol";
import "../ForwardFactory.sol";
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

    Registry public registry;
    address public cfdModel;
    address public cfdRegistry;
    address public forwardFactory;
    address public feeds;

    constructor(
        address _registry,
        address _cfdModel,
        address _forwardFactory,
        address _feeds
    ) public {
        setRegistry(_registry);
        setCFDModel(_cfdModel);
        setForwardFactory(_forwardFactory);
        setFeeds(_feeds);
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

    /**
     * Create a new ContractForDifference instance
     *
     * @param _marketId Contract for this market (see Feeds.sol markets)
     * @param _strikePrice Contact strike price
     * @param _notionalAmountWei Contract notional amount
     * @param _isBuyer If the caller is to be the buyer, else they will be the seller
     *
     * @return address of new contract
     */
    function createContract(
        bytes32 _marketId,
        uint _strikePrice,
        uint _notionalAmountWei,
        bool _isBuyer
    )
        external
        payable
        returns (ContractForDifference cfd)
    {
        address creator = msg.sender;
        cfd = ContractForDifference(
            ForwardFactory(forwardFactory).createForwarder(cfdModel)
        );
        cfd.create.value(msg.value)(
            registry,
            cfdRegistry,
            feeds,
            creator,
            _marketId,
            _strikePrice,
            _notionalAmountWei,
            _isBuyer
        );
        registry.addCFD(cfd);
        emit LogCFDFactoryNew(_marketId, creator, cfd);
        ContractForDifferenceRegistry(cfdRegistry).registerNew(cfd, creator);
    }

    /**
     * Upgrade a CFD at a different set of contracts to this set of contracts.
     * The old CFD itself will invoke this function to do the upgrade.

     * @return address of new contract
     */
    function createByUpgrade()
        external
        payable
        returns (ContractForDifference newCfd)
    {
        // can only upgrade this if factory is the latest version
        require(registry.getCFDFactoryLatest() == address(this), REASON_MUST_BE_LATEST);

        address cfdAddr = msg.sender;

        // can only upgrade if cfd registered and not with this latest version
        address registryEntry = registry.allCFDs(cfdAddr);
        require(registryEntry != 0x0 && registryEntry != address(this), REASON_MUST_REGISTERED_CFD);

        ContractForDifference existingCfd = ContractForDifference(cfdAddr);
        require(existingCfd.upgradeable(), REASON_UPGRADEABLE_FLAG_NOT_SET);

        newCfd = ContractForDifference(
            ForwardFactory(forwardFactory).createForwarder(cfdModel)
        );
        ContractForDifferenceRegistry(cfdRegistry).registerNew(
            newCfd,
            existingCfd.buyer()
        );

        newCfd.createByUpgrade.value(msg.value)(
            cfdAddr,
            address(registry),
            cfdRegistry,
            feeds
        );
        registry.addCFD(newCfd);

        // replicate logging for an ordinary create so queries will get this to
        emit LogCFDFactoryNew(newCfd.market(), newCfd.buyer(), newCfd);
        emit LogCFDFactoryNewByUpgrade(newCfd, existingCfd);
    }

}
