// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {WalletRushEscrow} from "../WalletRushEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Shared fixtures/helpers. Contains NO test functions.
abstract contract WalletRushEscrowTestBase is Test {
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;
    uint256 internal constant STAKE = 10_000_000;
    uint256 internal constant START_BAL = 1_000e6;
    uint64 internal constant DEP = 1 hours;
    uint64 internal constant REF = 1 days;

    bytes32 internal constant ID = keccak256("match-1");
    bytes32 internal constant ID2 = keccak256("match-2");
    bytes32 internal constant ID3 = keccak256("match-3");
    bytes32 internal constant RD = keccak256("replay");

    WalletRushEscrow internal escrow;
    MockUSDC internal usdc;

    address internal referee;
    uint256 internal refPk;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal mallory = makeAddr("mallory");

    uint64 internal t0;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        t0 = uint64(block.timestamp);
        (referee, refPk) = makeAddrAndKey("referee");

        // Install mock token runtime code at the hardcoded USDC address (storage starts empty).
        MockUSDC impl = new MockUSDC();
        vm.etch(USDC_ADDR, address(impl).code);
        usdc = MockUSDC(USDC_ADDR);

        escrow = new WalletRushEscrow(referee);

        address[4] memory ps = [alice, bob, carol, mallory];
        for (uint256 i; i < ps.length; ++i) {
            usdc.mint(ps[i], START_BAL);
            vm.prank(ps[i]);
            usdc.approve(address(escrow), type(uint256).max);
        }
    }

    // ---------------------------------------------------------------- match helpers

    function _open(bytes32 id, address a, address b) internal {
        vm.prank(referee);
        escrow.openMatch(id, a, b, t0 + DEP, t0 + REF);
    }

    function _deposit(bytes32 id, address who) internal {
        vm.prank(who);
        escrow.deposit(id);
    }

    /// @dev Opens `id` for (alice, bob) and has both deposit.
    function _funded(bytes32 id) internal {
        _open(id, alice, bob);
        _deposit(id, alice);
        _deposit(id, bob);
    }

    // ---------------------------------------------------------------- signing helpers

    function _vu() internal view returns (uint64) {
        return uint64(block.timestamp + 1 hours);
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _refSig(bytes32 id, uint8 outcome, uint32 sa, uint32 sb, uint64 vu, bytes32 rd)
        internal
        view
        returns (bytes memory)
    {
        return _sign(refPk, escrow.hashResult(id, outcome, sa, sb, vu, rd));
    }

    /// @dev Referee-signs and submits a settlement (from carol) with validUntil = now + 1h and RD.
    function _settle(bytes32 id, uint8 outcome, uint32 sa, uint32 sb) internal {
        uint64 vu = _vu();
        bytes memory sig = _refSig(id, outcome, sa, sb, vu, RD);
        vm.prank(carol);
        escrow.settle(id, outcome, sa, sb, vu, RD, sig);
    }

    /// @dev Independent EIP-712 digest computed from the published spec (not via the contract).
    function _independentDigest(
        bytes32 id,
        address pa,
        address pb,
        uint8 outcome,
        uint32 sa,
        uint32 sb,
        uint64 vu,
        bytes32 rd
    ) internal view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Wallet Rush Escrow")),
                keccak256(bytes("1")),
                block.chainid,
                address(escrow)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Result(bytes32 matchId,address playerA,address playerB,uint8 outcome,uint32 scoreA,uint32 scoreB,uint64 validUntil,bytes32 replayDigest)"
                ),
                id,
                pa,
                pb,
                outcome,
                sa,
                sb,
                vu,
                rd
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _finalized(bytes32 id) internal view returns (bool f) {
        (,,,,,, f) = escrow.getMatch(id);
    }

    function _bal(address a) internal view returns (uint256) {
        return usdc.balanceOf(a);
    }
}
