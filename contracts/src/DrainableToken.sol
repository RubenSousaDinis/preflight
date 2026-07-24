// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Fixture infrastructure, not a fixture in its own right: the token the drainer router
/// operates on.
///
/// An ordinary ERC20 with one planted flaw. `forceApprove` writes an allowance on behalf of any
/// owner and checks nothing about who called it, so a contract the caller does interact with can
/// hand a third party an unbounded allowance over tokens the caller never mentioned.
contract DrainableToken {
    string public constant name = "Drainable";
    string public constant symbol = "DRAIN";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(uint256 supply) {
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
        emit Transfer(address(0), msg.sender, supply);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    /// @notice The planted flaw. Anyone may set anyone's allowance.
    function forceApprove(address owner, address spender, uint256 value) external returns (bool) {
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        require(balanceOf[msg.sender] >= value, "balance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(balanceOf[from] >= value, "balance");
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
        return true;
    }

    function mint(address to, uint256 value) external {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }
}
