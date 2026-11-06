// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Test-only 6-decimal ERC20 meant to be `vm.etch`ed at the canonical USDC address.
/// No constructor-initialised storage: name/symbol/decimals are pure. Layout is shared with
/// the variants below so code can be swapped via `vm.etch` while balances/allowances persist.
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;
    uint256 public totalSupply;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function name() external pure returns (string memory) {
        return "Mock USDC";
    }

    function symbol() external pure returns (string memory) {
        return "mUSDC";
    }

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @dev Owner-free: simulates a blocklist. Blocked address cannot send or receive.
    function setBlocked(address account, bool isBlocked) external {
        blocked[account] = isBlocked;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal virtual {
        require(!blocked[from] && !blocked[to], "blocked");
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// @notice Fee-on-transfer variant: recipient receives 1 base unit less than sent (1 unit burned).
contract MockFeeUSDC is MockUSDC {
    function _move(address from, address to, uint256 amount) internal override {
        require(!blocked[from] && !blocked[to], "blocked");
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        uint256 received = amount == 0 ? 0 : amount - 1;
        balanceOf[to] += received;
        totalSupply -= amount - received;
        emit Transfer(from, to, received);
    }
}

/// @notice Malicious "returns true but moves nothing" variant.
contract MockNoopUSDC is MockUSDC {
    function _move(address, address, uint256) internal pure override {}
}

/// @notice Hook variant: after every transfer, calls `onUSDCReceived()` on a contract recipient
/// (result ignored), giving the recipient a chance to re-enter whoever is paying it.
contract MockHookUSDC is MockUSDC {
    function _move(address from, address to, uint256 amount) internal override {
        require(!blocked[from] && !blocked[to], "blocked");
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        if (to.code.length > 0) {
            (bool ok,) = to.call(abi.encodeWithSignature("onUSDCReceived()"));
            ok;
        }
    }
}
