// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Fixture 3 of 5. The value the caller sends leaves through a second hop.
///
/// The transaction's direct `to` is this contract, and this contract has published source. The
/// address that ends up holding the value is one hop further on and has none, so the fact only
/// exists on the resolved call graph. Reading the direct callee alone would call this clean, which
/// is the whole reason B5d walks the graph.
contract ValueRouter {
    address payable public immutable sink;

    event Forwarded(address indexed from, address indexed to, uint256 amount);

    constructor(address payable sink_) {
        sink = sink_;
    }

    function forward() external payable {
        (bool ok, ) = sink.call{value: msg.value}("");
        require(ok, "forward failed");
        emit Forwarded(msg.sender, sink, msg.value);
    }
}
