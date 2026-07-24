// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The clean control, and the only fixture here that is meant to pass.
///
/// It has to be genuinely uninteresting for the passing case to mean anything: no allowance is
/// written, no value leaves through a second hop, no owner path exists to fire, and the code
/// behind the address is the code at the address. Its source is verified on the explorer
/// deliberately, because a control that reads as unverified is the thing the bad callee already
/// tests.
contract CleanControl {
    uint256 public pings;

    event Pinged(address indexed who, uint256 count);

    function ping() external returns (uint256) {
        pings += 1;
        emit Pinged(msg.sender, pings);
        return pings;
    }
}
