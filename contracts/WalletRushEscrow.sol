// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title WalletRushEscrow
 * @notice Two-player, fixed-stake USDC escrow for Wallet Rush on Arc Testnet (5042002).
 * @dev The immutable referee key is the sole trust root for replay outcomes; replay
 * verification takes place off-chain. Only the two recorded players can receive
 * escrowed funds. There is no owner, admin withdrawal, upgrade or pause path.
 * Assumes the official USDC implementation preserves balances on ordinary transfers.
 * Known limitation: USDC blocklisting of a recipient defers that player's payout
 * without blocking the counterparty's payout. Deferred funds remain claimable only
 * by that player once transfers succeed. There is no administrative bypass or
 * alternate payout recipient. Unsolicited token transfers cannot be recovered.
 *
 * Residual risk: if the issuer blocklists the escrow contract address itself, all
 * payouts and claims freeze because custody is shared and the contract is immutable.
 * No admin rescue exists by design.
 *
 * EIP-712 integration:
 * Domain: EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)
 * name = "Wallet Rush Escrow", version = "1", chainId = the current chain ID
 * (5042002 on Arc Testnet), verifyingContract = this deployed escrow address.
 * Type: Result(bytes32 matchId,address playerA,address playerB,uint8 outcome,uint32 scoreA,uint32 scoreB,uint64 validUntil,bytes32 replayDigest)
 * Participants are always read from the opened match. Sign the typed-data digest,
 * not an eth_sign/personal_sign prefixed message. Only ECDSA signatures are accepted,
 * not ERC-1271 contract signatures. Finalization permanently consumes the match ID.
 */
