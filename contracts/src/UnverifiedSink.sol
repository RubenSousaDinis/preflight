// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Fixture infrastructure: the address value ends up at, deliberately left unverified on
/// the explorer.
///
/// Nothing about this code is hostile. That is the point of the pairing it belongs to: B5d judges
/// a callee on a fact about the chain, which is whether anyone published source for it, and this
/// contract is the one nobody did. Its source lives in this repo and is never submitted to
/// Sourcify or Etherscan.
contract UnverifiedSink {
    event Received(address indexed from, uint256 amount);

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }
}
