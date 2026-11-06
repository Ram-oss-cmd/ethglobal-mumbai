// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {WalletRushEscrow} from "../WalletRushEscrow.sol";
import {WalletRushEscrowTestBase} from "./WalletRushEscrow.Base.t.sol";
import {MockFeeUSDC, MockNoopUSDC, MockHookUSDC} from "./mocks/MockUSDC.sol";
import {ReentrantPlayer} from "./mocks/ReentrantPlayer.sol";

/// @dev Blocklist deferral/claim, fee-on-transfer & short-transfer tokens, reentrancy.
contract WalletRushEscrowTokensTest is WalletRushEscrowTestBase {
    // ------------------------------------------------------------------ blocklist

    function test_Blocked_Draw_PaysOtherImmediatelyAndDefersBlocked() public {
        _funded(ID);
        usdc.setBlocked(bob, true);

        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 3, 4, 4, vu, RD);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit WalletRushEscrow.PayoutDeferred(ID, bob, STAKE);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit WalletRushEscrow.Settled(ID, 3, RD);
        escrow.settle(ID, 3, 4, 4, vu, RD, sig);

        assertEq(_bal(alice), START_BAL); // paid immediately
        assertEq(_bal(bob), START_BAL - STAKE); // not paid
        assertEq(escrow.claimable(bob), STAKE);
        assertEq(escrow.claimable(alice), 0);
        assertEq(_bal(address(escrow)), STAKE);
        assertTrue(_finalized(ID));
    }

    function test_Blocked_Cancel_PaysOtherImmediatelyAndDefersBlocked() public {
        _funded(ID);
        usdc.setBlocked(alice, true);
        _settle(ID, 4, 0, 0);
        assertEq(_bal(bob), START_BAL);
        assertEq(escrow.claimable(alice), STAKE);
    }

    function test_Blocked_Winner_FullPotDeferred() public {
        _funded(ID);
        usdc.setBlocked(alice, true);

        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 1, 5, 3, vu, RD);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit WalletRushEscrow.PayoutDeferred(ID, alice, 2 * STAKE);
        escrow.settle(ID, 1, 5, 3, vu, RD, sig);

        assertEq(escrow.claimable(alice), 2 * STAKE);
        assertEq(_bal(address(escrow)), 2 * STAKE);
    }

    function test_Blocked_FullPoolRefund_PaysOtherImmediatelyAndDefersBlocked() public {
        _funded(ID);
        usdc.setBlocked(alice, true);
        vm.warp(t0 + REF);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit WalletRushEscrow.PayoutDeferred(ID, alice, STAKE);
        escrow.refundExpired(ID);

        assertEq(_bal(bob), START_BAL);
        assertEq(escrow.claimable(alice), STAKE);
        assertEq(_bal(address(escrow)), STAKE);
        assertTrue(_finalized(ID));
    }

    function test_Blocked_PartialRefund_DefersBlockedDepositor() public {
        _open(ID, alice, bob);
        _deposit(ID, alice);
        usdc.setBlocked(alice, true);
        vm.warp(t0 + DEP + 1);
        escrow.refundExpired(ID);
        assertEq(escrow.claimable(alice), STAKE);
        assertEq(_bal(bob), START_BAL);
    }

    function test_Blocked_ClaimRevertsWhileBlockedThenSucceedsAfterUnblock() public {
        _funded(ID);
        usdc.setBlocked(bob, true);
        _settle(ID, 3, 1, 1);

        vm.prank(bob);
        vm.expectRevert(bytes("blocked"));
        escrow.claim();
        assertEq(escrow.claimable(bob), STAKE); // revert rolled back; credit preserved

        usdc.setBlocked(bob, false);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit WalletRushEscrow.Claimed(bob, STAKE);
        vm.prank(bob);
        escrow.claim();

        assertEq(escrow.claimable(bob), 0);
        assertEq(_bal(bob), START_BAL);
        assertEq(_bal(address(escrow)), 0);
    }

    function test_Claim_WithNothingReverts() public {
        vm.prank(alice);
        vm.expectRevert(WalletRushEscrow.NothingToClaim.selector);
        escrow.claim();
    }

    function test_Claim_SecondClaimRevertsNothingToClaim() public {
        _funded(ID);
        usdc.setBlocked(bob, true);
        _settle(ID, 3, 1, 1);
        usdc.setBlocked(bob, false);
        vm.startPrank(bob);
        escrow.claim();
        vm.expectRevert(WalletRushEscrow.NothingToClaim.selector);
        escrow.claim();
        vm.stopPrank();
    }

    function test_Claim_OnlyCallerOwnCreditIsPaid() public {
        _funded(ID);
        usdc.setBlocked(bob, true);
        _settle(ID, 3, 1, 1);
        usdc.setBlocked(bob, false);
        vm.prank(carol);
        vm.expectRevert(WalletRushEscrow.NothingToClaim.selector);
        escrow.claim();
        assertEq(escrow.claimable(bob), STAKE);
    }

    function test_Blocked_BothPlayersDeferred_ClaimIndependently() public {
        _funded(ID);
        usdc.setBlocked(alice, true);
        usdc.setBlocked(bob, true);
        _settle(ID, 3, 2, 2);
        assertEq(_bal(address(escrow)), 2 * STAKE);
        assertEq(escrow.claimable(alice) + escrow.claimable(bob), 2 * STAKE);

        usdc.setBlocked(alice, false);
        vm.prank(alice);
        escrow.claim();
        assertEq(_bal(alice), START_BAL);
        assertEq(escrow.claimable(bob), STAKE);
        assertEq(_bal(address(escrow)), STAKE);
    }

    function test_Blocked_DeferralsAccumulateAcrossMatches() public {
        _funded(ID);
        _funded(ID2);
        usdc.setBlocked(alice, true);
        _settle(ID, 1, 3, 1);
        _settle(ID2, 1, 3, 1);
        assertEq(escrow.claimable(alice), 4 * STAKE);
        usdc.setBlocked(alice, false);
        vm.prank(alice);
        escrow.claim();
        assertEq(_bal(alice), START_BAL - 2 * STAKE + 4 * STAKE);
        assertEq(_bal(address(escrow)), 0);
    }

    function test_Blocked_PlayerCanStillBeBlockedAtDepositAndRevertsCleanly() public {
        _open(ID, alice, bob);
        usdc.setBlocked(alice, true);
        vm.prank(alice);
        vm.expectRevert(bytes("blocked"));
        escrow.deposit(ID);
        (,,,, bool dA,,) = escrow.getMatch(ID);
        assertFalse(dA);
    }

    // ------------------------------------------------------------------ fee-on-transfer / short transfer

    function test_FeeOnTransferToken_DepositReverts() public {
        _open(ID, alice, bob);
        vm.etch(USDC_ADDR, address(new MockFeeUSDC()).code);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(WalletRushEscrow.IncorrectDepositAmount.selector, STAKE, STAKE - 1));
        escrow.deposit(ID);

        (,,,, bool dA,,) = escrow.getMatch(ID);
        assertFalse(dA);
        assertEq(_bal(address(escrow)), 0);
    }

    function test_NoopTransferToken_DepositReverts() public {
        _open(ID, alice, bob);
        vm.etch(USDC_ADDR, address(new MockNoopUSDC()).code);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(WalletRushEscrow.IncorrectDepositAmount.selector, STAKE, 0));
        escrow.deposit(ID);
        (,,,, bool dA,,) = escrow.getMatch(ID);
        assertFalse(dA);
    }

    // ------------------------------------------------------------------ reentrancy

    function _hookSetup() internal returns (ReentrantPlayer p) {
        vm.etch(USDC_ADDR, address(new MockHookUSDC()).code);
        p = new ReentrantPlayer(escrow);
        usdc.mint(address(p), START_BAL);
        _open(ID, address(p), bob);
        p.approveAndDeposit(ID);
        _deposit(ID, bob);
    }

    function _assertAllReentriesBlocked(ReentrantPlayer p) internal view {
        assertGt(p.hookCalls(), 0, "hook never fired");
        assertEq(p.successes(), 0, "a re-entrant call succeeded");
        assertGt(p.failureCount(), 0);
        for (uint256 i; i < p.failureCount(); ++i) {
            assertEq(p.failures(i), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        }
    }

    function test_Reentrancy_DuringSettlePayoutIsBlocked() public {
        ReentrantPlayer p = _hookSetup();
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 1, 5, 3, vu, RD);
        escrow.settle(ID, 1, 5, 3, vu, RD, sig);

        _assertAllReentriesBlocked(p);
        assertEq(_bal(address(p)), START_BAL + STAKE); // paid exactly once, immediately
        assertEq(escrow.claimable(address(p)), 0);
        assertEq(_bal(address(escrow)), 0);
        assertTrue(_finalized(ID));
    }

    function test_Reentrancy_DuringRefundPayoutIsBlocked() public {
        ReentrantPlayer p = _hookSetup();
        vm.warp(t0 + REF);
        escrow.refundExpired(ID);

        _assertAllReentriesBlocked(p);
        assertEq(_bal(address(p)), START_BAL);
        assertEq(_bal(bob), START_BAL);
        assertEq(_bal(address(escrow)), 0);
    }

    function test_Reentrancy_DuringClaimIsBlockedAndCreditZeroedFirst() public {
        ReentrantPlayer p = _hookSetup();
        usdc.setBlocked(address(p), true);
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 1, 5, 3, vu, RD);
        escrow.settle(ID, 1, 5, 3, vu, RD, sig);
        assertEq(escrow.claimable(address(p)), 2 * STAKE);
        assertEq(p.hookCalls(), 0); // blocked transfer reverted before the hook

        usdc.setBlocked(address(p), false);
        p.doClaim();

        _assertAllReentriesBlocked(p);
        assertEq(escrow.claimable(address(p)), 0);
        assertEq(_bal(address(p)), START_BAL - STAKE + 2 * STAKE);
        assertEq(_bal(address(escrow)), 0);
    }
}
