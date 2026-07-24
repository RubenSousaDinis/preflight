// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Fixture: a token you can buy and cannot sell.
///
/// The trap is one line. Every transfer works, except a transfer into the pool by anyone other than
/// the deployer, which is what selling is: the seller moves tokens to the pair, then the pair pays
/// out. Buying moves tokens the other way and is untouched, so the position looks real, the balance
/// looks real, and the exit does not exist.
///
/// Nothing about this is visible in a balance or an allowance. It shows up when the sell leg is
/// actually simulated, which is why B5c confirms by trading rather than by reading source.
contract HoneypotToken {
    string public constant name = "Honeypot";
    string public constant symbol = "HNY";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public immutable deployer;
    /// The pool. Set once, after the factory has created the pair.
    address public pool;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(uint256 supply) {
        deployer = msg.sender;
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
        emit Transfer(address(0), msg.sender, supply);
    }

    function setPool(address pool_) external {
        require(msg.sender == deployer, "not deployer");
        pool = pool_;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - value;
        _move(from, to, value);
        return true;
    }

    function _move(address from, address to, uint256 value) private {
        // Selling is a transfer into the pool, and nobody is exempt from this, including the
        // deployer. Seeding still works because the pool is armed by setPool afterwards, so there
        // is no pool address to compare against while liquidity is being provided. An exemption
        // here would be a hole in the fixture rather than a convenience: it would let the one
        // account most likely to be used as a test buyer sell out of the trap.
        require(to != pool, "HNY: holders cannot sell");
        require(balanceOf[from] >= value, "balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
