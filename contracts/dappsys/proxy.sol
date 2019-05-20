// proxy.sol - execute actions atomically through the proxy's identity

// Copyright (C) 2017  DappHub, LLC

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity >=0.5.0 <0.6.0;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

// DSProxy - 0xFutures modifications:

// - removed all payable keywords and the payable fallback as our proxies
//   don't take or send ETH at all. Additionally solidity would enforce address
//   instances in the CFD to be payable which we don't want.
// - removed note.sol and uses
// - removed auth.sol and replaced with openzeppelin Ownable
// - removed unused code from proxy.sol to reduce gas footprint

// DSProxy - original from dappsys:

// Allows code execution using a persistant identity This can be very
// useful to execute a sequence of atomic actions. Since the owner of
// the proxy can be changed, this allows for dynamic ownership models
// i.e. a multisig
contract DSProxy is Ownable {
    DSProxyCache public cache;  // global cache for contracts

    constructor(address _cacheAddr) public {
        setCache(_cacheAddr);
    }

    function execute(address _target, bytes memory _data)
        public
        onlyOwner
        returns (bytes memory response)
    {
        require(_target != address(0), "ds-proxy-target-address-required");

        // call contract in current context
        /* solium-disable security/no-inline-assembly */
        assembly {
            let succeeded := delegatecall(sub(gas, 5000), _target, add(_data, 0x20), mload(_data), 0, 0)
            let size := returndatasize

            response := mload(0x40)
            mstore(0x40, add(response, and(add(add(size, 0x20), 0x1f), not(0x1f))))
            mstore(response, size)
            returndatacopy(add(response, 0x20), 0, size)

            switch iszero(succeeded)
            case 1 {
                // throw if delegatecall failed
                revert(add(response, 0x20), size)
            }
        }
    }

    //set new cache
    function setCache(address _cacheAddr)
        public
        onlyOwner
        returns (bool)
    {
        require(_cacheAddr != address(0), "ds-proxy-cache-address-required");
        cache = DSProxyCache(_cacheAddr);  // overwrite cache
        return true;
    }
}

// DSProxyFactory
// This factory deploys new proxy instances through build()
// Deployed proxy addresses are logged
contract DSProxyFactory {
    event Created(address indexed sender, address indexed owner, address proxy, address cache);
    DSProxyCache public cache;

    constructor() public {
        cache = new DSProxyCache();
    }

    // deploys a new proxy instance
    // sets custom owner of proxy
    function build(address owner) public returns (address proxy) {
        proxy = address(new DSProxy(address(cache)));
        Ownable(proxy).transferOwnership(owner);
        emit Created(msg.sender, owner, address(proxy), address(cache));
    }
}

// DSProxyCache
// This global cache stores addresses of contracts previously deployed
// by a proxy. This saves gas from repeat deployment of the same
// contracts and eliminates blockchain bloat.

// By default, all proxies deployed from the same factory store
// contracts in the same cache. The cache a proxy instance uses can be
// changed.  The cache uses the sha3 hash of a contract's bytecode to
// lookup the address
contract DSProxyCache {
    mapping(bytes32 => address) cache;

    function read(bytes memory _code) public view returns (address) {
        bytes32 hash = keccak256(_code);
        return cache[hash];
    }

    function write(bytes memory _code) public returns (address target) {
        /* solium-disable security/no-inline-assembly */
        assembly {
            target := create(0, add(_code, 0x20), mload(_code))
            switch iszero(extcodesize(target))
            case 1 {
                // throw if contract failed to deploy
                revert(0, 0)
            }
        }
        bytes32 hash = keccak256(_code);
        cache[hash] = target;
    }
}