contract WalletRushEscrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    uint256 public constant STAKE = 10_000_000;
    bytes32 public constant RESULT_TYPEHASH = keccak256(
        "Result(bytes32 matchId,address playerA,address playerB,uint8 outcome,uint32 scoreA,uint32 scoreB,uint64 validUntil,bytes32 replayDigest)"
    );

    address public immutable REFEREE;

    // Two storage slots: address + uint64 + three bools, then address + uint64.
    // A nonzero playerA permanently marks an existing match, including after finalization.
    struct Match {
        address playerA;
        uint64 depositDeadline;
        bool depositedA;
        bool depositedB;
        bool finalized;
        address playerB;
        uint64 refundAfter;
    }

    mapping(bytes32 matchId => Match) private _matches;
    mapping(address player => uint256 amount) public claimable;

    error ZeroReferee();
    error UnauthorizedReferee();
    error InvalidMatchId();
    error MatchAlreadyExists();
    error InvalidPlayers();
    error InvalidDepositDeadline();
    error InvalidRefundAfter();
    error MatchNotFound();
    error MatchFinalized();
    error NotPlayer();
    error AlreadyDeposited();
    error DepositWindowClosed();
    error IncorrectDepositAmount(uint256 expected, uint256 received);
    error MissingDeposits();
    error SettlementWindowClosed();
    error ResultExpired();
    error InvalidReplayDigest();
    error InvalidOutcome(uint8 outcome);
    error InvalidScores(uint8 outcome, uint32 scoreA, uint32 scoreB);
    error InvalidSignature();
    error RefundNotAvailable();
    error NothingToClaim();

    event MatchOpened(
        bytes32 indexed matchId,
        address indexed playerA,
        address indexed playerB,
        uint64 depositDeadline,
        uint64 refundAfter
    );
    event Deposited(bytes32 indexed matchId, address indexed player, uint256 amount);
    event Settled(bytes32 indexed matchId, uint8 outcome, bytes32 replayDigest);
    event Refunded(bytes32 indexed matchId, address indexed player, uint256 amount);
    event PayoutDeferred(bytes32 indexed matchId, address indexed player, uint256 amount);
    event Claimed(address indexed player, uint256 amount);

    constructor(address referee) EIP712("Wallet Rush Escrow", "1") {
        if (referee == address(0)) revert ZeroReferee();
        REFEREE = referee;
    }

    /// @notice Permanently registers participants and deadlines for a fresh match ID.
    function openMatch(
        bytes32 matchId,
        address playerA,
        address playerB,
        uint64 depositDeadline,
        uint64 refundAfter
    ) external {
        if (msg.sender != REFEREE) revert UnauthorizedReferee();
        if (matchId == bytes32(0)) revert InvalidMatchId();
        if (_matches[matchId].playerA != address(0)) revert MatchAlreadyExists();
        if (playerA == address(0) || playerB == address(0) || playerA == playerB) {
            revert InvalidPlayers();
        }
        if (depositDeadline <= block.timestamp) revert InvalidDepositDeadline();
        if (refundAfter <= depositDeadline) revert InvalidRefundAfter();

        _matches[matchId] = Match({
            playerA: playerA,
            depositDeadline: depositDeadline,
            depositedA: false,
            depositedB: false,
            finalized: false,
            playerB: playerB,
            refundAfter: refundAfter
        });

        emit MatchOpened(matchId, playerA, playerB, depositDeadline, refundAfter);
    }

    /// @notice Deposits exactly 10 USDC once, up to and including the deposit deadline.
    function deposit(bytes32 matchId) external nonReentrant {
        Match storage game = _activeMatch(matchId);
        if (block.timestamp > game.depositDeadline) revert DepositWindowClosed();

        if (msg.sender == game.playerA) {
            if (game.depositedA) revert AlreadyDeposited();
            game.depositedA = true;
        } else if (msg.sender == game.playerB) {
            if (game.depositedB) revert AlreadyDeposited();
            game.depositedB = true;
        } else {
            revert NotPlayer();
        }

        uint256 balanceBefore = USDC.balanceOf(address(this));
        USDC.safeTransferFrom(msg.sender, address(this), STAKE);
        uint256 balanceAfter = USDC.balanceOf(address(this));
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != STAKE) {
            revert IncorrectDepositAmount(STAKE, balanceAfter < balanceBefore ? 0 : balanceAfter - balanceBefore);
        }

        emit Deposited(matchId, msg.sender, STAKE);
    }

    /// @notice Submits a referee-signed result. Outcomes: 1=A, 2=B, 3=tie, 4=cancel.
    function settle(
        bytes32 matchId,
        uint8 outcome,
        uint32 scoreA,
        uint32 scoreB,
        uint64 validUntil,
        bytes32 replayDigest,
        bytes calldata signature
    ) external nonReentrant {
        Match storage game = _activeMatch(matchId);
        if (!game.depositedA || !game.depositedB) revert MissingDeposits();
        if (block.timestamp >= game.refundAfter) revert SettlementWindowClosed();
        if (block.timestamp > validUntil) revert ResultExpired();
        if (replayDigest == bytes32(0)) revert InvalidReplayDigest();
        if (outcome < 1 || outcome > 4) revert InvalidOutcome(outcome);
        if (
            (outcome == 1 && scoreA <= scoreB)
                || (outcome == 2 && scoreB <= scoreA)
                || (outcome == 3 && scoreA != scoreB)
        ) revert InvalidScores(outcome, scoreA, scoreB);

        (address signer, ECDSA.RecoverError recoveryError,) = ECDSA.tryRecover(
            hashResult(matchId, outcome, scoreA, scoreB, validUntil, replayDigest), signature
        );
        if (recoveryError != ECDSA.RecoverError.NoError || signer != REFEREE) {
            revert InvalidSignature();
        }

        game.finalized = true;
        if (outcome == 1) {
            _payout(matchId, game.playerA, 2 * STAKE);
        } else if (outcome == 2) {
            _payout(matchId, game.playerB, 2 * STAKE);
        } else {
            _payout(matchId, game.playerA, STAKE);
            _payout(matchId, game.playerB, STAKE);
        }

        emit Settled(matchId, outcome, replayDigest);
    }

    /// @notice Refunds an incomplete pool after its deposit deadline, or any pool at timeout.
    function refundExpired(bytes32 matchId) external nonReentrant {
        Match storage game = _activeMatch(matchId);
        bool incompleteExpired = block.timestamp > game.depositDeadline
            && !(game.depositedA && game.depositedB);
        if (!incompleteExpired && block.timestamp < game.refundAfter) {
            revert RefundNotAvailable();
        }

        game.finalized = true;
        if (game.depositedA) {
            _payout(matchId, game.playerA, STAKE);
            emit Refunded(matchId, game.playerA, STAKE);
        }
        if (game.depositedB) {
            _payout(matchId, game.playerB, STAKE);
            emit Refunded(matchId, game.playerB, STAKE);
        }
    }

    /// @notice Claims the caller's deferred payouts, reverting if the transfer still fails.
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        USDC.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    /// @notice Returns match data, or all zeros/false for an unknown match ID.
    function getMatch(bytes32 matchId)
        external
        view
        returns (
            address playerA,
            address playerB,
            uint64 depositDeadline,
            uint64 refundAfter,
            bool depositedA,
            bool depositedB,
            bool finalized
        )
    {
        Match storage game = _matches[matchId];
        return (
            game.playerA,
            game.playerB,
            game.depositDeadline,
            game.refundAfter,
            game.depositedA,
            game.depositedB,
            game.finalized
        );
    }

    /**
     * @notice Returns the EIP-712 Result digest using the stored participants.
     * @dev Reverts for unknown matches. Does not validate result eligibility or
     * signature expiry, so integrations can also hash historical finalized results.
     */
    function hashResult(
        bytes32 matchId,
        uint8 outcome,
        uint32 scoreA,
        uint32 scoreB,
        uint64 validUntil,
        bytes32 replayDigest
    ) public view returns (bytes32) {
        Match storage game = _matches[matchId];
        if (game.playerA == address(0)) revert MatchNotFound();
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RESULT_TYPEHASH,
                    matchId,
                    game.playerA,
                    game.playerB,
                    outcome,
                    scoreA,
                    scoreB,
                    validUntil,
                    replayDigest
                )
            )
        );
    }

    function _payout(bytes32 matchId, address player, uint256 amount) private {
        if (!USDC.trySafeTransfer(player, amount)) {
            claimable[player] += amount;
            emit PayoutDeferred(matchId, player, amount);
        }
    }

    function _activeMatch(bytes32 matchId) private view returns (Match storage game) {
        game = _matches[matchId];
        if (game.playerA == address(0)) revert MatchNotFound();
        if (game.finalized) revert MatchFinalized();
    }
}
