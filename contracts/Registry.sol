pragma solidity ^0.4.23;
pragma experimental "v0.5.0";

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "./DBC.sol";

contract Registry is DBC, Ownable {

    string constant REASON_MUST_BE_LATEST_FACTORY = "Only latest CFD Factory can add new CFDs";

    mapping(bytes32 => address) contracts;

    function getCFDFactoryLatest() public view returns (address) {
        return get("CFDFactoryLatest");
    }

    function setCFDFactoryLatest(address _addr) public onlyOwner {
        set("CFDFactoryLatest", _addr);
    }

    function getFees() public view returns (address) {
        return get("Fees");
    }

    function setFees(address _addr) public onlyOwner {
        set("Fees", _addr);
    }

    function set(string _name, address _addr) private onlyOwner {
        contracts[keccak256(abi.encodePacked(_name))] = _addr;
    }

    function get(string _name) private view returns (address addr) {
        addr = contracts[keccak256(abi.encodePacked(_name))];
    }


    /*
     * A registry of ALL CFDs created across any version set of the contracts.
     *
     * The mapping is from CFD address to CFDFactory that created it.
     *
     * The main reason to keep this is for the CFD upgrade mechansim to have a
     * way to know a given CFD was created correctly through the 0xFutures
     * mechansim and is not some dummy contract trying to onboard through
     * the upgrade mechanism.
     */
    // cfd to cfd factory
    mapping(address => address) public allCFDs;

    function addCFD(address _cfdAddr) public {
        address cfdFactoryCurrent = getCFDFactoryLatest();
        // only the latest deployed factory is allowed to add new CFDs
        require(msg.sender == cfdFactoryCurrent, REASON_MUST_BE_LATEST_FACTORY);
        allCFDs[_cfdAddr] = cfdFactoryCurrent;
    }


}