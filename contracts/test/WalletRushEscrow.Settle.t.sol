// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {WalletRushEscrow} from "../WalletRushEscrow.sol";
import {WalletRushEscrowTestBase} from "./WalletRushEscrow.Base.t.sol";

contract WalletRushEscrowSettleTest is WalletRushEscrowTestBase {
    function setUp() public override {
        super.setUp();
    }

    // ------------------------------------------------------------------ happy paths

    function test_Settle_Outcome1_PaysPlayerA20() public {
        _funded(ID);
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 1, 9, 4, vu, RD);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit WalletRushEscrow.Settled(ID, 1, RD);
        vm.prank(carol);
        escrow.settle(ID, 1, 9, 4, vu, RD, sig);

        assertEq(_bal(alice), START_BAL - STAKE + 2 * STAKE);
        assertEq(_bal(bob), START_BAL - STAKE);
        assertEq(_bal(address(escrow)), 0);
        assertTrue(_finalized(ID));
        assertEq(escrow.claimable(alice), 0);
    }

    function test_Settle_Outcome2_PaysPlayerB20() public {
        _funded(ID);
        _settle(ID, 2, 2, 8);
        assertEq(_bal(bob), START_BAL - STAKE + 2 * STAKE);
        assertEq(_bal(alice), START_BAL - STAKE);
        assertEq(_bal(address(escrow)), 0);
        assertTrue(_finalized(ID));
    }

    function test_Settle_Outcome3_DrawReturns10Each() public {
        _funded(ID);
        _settle(ID, 3, 6, 6);
        assertEq(_bal(alice), START_BAL);
        assertEq(_bal(bob), START_BAL);
        assertEq(_bal(address(escrow)), 0);
        assertTrue(_finalized(ID));
    }

    function test_Settle_Outcome3_ZeroZeroDraw() public {
        _funded(ID);
        _settle(ID, 3, 0, 0);
        assertEq(_bal(alice), START_BAL);
        assertEq(_bal(bob), START_BAL);
    }

    function test_Settle_Outcome4_CancellationReturns10Each() public {
        _funded(ID);
        _settle(ID, 4, 0, 0);
        assertEq(_bal(alice), START_BAL);
        assertEq(_bal(bob), START_BAL);
        assertEq(_bal(address(escrow)), 0);
        assertTrue(_finalized(ID));
    }

    function test_Settle_Outcome4_IgnoresScores() public {
        _funded(ID);
        _settle(ID, 4, 7, 2);
        assertEq(_bal(alice), START_BAL);
        assertEq(_bal(bob), START_BAL);
    }

    function test_Settle_AnyoneCanSubmitRefereeSignedResult() public {
        _funded(ID);
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 1, 2, 1, vu, RD);
        vm.prank(mallory);
        escrow.settle(ID, 1, 2, 1, vu, RD, sig);
        assertTrue(_finalized(ID));
    }

    function test_Settle_AcceptsSignatureOverIndependentlyComputedDigest() public {
        _funded(ID);
        uint64 vu = _vu();
        bytes32 digest = _independentDigest(ID, alice, bob, 2, 1, 5, vu, RD);
        bytes memory sig = _sign(refPk, digest);
        escrow.settle(ID, 2, 1, 5, vu, RD, sig);
        assertEq(_bal(bob), START_BAL + STAKE);
    }

    function test_Settle_AtValidUntilBoundarySucceeds() public {
        _funded(ID);
        uint64 vu = uint64(block.timestamp + 100);
        bytes memory sig = _refSig(ID, 1, 2, 1, vu, RD);
        vm.warp(vu);
        escrow.settle(ID, 1, 2, 1, vu, RD, sig);
        assertTrue(_finalized(ID));
    }

    // ------------------------------------------------------------------ invalid inputs

    function _expectSettleRevert(bytes memory err, uint8 outcome, uint32 sa, uint32 sb) internal {
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, outcome, sa, sb, vu, RD);
        vm.expectRevert(err);
        escrow.settle(ID, outcome, sa, sb, vu, RD, sig);
    }

    function test_Settle_Win1RevertsWhenScoreEqual() public {
        _funded(ID);
        _expectSettleRevert(abi.encodeWithSelector(WalletRushEscrow.InvalidScores.selector, 1, 5, 5), 1, 5, 5);
    }

    function test_Settle_Win1RevertsWhenScoreLower() public {
        _funded(ID);
        _expectSettleRevert(abi.encodeWithSelector(WalletRushEscrow.InvalidScores.selector, 1, 3, 5), 1, 3, 5);
    }

    function test_Settle_Win2RevertsWhenScoreEqual() public {
        _funded(ID);
        _expectSettleRevert(abi.encodeWithSelector(WalletRushEscrow.InvalidScores.selector, 2, 5, 5), 2, 5, 5);
    }

    function test_Settle_Win2RevertsWhenScoreLower() public {
        _funded(ID);
        _expectSettleRevert(abi.encodeWithSelector(WalletRushEscrow.InvalidScores.selector, 2, 7, 5), 2, 7, 5);
    }

    function test_Settle_DrawRevertsWhenScoresUnequal() public {
        _funded(ID);
        _expectSettleRevert(abi.encodeWithSelector(WalletRushEscrow.InvalidScores.selector, 3, 4, 5), 3, 4, 5);
    }

    function test_Settle_InvalidOutcome0Reverts() public {
        _funded(ID);
        _expectSettleRevert(abi.encodeWithSelector(WalletRushEscrow.InvalidOutcome.selector, 0), 0, 1, 0);
    }

    function test_Settle_InvalidOutcome5Reverts() public {
        _funded(ID);
        _expectSettleRevert(abi.encodeWithSelector(WalletRushEscrow.InvalidOutcome.selector, 5), 5, 1, 0);
    }

    function test_Settle_InvalidOutcome255Reverts() public {
        _funded(ID);
        _expectSettleRevert(abi.encodeWithSelector(WalletRushEscrow.InvalidOutcome.selector, 255), 255, 1, 0);
    }

    function test_Settle_ZeroReplayDigestReverts() public {
        _funded(ID);
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 1, 2, 1, vu, bytes32(0));
        vm.expectRevert(WalletRushEscrow.InvalidReplayDigest.selector);
        escrow.settle(ID, 1, 2, 1, vu, bytes32(0), sig);
    }

    // ------------------------------------------------------------------ signatures

    function test_Settle_WrongSignerReverts() public {
        _funded(ID);
        uint64 vu = _vu();
        (, uint256 otherPk) = makeAddrAndKey("not-referee");
        bytes memory sig = _sign(otherPk, escrow.hashResult(ID, 1, 2, 1, vu, RD));
        vm.expectRevert(WalletRushEscrow.InvalidSignature.selector);
        escrow.settle(ID, 1, 2, 1, vu, RD, sig);
        assertFalse(_finalized(ID));
    }

    function test_Settle_PlayerSignatureIsNotAccepted() public {
        _funded(ID);
        uint64 vu = _vu();
        (, uint256 pk) = makeAddrAndKey("alice-key");
        bytes memory sig = _sign(pk, escrow.hashResult(ID, 1, 2, 1, vu, RD));
        vm.expectRevert(WalletRushEscrow.InvalidSignature.selector);
        escrow.settle(ID, 1, 2, 1, vu, RD, sig);
    }

    function test_Settle_MalformedOrEmptySignatureReverts() public {
        _funded(ID);
        uint64 vu = _vu();
        vm.expectRevert(WalletRushEscrow.InvalidSignature.selector);
        escrow.settle(ID, 1, 2, 1, vu, RD, "");
        vm.expectRevert(WalletRushEscrow.InvalidSignature.selector);
        escrow.settle(ID, 1, 2, 1, vu, RD, hex"1234567890");
        vm.expectRevert(WalletRushEscrow.InvalidSignature.selector);
        escrow.settle(ID, 1, 2, 1, vu, RD, new bytes(65));
    }

    function test_Settle_PersonalSignPrefixedDigestIsRejected() public {
        _funded(ID);
        uint64 vu = _vu();
        bytes32 raw = escrow.hashResult(ID, 1, 2, 1, vu, RD);
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", raw));
        bytes memory sig = _sign(refPk, prefixed);
        vm.expectRevert(WalletRushEscrow.InvalidSignature.selector);
        escrow.settle(ID, 1, 2, 1, vu, RD, sig);
    }

    function test_Settle_TamperedOutcomeReverts() public {
        _funded(ID);
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 1, 3, 5, vu, RD); // signed for A-wins? (invalid scores for 1, but sig is over fields)
        // submit as outcome 2 with same scores (valid scores for B win) -> signature mismatch
        vm.expectRevert(WalletRushEscrow.InvalidSignature.selector);
        escrow.settle(ID, 2, 3, 5, vu, RD, sig);
    }

    function test_Settle_TamperedScoreAReverts() public {
        _funded(ID);
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 1, 5, 3, vu, RD);
        vm.expectRevert(WalletRushEscrow.InvalidSignature.selector);
        escrow.settle(ID, 1, 6, 3, vu, RD, sig);
    }

    function test_Settle_TamperedScoreBReverts() public {
        _funded(ID);
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 1, 5, 3, vu, RD);
        vm.expectRevert(WalletRushEscrow.InvalidSignature.selector);
        escrow.settle(ID, 1, 5, 2, vu, RD, sig);
    }

    function test_Settle_TamperedValidUntilReverts() public {
        _funded(ID);
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 1, 5, 3, vu, RD);
        vm.expectRevert(WalletRushEscrow.InvalidSignature.selector);
        escrow.settle(ID, 1, 5, 3, vu + 1, RD, sig);
    }

    function test_Settle_TamperedReplayDigestReverts() public {
        _funded(ID);
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 1, 5, 3, vu, RD);
        vm.expectRevert(WalletRushEscrow.InvalidSignature.selector);
        escrow.settle(ID, 1, 5, 3, vu, keccak256("other"), sig);
    }

    function test_Settle_TamperedSignatureVReverts() public {
        _funded(ID);
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 1, 5, 3, vu, RD);
        sig[64] = sig[64] == bytes1(uint8(27)) ? bytes1(uint8(28)) : bytes1(uint8(27));
        vm.expectRevert(WalletRushEscrow.InvalidSignature.selector);
        escrow.settle(ID, 1, 5, 3, vu, RD, sig);
    }

    function test_Settle_ExpiredSignatureReverts() public {
        _funded(ID);
        uint64 vu = uint64(block.timestamp + 100);
        bytes memory sig = _refSig(ID, 1, 5, 3, vu, RD);
        vm.warp(vu + 1);
        vm.expectRevert(WalletRushEscrow.ResultExpired.selector);
        escrow.settle(ID, 1, 5, 3, vu, RD, sig);
    }

    function test_Settle_CrossMatchReplaySameParticipantsReverts() public {
        _funded(ID);
        _funded(ID2); // same players alice/bob, different id
        uint64 vu = _vu();
        bytes memory sigForId1 = _refSig(ID, 1, 5, 3, vu, RD);
        vm.expectRevert(WalletRushEscrow.InvalidSignature.selector);
        escrow.settle(ID2, 1, 5, 3, vu, RD, sigForId1);
        // the signature still works on the match it was issued for
        escrow.settle(ID, 1, 5, 3, vu, RD, sigForId1);
        assertTrue(_finalized(ID));
        assertFalse(_finalized(ID2));
    }

    function test_Settle_CrossMatchReplayDifferentParticipantsReverts() public {
        _funded(ID);
        _open(ID3, carol, mallory);
        _deposit(ID3, carol);
        _deposit(ID3, mallory);
        uint64 vu = _vu();
        bytes memory sigForId1 = _refSig(ID, 1, 5, 3, vu, RD);
        vm.expectRevert(WalletRushEscrow.InvalidSignature.selector);
        escrow.settle(ID3, 1, 5, 3, vu, RD, sigForId1);
        assertEq(_bal(carol), START_BAL - STAKE);
    }

    function test_Settle_SignatureBindsPlayers_SwappedRolesWithSameIdSemantics() public {
        // match with swapped roles has a different digest, so a sig for (alice,bob) can't pay (bob,alice)
        _funded(ID);
        _open(ID2, bob, alice);
        _deposit(ID2, bob);
        _deposit(ID2, alice);
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 1, 5, 3, vu, RD);
        vm.expectRevert(WalletRushEscrow.InvalidSignature.selector);
        escrow.settle(ID2, 1, 5, 3, vu, RD, sig);
    }

    // ------------------------------------------------------------------ state / timing

    function test_Settle_UnknownMatchReverts() public {
        vm.expectRevert(WalletRushEscrow.MatchNotFound.selector);
        escrow.settle(ID, 1, 2, 1, _vu(), RD, new bytes(65));
    }

    function test_Settle_NoDepositsReverts() public {
        _open(ID, alice, bob);
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 1, 2, 1, vu, RD);
        vm.expectRevert(WalletRushEscrow.MissingDeposits.selector);
        escrow.settle(ID, 1, 2, 1, vu, RD, sig);
    }

    function test_Settle_OnlyADepositedReverts() public {
        _open(ID, alice, bob);
        _deposit(ID, alice);
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 1, 2, 1, vu, RD);
        vm.expectRevert(WalletRushEscrow.MissingDeposits.selector);
        escrow.settle(ID, 1, 2, 1, vu, RD, sig);
    }

    function test_Settle_OnlyBDepositedReverts() public {
        _open(ID, alice, bob);
        _deposit(ID, bob);
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 2, 1, 2, vu, RD);
        vm.expectRevert(WalletRushEscrow.MissingDeposits.selector);
        escrow.settle(ID, 2, 1, 2, vu, RD, sig);
    }

    function test_Settle_JustBeforeRefundAfterSucceeds() public {
        _funded(ID);
        vm.warp(t0 + REF - 1);
        uint64 vu = uint64(block.timestamp + 100);
        bytes memory sig = _refSig(ID, 1, 2, 1, vu, RD);
        escrow.settle(ID, 1, 2, 1, vu, RD, sig);
        assertTrue(_finalized(ID));
    }

    function test_Settle_AtRefundAfterReverts() public {
        _funded(ID);
        vm.warp(t0 + REF);
        uint64 vu = uint64(block.timestamp + 100);
        bytes memory sig = _refSig(ID, 1, 2, 1, vu, RD);
        vm.expectRevert(WalletRushEscrow.SettlementWindowClosed.selector);
        escrow.settle(ID, 1, 2, 1, vu, RD, sig);
    }

    function test_Settle_AfterRefundAfterReverts() public {
        _funded(ID);
        vm.warp(t0 + REF + 5 days);
        uint64 vu = uint64(block.timestamp + 100);
        bytes memory sig = _refSig(ID, 1, 2, 1, vu, RD);
        vm.expectRevert(WalletRushEscrow.SettlementWindowClosed.selector);
        escrow.settle(ID, 1, 2, 1, vu, RD, sig);
    }

    function test_Settle_DoubleSettleReverts() public {
        _funded(ID);
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 1, 5, 3, vu, RD);
        escrow.settle(ID, 1, 5, 3, vu, RD, sig);
        vm.expectRevert(WalletRushEscrow.MatchFinalized.selector);
        escrow.settle(ID, 1, 5, 3, vu, RD, sig);
        assertEq(_bal(alice), START_BAL + STAKE); // paid exactly once
    }

    function test_Settle_AfterRefundReverts() public {
        _funded(ID);
        vm.warp(t0 + REF);
        escrow.refundExpired(ID);
        // refund time already beyond refundAfter; MatchFinalized takes precedence
        uint64 vu = uint64(block.timestamp + 100);
        bytes memory sig = _refSig(ID, 1, 5, 3, vu, RD);
        vm.expectRevert(WalletRushEscrow.MatchFinalized.selector);
        escrow.settle(ID, 1, 5, 3, vu, RD, sig);
    }

    function test_Settle_AfterPartialRefundReverts() public {
        _open(ID, alice, bob);
        _deposit(ID, alice);
        vm.warp(t0 + DEP + 1);
        escrow.refundExpired(ID);
        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, 1, 5, 3, vu, RD);
        vm.expectRevert(WalletRushEscrow.MatchFinalized.selector);
        escrow.settle(ID, 1, 5, 3, vu, RD, sig);
    }
}
