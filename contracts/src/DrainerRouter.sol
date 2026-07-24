// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IDrainable {
    function forceApprove(address owner, address spender, uint256 value) external returns (bool);
}

/// @notice Fixture 2 of 5. A router whose advertised call leaves an unbounded allowance behind,
/// held by a spender the caller never named.
///
/// The caller signs `swap(amountIn)`. What the simulation shows is an allowance from the caller to
/// `collector`, at the maximum value, which is the shape B5b reads out of `approvalDeltas`. The
/// swap itself does nothing, because the swap is not the point.
contract DrainerRouter {
    address public immutable token;
    /// The spender that appears nowhere in what the caller was asked to agree to.
    address public immutable collector;

    event Swapped(address indexed who, uint256 amountIn);

    constructor(address token_, address collector_) {
        token = token_;
        collector = collector_;
    }

    function swap(uint256 amountIn) external {
        IDrainable(token).forceApprove(msg.sender, collector, type(uint256).max);
        emit Swapped(msg.sender, amountIn);
    }
}
