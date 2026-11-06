// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {WalletRushEscrow} from "../WalletRushEscrow.sol";
import {WalletRushEscrowTestBase} from "./WalletRushEscrow.Base.t.sol";

contract WalletRushEscrowFuzzTest is WalletRushEscrowTestBase {
    function _validScores(uint8 outcome, uint32 sa, uint32 sb) internal pure returns (bool) {
        if (outcome < 1 || outcome > 4) return false;
        if (outcome == 1) return sa > sb;
        if (outcome == 2) return sb > sa;
        if (outcome == 3) return sa == sb;
        return true;
    }

    /// PROPERTY: settle succeeds iff outcome in 1..4 and the score rule for that outcome holds.
    function testFuzz_Settle_OutcomeAndScoreRules(uint8 outcome, uint32 sa, uint32 sb, bool sameScore) public {
        outcome = uint8(bound(outcome, 0, 6));
        if (sameScore) sb = sa;
        _funded(ID);

        uint64 vu = _vu();
        bytes memory sig = _refSig(ID, outcome, sa, sb, vu, RD);
        (bool ok,) = address(escrow).call(abi.encodeCall(escrow.settle, (ID, outcome, sa, sb, vu, RD, sig)));

        bool expected = _validScores(outcome, sa, sb);
        assertEq(ok, expected, "settle success must equal rule validity");
        assertEq(_finalized(ID), expected);
        if (!expected) assertEq(_bal(address(escrow)), 2 * STAKE);
    }

    /// PROPERTY: after any valid settlement, escrow holds 0 and total player funds are conserved,
    /// with payouts matching the outcome.
    function testFuzz_Settle_ConservesValueAndPaysCorrectly(uint8 outcome, uint32 sa, uint32 sb) public {
        outcome = uint8(bound(outcome, 1, 4));
        if (outcome == 1) {
            sa = uint32(bound(sa, 1, type(uint32).max));
            sb = uint32(bound(sb, 0, sa - 1));
        } else if (outcome == 2) {
            sb = uint32(bound(sb, 1, type(uint32).max));
            sa = uint32(bound(sa, 0, sb - 1));
        } else if (outcome == 3) {
            sb = sa;
        }
        _funded(ID);
        _settle(ID, outcome, sa, sb);

        assertEq(_bal(address(escrow)), 0);
        assertEq(_bal(alice) + _bal(bob), 2 * START_BAL);
        if (outcome == 1) assertEq(_bal(alice), START_BAL + STAKE);
        else if (outcome == 2) assertEq(_bal(bob), START_BAL + STAKE);
        else assertEq(_bal(alice), START_BAL);
    }

    /// PROPERTY: refundExpired is available iff (now > depositDeadline and pool incomplete) or now >= refundAfter;
    /// on success escrow holds 0 and every depositor has their stake back.
    function testFuzz_Refund_TimingAndConservation(uint256 offset, bool aDep, bool bDep) public {
        _open(ID, alice, bob);
        if (aDep) _deposit(ID, alice);
        if (bDep) _deposit(ID, bob);

        uint256 now_ = t0 + bound(offset, 0, 2 * uint256(REF));
        vm.warp(now_);

        bool available = (now_ > t0 + DEP && !(aDep && bDep)) || now_ >= t0 + REF;
        (bool ok,) = address(escrow).call(abi.encodeCall(escrow.refundExpired, (ID)));
        assertEq(ok, available);

        if (available) {
            assertEq(_bal(address(escrow)), 0);
            assertEq(_bal(alice), START_BAL);
            assertEq(_bal(bob), START_BAL);
            assertTrue(_finalized(ID));
        } else {
            uint256 pool = (aDep ? STAKE : 0) + (bDep ? STAKE : 0);
            assertEq(_bal(address(escrow)), pool);
            assertFalse(_finalized(ID));
        }
    }

    /// PROPERTY: for any mix of per-match terminal/non-terminal paths, escrow balance equals
    /// STAKE * deposits of the still-open matches, and total token supply held by players+escrow is conserved.
    function testFuzz_Conservation_MultipleMatches(uint256 seed, uint8 n) public {
        uint256 count = bound(n, 1, 12);
        bytes32[] memory ids = new bytes32[](count);
        uint8[] memory paths = new uint8[](count);
        uint256 expectedEscrow;

        // phase 1: t0 -- open, deposit, settle
        for (uint256 i; i < count; ++i) {
            ids[i] = keccak256(abi.encode("fuzz-match", i));
            paths[i] = uint8(uint256(keccak256(abi.encode(seed, i))) % 9);
            _open(ids[i], alice, bob);
            uint8 p = paths[i];
            if (p == 0 || p == 8 || (p >= 2 && p <= 5)) {
                _deposit(ids[i], alice);
                _deposit(ids[i], bob);
            } else if (p == 1 || p == 6) {
                _deposit(ids[i], alice);
            }
            if (p == 2) _settle(ids[i], 1, 2, 1);
            else if (p == 3) _settle(ids[i], 2, 1, 2);
            else if (p == 4) _settle(ids[i], 3, 1, 1);
            else if (p == 5) _settle(ids[i], 4, 0, 0);
            else if (p == 0) expectedEscrow += 2 * STAKE;
            else if (p == 1) expectedEscrow += STAKE;
        }
        // phase 2: past deposit deadline -- refund incomplete pools (6: only A, 7: none)
        vm.warp(t0 + DEP + 1);
        for (uint256 i; i < count; ++i) {
            if (paths[i] == 6 || paths[i] == 7) escrow.refundExpired(ids[i]);
            else if (paths[i] == 8) expectedEscrow += 2 * STAKE;
        }
        // phase 3: at refundAfter -- refund complete pools that never settled (8)
        vm.warp(t0 + REF);
        for (uint256 i; i < count; ++i) {
            if (paths[i] == 8) {
                escrow.refundExpired(ids[i]);
                expectedEscrow -= 2 * STAKE;
            }
        }

        assertEq(_bal(address(escrow)), expectedEscrow);
        assertEq(_bal(alice) + _bal(bob) + _bal(address(escrow)), 2 * START_BAL);
        for (uint256 i; i < count; ++i) {
            bool terminal = paths[i] >= 2;
            assertEq(_finalized(ids[i]), terminal);
        }
    }
}
