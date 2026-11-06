// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {WalletRushEscrow} from "../../WalletRushEscrow.sol";

interface IApprove {
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @notice Player contract that tries to re-enter the escrow whenever it receives USDC
/// (requires the MockHookUSDC token variant). Records every attempt without reverting.
contract ReentrantPlayer {
    address internal constant USDC = 0x3600000000000000000000000000000000000000;

    WalletRushEscrow public immutable escrow;
    bytes32 public matchId;
    uint256 public hookCalls;
    uint256 public successes;
    bytes4[] public failures;

    constructor(WalletRushEscrow _escrow) {
        escrow = _escrow;
    }

    function approveAndDeposit(bytes32 id) external {
        matchId = id;
        IApprove(USDC).approve(address(escrow), type(uint256).max);
        escrow.deposit(id);
    }

    function doClaim() external {
        escrow.claim();
    }

    function failureCount() external view returns (uint256) {
        return failures.length;
    }

    function onUSDCReceived() external {
        if (msg.sender != USDC) return;
        hookCalls++;
        _try(abi.encodeCall(escrow.refundExpired, (matchId)));
        _try(abi.encodeCall(escrow.claim, ()));
        _try(abi.encodeCall(escrow.deposit, (matchId)));
        _try(
            abi.encodeCall(
                escrow.settle, (matchId, 1, 1, 0, uint64(block.timestamp + 1), bytes32(uint256(1)), new bytes(65))
            )
        );
    }

    function _try(bytes memory data) private {
        (bool ok, bytes memory ret) = address(escrow).call(data);
        if (ok) {
            successes++;
        } else if (ret.length >= 4) {
            failures.push(bytes4(ret));
        } else {
            failures.push(bytes4(0));
        }
    }
}
