pragma solidity ^0.4.23;
pragma experimental "v0.5.0";

/**
 * Factory creating DELETECALL forwarding contracts.
 *
 * This implementation is from:
 *  https://gist.github.com/izqui/7f904443e6d19c1ab52ec7f5ad46b3a8
 */
contract ForwardFactory {

    event LogForwarderDeployed(address forwarderAddress, address targetContract);

    function createForwarder(address _target) public returns (address fwdContract) {
        /*
           Bytecode origin https://www.reddit.com/r/ethereum/comments/6ic49q/any_assembly_programmers_willing_to_write_a/dj5ceuw/

            CALLDATASIZE
            PUSH1 0x00
            PUSH1 0x00
            CALLDATACOPY
            PUSH2 0x1000
            PUSH1 0x00
            CALLDATASIZE
            PUSH1 0x00
            PUSH20 0xf00df00df00df00df00df00df00df00df00df00d // placeholder address
            GAS
            DELEGATE_CALL
            ISZERO
            PC
            JUMPI
            PUSH2 0x1000
            PUSH1 0x00
            RETURN
        */
        bytes32 b1 = 0x602e600c600039602e6000f33660006000376101006000366000730000000000; // length 27 bytes = 1b
        bytes32 b2 = 0x5af41558576101006000f3000000000000000000000000000000000000000000; // length 11 bytes

        uint256 shiftedAddress = uint256(_target) * ((2 ** 8) ** 12);   // Shift address 12 bytes to the left

        /*
         * SOLIUM DISABLE no-inline-assembly error. How else to cheaply do this?
         */
         
        /* solium-disable security/no-inline-assembly */
        assembly {
            let contractCode := mload(0x40)                 // Find empty storage location using "free memory pointer"
            mstore(contractCode, b1)                        // We add the first part of the bytecode
            mstore(add(contractCode, 0x1b), shiftedAddress) // Add target address
            mstore(add(contractCode, 0x2f), b2)             // Final part of bytecode
            fwdContract := create(0, contractCode, 0x3A)    // total length 58 dec = 3a
            switch extcodesize(fwdContract) case 0 { invalid() }
        }

        emit LogForwarderDeployed(fwdContract, _target);
    }

}
