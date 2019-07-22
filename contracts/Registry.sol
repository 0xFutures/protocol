pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./DBC.sol";
import "./kyber/KyberNetworkProxyInterface.sol";

contract Registry is DBC, Ownable {

    string constant REASON_MUST_BE_LATEST_FACTORY = "Only latest CFD Factory can add new CFDs";

    string constant KEY_CFD_FACTORY_LATEST = "CFDFactoryLatest";
    string constant KEY_DAI = "DAI";
    string constant KEY_KYBER_NETWORK_PROXY = "KyberNetworkProxy";

    mapping(bytes32 => address) contracts;

    bytes32 proxyCodeHash;

    function getCFDFactoryLatest() public view returns (address) {
        return get(KEY_CFD_FACTORY_LATEST);
    }

    function setCFDFactoryLatest(address _addr) public onlyOwner {
        set(KEY_CFD_FACTORY_LATEST, _addr);
    }

    function getDAI() public view returns (ERC20) {
        return ERC20(get(KEY_DAI));
    }

    function setDAI(address _addr) public onlyOwner {
        set(KEY_DAI, _addr);
    }

    function getKyberNetworkProxy() public view returns (KyberNetworkProxyInterface) {
        return KyberNetworkProxyInterface(get(KEY_KYBER_NETWORK_PROXY));
    }

    function setKyberNetworkProxy(address _addr) public onlyOwner {
        set(KEY_KYBER_NETWORK_PROXY, _addr);
    }

    function getProxyCodeHash() public view returns (bytes32) {
        return proxyCodeHash;
    }

    function setProxyCodeHash(bytes32 _hash) public onlyOwner {
        proxyCodeHash = _hash;
    }

    function set(string memory _name, address _addr) private onlyOwner {
        contracts[keccak256(abi.encodePacked(_name))] = _addr;
    }

    function get(string memory _name) private view returns (address addr) {
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
