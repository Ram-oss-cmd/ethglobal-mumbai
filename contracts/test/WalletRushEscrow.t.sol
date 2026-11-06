// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {WalletRushEscrow} from "../WalletRushEscrow.sol";
import {WalletRushEscrowTestBase} from "./WalletRushEscrow.Base.t.sol";

/// @dev Constructor, openMatch, deposit, getMatch, typed-data compatibility.
contract WalletRushEscrowTest is WalletRushEscrowTestBase {
    // ------------------------------------------------------------------ constructor

    function test_Constructor_StoresReferee() public view {
        assertEq(escrow.REFEREE(), referee);
        assertEq(address(escrow.USDC()), USDC_ADDR);
        assertEq(escrow.STAKE(), STAKE);
    }

    function test_Constructor_RevertsOnZeroReferee() public {
        vm.expectRevert(WalletRushEscrow.ZeroReferee.selector);
        new WalletRushEscrow(address(0));
    }

    // ------------------------------------------------------------------ openMatch

    function test_OpenMatch_StoresAndEmits() public {
        vm.expectEmit(true, true, true, true, address(escrow));
        emit WalletRushEscrow.MatchOpened(ID, alice, bob, t0 + DEP, t0 + REF);
        _open(ID, alice, bob);

        (address pa, address pb, uint64 dd, uint64 ra, bool dA, bool dB, bool fin) = escrow.getMatch(ID);
        assertEq(pa, alice);
        assertEq(pb, bob);
        assertEq(dd, t0 + DEP);
        assertEq(ra, t0 + REF);
        assertFalse(dA);
        assertFalse(dB);
        assertFalse(fin);
    }

    function test_OpenMatch_RevertsForNonReferee() public {
        vm.prank(carol);
        vm.expectRevert(WalletRushEscrow.UnauthorizedReferee.selector);
        escrow.openMatch(ID, alice, bob, t0 + DEP, t0 + REF);
    }

    function test_OpenMatch_RevertsForPlayerCaller() public {
        vm.prank(alice);
        vm.expectRevert(WalletRushEscrow.UnauthorizedReferee.selector);
        escrow.openMatch(ID, alice, bob, t0 + DEP, t0 + REF);
    }

    function test_OpenMatch_RevertsOnZeroId() public {
        vm.prank(referee);
        vm.expectRevert(WalletRushEscrow.InvalidMatchId.selector);
        escrow.openMatch(bytes32(0), alice, bob, t0 + DEP, t0 + REF);
    }

    function test_OpenMatch_RevertsOnDuplicateId() public {
        _open(ID, alice, bob);
        vm.prank(referee);
        vm.expectRevert(WalletRushEscrow.MatchAlreadyExists.selector);
        escrow.openMatch(ID, carol, mallory, t0 + DEP, t0 + REF);
    }

    function test_OpenMatch_RevertsOnZeroPlayerA() public {
        vm.prank(referee);
        vm.expectRevert(WalletRushEscrow.InvalidPlayers.selector);
        escrow.openMatch(ID, address(0), bob, t0 + DEP, t0 + REF);
    }

    function test_OpenMatch_RevertsOnZeroPlayerB() public {
        vm.prank(referee);
        vm.expectRevert(WalletRushEscrow.InvalidPlayers.selector);
        escrow.openMatch(ID, alice, address(0), t0 + DEP, t0 + REF);
    }

    function test_OpenMatch_RevertsWhenPlayersEqual() public {
        vm.prank(referee);
        vm.expectRevert(WalletRushEscrow.InvalidPlayers.selector);
        escrow.openMatch(ID, alice, alice, t0 + DEP, t0 + REF);
    }

    function test_OpenMatch_RevertsWhenDepositDeadlineEqualsNow() public {
        vm.prank(referee);
        vm.expectRevert(WalletRushEscrow.InvalidDepositDeadline.selector);
        escrow.openMatch(ID, alice, bob, t0, t0 + REF);
    }

    function test_OpenMatch_RevertsWhenDepositDeadlineExpired() public {
        vm.prank(referee);
        vm.expectRevert(WalletRushEscrow.InvalidDepositDeadline.selector);
        escrow.openMatch(ID, alice, bob, t0 - 1, t0 + REF);
    }

    function test_OpenMatch_AcceptsDepositDeadlineOneSecondAhead() public {
        vm.prank(referee);
        escrow.openMatch(ID, alice, bob, t0 + 1, t0 + 2);
        (,, uint64 dd,,,,) = escrow.getMatch(ID);
        assertEq(dd, t0 + 1);
    }

    function test_OpenMatch_RevertsWhenRefundAfterEqualsDepositDeadline() public {
        vm.prank(referee);
        vm.expectRevert(WalletRushEscrow.InvalidRefundAfter.selector);
        escrow.openMatch(ID, alice, bob, t0 + DEP, t0 + DEP);
    }

    function test_OpenMatch_RevertsWhenRefundAfterBeforeDepositDeadline() public {
        vm.prank(referee);
        vm.expectRevert(WalletRushEscrow.InvalidRefundAfter.selector);
        escrow.openMatch(ID, alice, bob, t0 + DEP, t0 + DEP - 1);
    }

    function test_OpenMatch_ReopeningFinalizedMatchFails() public {
        _funded(ID);
        _settle(ID, 1, 5, 3);
        assertTrue(_finalized(ID));
        vm.prank(referee);
        vm.expectRevert(WalletRushEscrow.MatchAlreadyExists.selector);
        escrow.openMatch(ID, alice, bob, t0 + DEP, t0 + REF);
    }

    // ------------------------------------------------------------------ deposit

    function test_Deposit_PlayerAHappyPath() public {
        _open(ID, alice, bob);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit WalletRushEscrow.Deposited(ID, alice, STAKE);
        _deposit(ID, alice);

        assertEq(_bal(alice), START_BAL - STAKE);
        assertEq(_bal(address(escrow)), STAKE);
        (,,,, bool dA, bool dB,) = escrow.getMatch(ID);
        assertTrue(dA);
        assertFalse(dB);
    }

    function test_Deposit_PlayerBHappyPath() public {
        _open(ID, alice, bob);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit WalletRushEscrow.Deposited(ID, bob, STAKE);
        _deposit(ID, bob);

        assertEq(_bal(bob), START_BAL - STAKE);
        assertEq(_bal(address(escrow)), STAKE);
        (,,,, bool dA, bool dB,) = escrow.getMatch(ID);
        assertFalse(dA);
        assertTrue(dB);
    }

    function test_Deposit_BothPlayersFundPool() public {
        _funded(ID);
        assertEq(_bal(address(escrow)), 2 * STAKE);
    }

    function test_Deposit_AtExactlyDepositDeadlineSucceeds() public {
        _open(ID, alice, bob);
        vm.warp(t0 + DEP);
        _deposit(ID, alice);
        (,,,, bool dA,,) = escrow.getMatch(ID);
        assertTrue(dA);
    }

    function test_Deposit_AfterDepositDeadlineReverts() public {
        _open(ID, alice, bob);
        vm.warp(t0 + DEP + 1);
        vm.prank(alice);
        vm.expectRevert(WalletRushEscrow.DepositWindowClosed.selector);
        escrow.deposit(ID);
    }

    function test_Deposit_NonPlayerReverts() public {
        _open(ID, alice, bob);
        vm.prank(mallory);
        vm.expectRevert(WalletRushEscrow.NotPlayer.selector);
        escrow.deposit(ID);
    }

    function test_Deposit_RefereeIsNotAPlayer() public {
        _open(ID, alice, bob);
        vm.prank(referee);
        vm.expectRevert(WalletRushEscrow.NotPlayer.selector);
        escrow.deposit(ID);
    }

    function test_Deposit_DuplicateByAReverts() public {
        _open(ID, alice, bob);
        _deposit(ID, alice);
        vm.prank(alice);
        vm.expectRevert(WalletRushEscrow.AlreadyDeposited.selector);
        escrow.deposit(ID);
    }

    function test_Deposit_DuplicateByBReverts() public {
        _open(ID, alice, bob);
        _deposit(ID, bob);
        vm.prank(bob);
        vm.expectRevert(WalletRushEscrow.AlreadyDeposited.selector);
        escrow.deposit(ID);
    }

    function test_Deposit_UnknownMatchReverts() public {
        vm.prank(alice);
        vm.expectRevert(WalletRushEscrow.MatchNotFound.selector);
        escrow.deposit(ID);
    }

    function test_Deposit_IntoSettledMatchReverts() public {
        _funded(ID);
        _settle(ID, 3, 2, 2);
        vm.prank(alice);
        vm.expectRevert(WalletRushEscrow.MatchFinalized.selector);
        escrow.deposit(ID);
    }

    function test_Deposit_IntoRefundedMatchReverts() public {
        _open(ID, alice, bob);
        _deposit(ID, alice);
        vm.warp(t0 + DEP + 1);
        escrow.refundExpired(ID);
        vm.prank(bob);
        vm.expectRevert(WalletRushEscrow.MatchFinalized.selector);
        escrow.deposit(ID);
    }

    function test_Deposit_WithoutAllowanceRevertsAndLeavesNoState() public {
        _open(ID, alice, bob);
        vm.prank(alice);
        usdc.approve(address(escrow), 0);
        vm.prank(alice);
        vm.expectRevert(bytes("allowance"));
        escrow.deposit(ID);
        (,,,, bool dA,,) = escrow.getMatch(ID);
        assertFalse(dA);
    }

    // ------------------------------------------------------------------ getMatch

    function test_GetMatch_ReturnOrder() public {
        vm.prank(referee);
        escrow.openMatch(ID, carol, mallory, t0 + 111, t0 + 222);
        _deposit(ID, mallory);

        (address pa, address pb, uint64 dd, uint64 ra, bool dA, bool dB, bool fin) = escrow.getMatch(ID);
        assertEq(pa, carol);
        assertEq(pb, mallory);
        assertEq(dd, t0 + 111);
        assertEq(ra, t0 + 222);
        assertFalse(dA);
        assertTrue(dB);
        assertFalse(fin);
    }

    function test_GetMatch_UnknownIdReturnsZeros() public view {
        (address pa, address pb, uint64 dd, uint64 ra, bool dA, bool dB, bool fin) = escrow.getMatch(keccak256("nope"));
        assertEq(pa, address(0));
        assertEq(pb, address(0));
        assertEq(dd, 0);
        assertEq(ra, 0);
        assertFalse(dA);
        assertFalse(dB);
        assertFalse(fin);
    }

    // ------------------------------------------------------------------ typed data

    function test_HashResult_MatchesIndependentEip712Digest() public {
        _open(ID, alice, bob);
        uint64 vu = _vu();
        bytes32 expected = _independentDigest(ID, alice, bob, 1, 7, 3, vu, RD);
        assertEq(escrow.hashResult(ID, 1, 7, 3, vu, RD), expected);
    }

    function testFuzz_HashResult_MatchesIndependentEip712Digest(
        uint8 outcome,
        uint32 sa,
        uint32 sb,
        uint64 vu,
        bytes32 rd,
        bytes32 id
    ) public {
        vm.assume(id != bytes32(0));
        _open(id, carol, mallory);
        assertEq(escrow.hashResult(id, outcome, sa, sb, vu, rd), _independentDigest(id, carol, mallory, outcome, sa, sb, vu, rd));
    }

    function test_HashResult_DomainFieldsMatchSpec() public view {
        (bytes1 fields, string memory name, string memory version, uint256 chainId, address vc,,) = escrow.eip712Domain();
        assertEq(uint8(fields), 0x0f);
        assertEq(name, "Wallet Rush Escrow");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(vc, address(escrow));
    }

    function test_HashResult_TypehashMatchesSpec() public view {
        assertEq(
            escrow.RESULT_TYPEHASH(),
            keccak256(
                "Result(bytes32 matchId,address playerA,address playerB,uint8 outcome,uint32 scoreA,uint32 scoreB,uint64 validUntil,bytes32 replayDigest)"
            )
        );
    }

    function test_HashResult_ChangesWithChainId() public {
        _open(ID, alice, bob);
        uint64 vu = _vu();
        bytes32 before_ = escrow.hashResult(ID, 1, 7, 3, vu, RD);
        vm.chainId(5042002);
        bytes32 after_ = escrow.hashResult(ID, 1, 7, 3, vu, RD);
        assertTrue(before_ != after_);
        assertEq(after_, _independentDigest(ID, alice, bob, 1, 7, 3, vu, RD));
    }

    function test_HashResult_UnknownMatchReverts() public {
        vm.expectRevert(WalletRushEscrow.MatchNotFound.selector);
        escrow.hashResult(ID, 1, 1, 0, 1, RD);
    }

    function test_HashResult_BindsParticipants() public {
        _open(ID, alice, bob);
        _open(ID2, bob, alice);
        // same fields, swapped players -> different digest even with identical other inputs
        assertTrue(escrow.hashResult(ID, 1, 7, 3, 99, RD) != escrow.hashResult(ID2, 1, 7, 3, 99, RD));
    }
}
