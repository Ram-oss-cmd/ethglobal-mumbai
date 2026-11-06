// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {WalletRushEscrow} from "../WalletRushEscrow.sol";
import {WalletRushEscrowTestBase} from "./WalletRushEscrow.Base.t.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Drives bounded, mostly-valid random action sequences against the escrow.
contract WalletRushEscrowHandler is Test {
    WalletRushEscrow public immutable escrow;
    MockUSDC public immutable usdc;
    address public immutable referee;
    uint256 internal immutable refPk;

    address[] public actors;
    bytes32[] public ids;
    uint256 public settledCount;
    uint256 public refundedCount;
    uint256 public deferredClaims;

    constructor(WalletRushEscrow _escrow, MockUSDC _usdc, address _referee, uint256 _refPk, address[] memory _actors) {
        escrow = _escrow;
        usdc = _usdc;
        referee = _referee;
        refPk = _refPk;
        actors = _actors;
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _id(uint256 seed) internal view returns (bytes32) {
        return ids[seed % ids.length];
    }

    function open(uint256 a, uint256 offB, uint256 ddOff, uint256 raOff) external {
        if (ids.length >= 12) return;
        address pa = actors[a % actors.length];
        address pb = actors[(a + 1 + (offB % (actors.length - 1))) % actors.length];
        uint64 dd = uint64(block.timestamp + bound(ddOff, 1, 3 hours));
        uint64 ra = dd + uint64(bound(raOff, 1, 1 days));
        bytes32 id = keccak256(abi.encode("inv", ids.length));
        vm.prank(referee);
        escrow.openMatch(id, pa, pb, dd, ra);
        ids.push(id);
    }

    function deposit(uint256 idSeed, bool asA) external {
        if (ids.length == 0) return;
        bytes32 id = _id(idSeed);
        (address pa, address pb,,,,,) = escrow.getMatch(id);
        vm.prank(asA ? pa : pb);
        try escrow.deposit(id) {} catch {}
    }

    function settle(uint256 idSeed, uint8 outcomeSeed, uint32 base) external {
        if (ids.length == 0) return;
        bytes32 id = _id(idSeed);
        uint8 outcome = uint8(bound(outcomeSeed, 1, 4));
        base = uint32(bound(base, 0, 1000));
        uint32 sa = base;
        uint32 sb = base;
        if (outcome == 1) sa = base + 1;
        if (outcome == 2) sb = base + 1;
        uint64 vu = uint64(block.timestamp + 1 hours);
        bytes32 rd = keccak256(abi.encode(id, "rd"));
        (address pa,,,,,,) = escrow.getMatch(id);
        if (pa == address(0)) return;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(refPk, escrow.hashResult(id, outcome, sa, sb, vu, rd));
        try escrow.settle(id, outcome, sa, sb, vu, rd, abi.encodePacked(r, s, v)) {
            settledCount++;
        } catch {}
    }

    function refund(uint256 idSeed) external {
        if (ids.length == 0) return;
        try escrow.refundExpired(_id(idSeed)) {
            refundedCount++;
        } catch {}
    }

    function claim(uint256 actorSeed) external {
        address who = actors[actorSeed % actors.length];
        vm.prank(who);
        try escrow.claim() {
            deferredClaims++;
        } catch {}
    }

    function setBlocked(uint256 actorSeed, bool flag) external {
        usdc.setBlocked(actors[actorSeed % actors.length], flag);
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 6 hours));
    }
}

contract WalletRushEscrowInvariantTest is WalletRushEscrowTestBase {
    WalletRushEscrowHandler internal handler;

    function setUp() public override {
        super.setUp();
        address[] memory actors = new address[](4);
        actors[0] = alice;
        actors[1] = bob;
        actors[2] = carol;
        actors[3] = mallory;
        handler = new WalletRushEscrowHandler(escrow, usdc, referee, refPk, actors);
        targetContract(address(handler));
    }

    /// PROPERTY: escrow USDC balance == 10 USDC per deposit in unfinalized matches + all deferred claimables.
    function invariant_EscrowBalanceEqualsLiveDepositsPlusClaimable() public view {
        uint256 expected;
        for (uint256 i; i < handler.idCount(); ++i) {
            (,,,, bool dA, bool dB, bool fin) = escrow.getMatch(handler.ids(i));
            if (!fin) {
                if (dA) expected += STAKE;
                if (dB) expected += STAKE;
            }
        }
        for (uint256 i; i < handler.actorCount(); ++i) {
            expected += escrow.claimable(handler.actors(i));
        }
        assertEq(usdc.balanceOf(address(escrow)), expected);
    }

    /// PROPERTY: tokens are conserved among players and escrow.
    function invariant_TotalFundsConserved() public view {
        uint256 total = usdc.balanceOf(address(escrow));
        for (uint256 i; i < handler.actorCount(); ++i) {
            total += usdc.balanceOf(handler.actors(i));
        }
        assertEq(total, 4 * START_BAL);
    }
}
