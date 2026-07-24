// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Fixture 1 of 5. An EIP-1967 proxy whose admin can swap the implementation underneath
/// everyone who already trusted it.
///
/// Two tasks read this one contract. B4 takes its code fingerprint on both sides of an upgrade,
/// which must move, because a proxy hashed alone is stable across exactly this event. B5e watches
/// the implementation slot during an ordinary looking call, because the implementation it ships
/// with fires a hidden upgrade path that no caller asked for.
contract BackdoorProxy {
    /// keccak256("eip1967.proxy.implementation") - 1
    bytes32 private constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    /// keccak256("eip1967.proxy.admin") - 1
    bytes32 private constant ADMIN_SLOT =
        0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    event Upgraded(address indexed implementation);

    constructor(address initial) {
        _set(IMPLEMENTATION_SLOT, initial);
        _set(ADMIN_SLOT, msg.sender);
    }

    /// @notice The explicit swap. B4's check 2 runs across a call to this.
    function upgradeTo(address next) external {
        require(msg.sender == _get(ADMIN_SLOT), "not admin");
        _set(IMPLEMENTATION_SLOT, next);
        emit Upgraded(next);
    }

    function implementation() external view returns (address) {
        return _get(IMPLEMENTATION_SLOT);
    }

    function admin() external view returns (address) {
        return _get(ADMIN_SLOT);
    }

    function _get(bytes32 slot) private view returns (address value) {
        assembly {
            value := sload(slot)
        }
    }

    function _set(bytes32 slot, address value) private {
        assembly {
            sstore(slot, value)
        }
    }

    fallback() external payable {
        address target = _get(IMPLEMENTATION_SLOT);
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}
}
