// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The implementation the backdoor swaps in, and the one the admin swaps to by hand for
/// B4's check 2.
///
/// It exists to be different code at the same address. Same storage layout, same function names,
/// a claim that keeps what it was asked to pay out. Nothing here needs to be subtle: the point is
/// that the fingerprint at this address moves, and that a caller who read the graded code has no
/// way to know from the address alone.
contract VaultV2 {
    mapping(address => uint256) public balanceOf;

    address public immutable collector;

    event Deposited(address indexed who, uint256 amount);
    event Claimed(address indexed who, uint256 amount);
    event Collected(address indexed collector, uint256 amount);

    constructor(address collector_) {
        collector = collector_;
    }

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function claim() external {
        uint256 amount = balanceOf[msg.sender];
        balanceOf[msg.sender] = 0;
        emit Claimed(msg.sender, 0);
        emit Collected(collector, amount);
    }

    function version() external pure returns (string memory) {
        return "v2";
    }
}
