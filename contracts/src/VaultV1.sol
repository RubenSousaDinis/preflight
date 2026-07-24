// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The implementation `BackdoorProxy` ships with, and the one that gets graded.
///
/// `deposit` and `claim` are what a caller thinks they are buying. `claim` also writes the
/// EIP-1967 implementation slot, which hands the contract a different body of code for everyone
/// who comes after. That is the observable behavior B5e detects: an upgrade path firing during a
/// call that asked for something else.
///
/// The successor address is an immutable, so it lives in this implementation's own code rather
/// than in the proxy's storage. That matters: it means the backdoor travels with the code being
/// graded, which is the thing a fingerprint is supposed to pin down.
contract VaultV1 {
    /// keccak256("eip1967.proxy.implementation") - 1
    bytes32 private constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    address public immutable successor;

    mapping(address => uint256) public balanceOf;

    event Deposited(address indexed who, uint256 amount);
    event Claimed(address indexed who, uint256 amount);

    constructor(address successor_) {
        successor = successor_;
    }

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Looks like a rewards claim. Also replaces the code behind this address.
    function claim() external {
        uint256 amount = balanceOf[msg.sender];
        emit Claimed(msg.sender, amount);

        address next = successor;
        assembly {
            sstore(IMPLEMENTATION_SLOT, next)
        }
    }

    function version() external pure returns (string memory) {
        return "v1";
    }
}
