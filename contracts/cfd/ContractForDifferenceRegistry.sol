pragma solidity ^0.4.23;
pragma experimental "v0.5.0";

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "../DBC.sol";

/**
 * Event logs for all CFD creations and every time a party joins a contract.
 * Kept in a single contract seperate from the CFDs here so that we have a way
 * to query all CFDs ever created. (event logs are queried per contract address)
 */
contract ContractForDifferenceRegistry is DBC, Ownable {

    event LogCFDRegistryNew(address indexed cfd, address indexed creator);
    event LogCFDRegistryParty(address indexed cfd, address indexed party);
    event LogCFDRegistrySale(address indexed cfd, address indexed sellingParty);

    string constant REASON_CALLER_MUST_BE_CFD = "Caller must be a CFD instance";
    string constant REASON_CALLER_MUST_BE_CFD_FACTORY = "Caller must be the CFD Factory";

    address public factory;

    mapping(address => bool) public cfds;

    constructor() public {
    }

    function setFactory(address _factory) public onlyOwner {
        factory = _factory;
    }

    function fromCfd() public view returns (bool) {
        return cfds[msg.sender] == true;
    }

    /**
     * Register a new CFD contract and the creator of the contract.
     * The main purpose of this call is to Log an event that can be queried for
     * all existing CFDs.
     */
    function registerNew(
        address _cfd,
        address _creator
    )
        public
        pre_cond(msg.sender == factory, REASON_CALLER_MUST_BE_CFD_FACTORY)
    {
        cfds[_cfd] = true;
        emit LogCFDRegistryNew(_cfd, _creator);
        registerPartyInternal(_cfd, _creator);
    }

    /**
     * Register a new party being added to the contract. This would be from
     * either:
     * - a deposit() counterparty call at initiation times
     * - a transferPosition() transferring ownership to a new party.
     * - a buy() call where one side is sold to a new party.
     *
     * The main purpose of this call is to Log an event that can be queried.
     * This is how we can get a list of all contracts a given address is
     * involved with.
     */
    function registerParty(
        address _party
    )
        public
        pre_cond(fromCfd(), REASON_CALLER_MUST_BE_CFD)
    {
        registerPartyInternal(msg.sender, _party);
    }

    function registerPartyInternal(
        address _cfd,
        address _party
    )
        private
    {
        emit LogCFDRegistryParty(_cfd, _party);
    }

    /**
     * Register contract for sale.
     */
    function registerSale(
        address _sellingParty
    )
        public
        pre_cond(fromCfd(), REASON_CALLER_MUST_BE_CFD)
    {
        emit LogCFDRegistrySale(msg.sender, _sellingParty);
    }

}
