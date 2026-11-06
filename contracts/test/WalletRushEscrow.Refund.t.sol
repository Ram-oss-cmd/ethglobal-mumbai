// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Vm} from "forge-std/Vm.sol";
import {WalletRushEscrow} from "../WalletRushEscrow.sol";
import {WalletRushEscrowTestBase} from "./WalletRushEscrow.Base.t.sol";

contract WalletRushEscrowRefundTest is WalletRushEscrowTestBase {
    function _escrowLogsWithTopic(Vm.Log[] memory logs, bytes32 topic0) internal view returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(escrow) && logs[i].topics[0] == topic0) ++n;
        }
    }

    function _escrowLogCount(Vm.Log[] memory logs) internal view returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(escrow)) ++n;
        }
    }

    // ------------------------------------------------------------------ partial timeout

    function test_Refund_PartialOnlyA_RefundsOnlyA() public {
        _open(ID, alice, bob);
        _deposit(ID, alice);
        vm.warp(t0 + DEP + 1);

        vm.recordLogs();
        vm.expectEmit(true, true, false, true, address(escrow));
        emit WalletRushEscrow.Refunded(ID, alice, STAKE);
        escrow.refundExpired(ID);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(_bal(alice), START_BAL);
        assertEq(_bal(bob), START_BAL); // never deposited, receives nothing extra
        assertEq(_bal(address(escrow)), 0);
        assertTrue(_finalized(ID));
        assertEq(_escrowLogsWithTopic(logs, WalletRushEscrow.Refunded.selector), 1);
    }

    function test_Refund_PartialOnlyB_RefundsOnlyB() public {
        _open(ID, alice, bob);
        _deposit(ID, bob);
        vm.warp(t0 + DEP + 1);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit WalletRushEscrow.Refunded(ID, bob, STAKE);
        escrow.refundExpired(ID);

        assertEq(_bal(alice), START_BAL);
        assertEq(_bal(bob), START_BAL);
        assertEq(_bal(address(escrow)), 0);
    }

    function test_Refund_NoDeposits_FinalizesWithoutTransfers() public {
        _open(ID, alice, bob);
        vm.warp(t0 + DEP + 1);
        vm.recordLogs();
        escrow.refundExpired(ID);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(_escrowLogCount(logs), 0);
        assertTrue(_finalized(ID));
        assertEq(_bal(alice), START_BAL);
        assertEq(_bal(bob), START_BAL);
        assertEq(_bal(address(escrow)), 0);
    }

    function test_Refund_AnyoneCanTrigger() public {
        _open(ID, alice, bob);
        _deposit(ID, alice);
        vm.warp(t0 + DEP + 1);
        vm.prank(mallory);
        escrow.refundExpired(ID);
        assertEq(_bal(alice), START_BAL);
    }

    // ------------------------------------------------------------------ full pool timeout

    function test_Refund_FullPoolAfterRefundAfter_RefundsBoth() public {
        _funded(ID);
        vm.warp(t0 + REF + 1);

        vm.recordLogs();
        vm.expectEmit(true, true, false, true, address(escrow));
        emit WalletRushEscrow.Refunded(ID, alice, STAKE);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit WalletRushEscrow.Refunded(ID, bob, STAKE);
        escrow.refundExpired(ID);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(_escrowLogsWithTopic(logs, WalletRushEscrow.Refunded.selector), 2);
        assertEq(_bal(alice), START_BAL);
        assertEq(_bal(bob), START_BAL);
        assertEq(_bal(address(escrow)), 0);
    }

    function test_Refund_FullPoolAtExactlyRefundAfterSucceeds() public {
        _funded(ID);
        vm.warp(t0 + REF);
        escrow.refundExpired(ID);
        assertEq(_bal(alice), START_BAL);
        assertEq(_bal(bob), START_BAL);
    }

    // ------------------------------------------------------------------ too early

    function test_Refund_BeforeDepositDeadlineReverts() public {
        _open(ID, alice, bob);
        _deposit(ID, alice);
        vm.warp(t0 + DEP - 1);
        vm.expectRevert(WalletRushEscrow.RefundNotAvailable.selector);
        escrow.refundExpired(ID);
    }

    function test_Refund_AtExactlyDepositDeadlineReverts() public {
        _open(ID, alice, bob);
        _deposit(ID, alice);
        vm.warp(t0 + DEP);
        vm.expectRevert(WalletRushEscrow.RefundNotAvailable.selector);
        escrow.refundExpired(ID);
    }

    function test_Refund_NoDepositsAtDeadlineReverts() public {
        _open(ID, alice, bob);
        vm.warp(t0 + DEP);
        vm.expectRevert(WalletRushEscrow.RefundNotAvailable.selector);
        escrow.refundExpired(ID);
    }

    function test_Refund_FullPoolJustAfterDepositDeadlineReverts() public {
        _funded(ID);
        vm.warp(t0 + DEP + 1);
        vm.expectRevert(WalletRushEscrow.RefundNotAvailable.selector);
        escrow.refundExpired(ID);
    }

    function test_Refund_FullPoolJustBeforeRefundAfterReverts() public {
        _funded(ID);
        vm.warp(t0 + REF - 1);
        vm.expectRevert(WalletRushEscrow.RefundNotAvailable.selector);
        escrow.refundExpired(ID);
        assertEq(_bal(address(escrow)), 2 * STAKE);
        assertFalse(_finalized(ID));
    }

    function test_Refund_UnknownMatchReverts() public {
        vm.expectRevert(WalletRushEscrow.MatchNotFound.selector);
        escrow.refundExpired(ID);
    }

    // ------------------------------------------------------------------ terminal-state exclusivity

    function test_Refund_DoubleRefundReverts() public {
        _open(ID, alice, bob);
        _deposit(ID, alice);
        vm.warp(t0 + DEP + 1);
        escrow.refundExpired(ID);
        vm.expectRevert(WalletRushEscrow.MatchFinalized.selector);
        escrow.refundExpired(ID);
        assertEq(_bal(alice), START_BAL);
    }

    function test_Refund_AfterSettleReverts() public {
        _funded(ID);
        _settle(ID, 1, 5, 3);
        vm.warp(t0 + REF + 1);
        vm.expectRevert(WalletRushEscrow.MatchFinalized.selector);
        escrow.refundExpired(ID);
        assertEq(_bal(alice), START_BAL + STAKE);
        assertEq(_bal(bob), START_BAL - STAKE);
    }

    function test_Refund_ReopenAfterRefundFails() public {
        _open(ID, alice, bob);
        vm.warp(t0 + DEP + 1);
        escrow.refundExpired(ID);
        vm.prank(referee);
        vm.expectRevert(WalletRushEscrow.MatchAlreadyExists.selector);
        escrow.openMatch(ID, alice, bob, uint64(block.timestamp + DEP), uint64(block.timestamp + REF), uint32(STAKE));
    }

    function test_Refund_OneMatchDoesNotTouchAnotherMatchFunds() public {
        _funded(ID);
        _open(ID2, alice, bob);
        _deposit(ID2, alice);
        vm.warp(t0 + DEP + 1);
        escrow.refundExpired(ID2);
        // ID is still fully funded and untouched
        assertEq(_bal(address(escrow)), 2 * STAKE);
        assertFalse(_finalized(ID));
        assertTrue(_finalized(ID2));
    }
}
