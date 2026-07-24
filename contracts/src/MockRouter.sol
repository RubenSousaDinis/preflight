// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

interface IUniswapV2Pair {
    function token0() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @notice Fixture infrastructure: a one call buy, so the pending transaction under test looks like
/// what a person actually signs.
///
/// Base Sepolia has a live UniswapV2Factory but no router anyone deployed, and a direct pair swap
/// takes two transactions. This wraps them into one. It is deliberately minimal: no path routing,
/// no deadline, no slippage argument, because none of that is what is being demonstrated.
///
/// The sell side is not here on purpose. B5c probes the exit by calling the pair directly, so the
/// detector never depends on a router existing on the chain it is judging.
contract MockRouter {
    address public immutable factory;

    event Bought(address indexed buyer, address indexed tokenOut, uint256 amountIn, uint256 amountOut);

    constructor(address factory_) {
        factory = factory_;
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public
        pure
        returns (uint256)
    {
        uint256 amountInWithFee = amountIn * 997;
        return (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    function buy(address tokenIn, address tokenOut, uint256 amountIn, address to)
        external
        returns (uint256 amountOut)
    {
        address pair = IUniswapV2Factory(factory).getPair(tokenIn, tokenOut);
        require(pair != address(0), "no pair");

        (uint112 reserve0, uint112 reserve1, ) = IUniswapV2Pair(pair).getReserves();
        bool inIsToken0 = IUniswapV2Pair(pair).token0() == tokenIn;
        (uint256 reserveIn, uint256 reserveOut) =
            inIsToken0 ? (uint256(reserve0), uint256(reserve1)) : (uint256(reserve1), uint256(reserve0));

        amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
        IERC20Minimal(tokenIn).transferFrom(msg.sender, pair, amountIn);
        IUniswapV2Pair(pair).swap(
            inIsToken0 ? 0 : amountOut,
            inIsToken0 ? amountOut : 0,
            to,
            ""
        );
        emit Bought(msg.sender, tokenOut, amountIn, amountOut);
    }
}
