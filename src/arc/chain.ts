import { defineChain, isAddressEqual, keccak256, parseAbi, parseEventLogs, parseUnits, stringToHex, type Address, type Hex, type Log } from 'viem'

export const ARC_TESTNET = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'Test USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Testnet Explorer', url: 'https://explorer.testnet.arc.io' } },
  testnet: true,
})

// Arc pays gas in 18-decimal native units. The ERC-20 interface takes six-decimal amounts.
export const ARC_USDC = '0x3600000000000000000000000000000000000000'
export const USDC_DECIMALS = 6
export const ENTRY_AMOUNT = 10_000_000n
export const MIN_STAKE_UNITS = 1_000_000
export const MAX_STAKE_UNITS = 100_000_000
export type EscrowVersion = '1' | '2'

export function validStakeUnits(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_STAKE_UNITS && value <= MAX_STAKE_UNITS
}

export function validStakeOffer(value: unknown, variable?: boolean): value is number {
  return value === 0 || (variable ? validStakeUnits(value) : value === Number(ENTRY_AMOUNT))
}

export function parseStakeOffer(value: string) {
  return /^\d{1,3}(?:\.\d{1,6})?$/.test(value) ? Number(parseUnits(value, USDC_DECIMALS)) : undefined
}

export const MATCHED_STAKE_ABI = parseAbi([
  'function openMatch(bytes32 matchId, address playerA, address playerB, uint64 depositDeadline, uint64 refundAfter, uint32 stake)',
  'function getStake(bytes32 matchId) view returns (uint32)',
])

export const ESCROW_ABI = parseAbi([
  'function REFEREE() view returns (address)',
  'function USDC() view returns (address)',
  'function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)',
  'function openMatch(bytes32 matchId, address playerA, address playerB, uint64 depositDeadline, uint64 refundAfter)',
  'function deposit(bytes32 matchId)',
  'function settle(bytes32 matchId, uint8 outcome, uint32 scoreA, uint32 scoreB, uint64 validUntil, bytes32 replayDigest, bytes signature)',
  'function refundExpired(bytes32 matchId)',
  'function claim()',
  'function claimable(address player) view returns (uint256)',
  'function getMatch(bytes32 matchId) view returns (address playerA, address playerB, uint64 depositDeadline, uint64 refundAfter, bool depositedA, bool depositedB, bool finalized)',
  'event Deposited(bytes32 indexed matchId, address indexed player, uint256 amount)',
  'event Refunded(bytes32 indexed matchId, address indexed player, uint256 amount)',
  'event Settled(bytes32 indexed matchId, uint8 outcome, bytes32 replayDigest)',
  'event PayoutDeferred(bytes32 indexed matchId, address indexed player, uint256 amount)',
  'event Claimed(address indexed player, uint256 amount)',
])

export type DeferredPayout = { player: Address; amount: string }

export function readDeferredPayouts(logs: Log[], escrow: Address, matchKey: Hex): DeferredPayout[] {
  return parseEventLogs({ abi: ESCROW_ABI, eventName: 'PayoutDeferred',
    logs: logs.filter(log => isAddressEqual(log.address, escrow)),
  }).filter(event => event.args.matchId === matchKey).map(event => ({
    player: event.args.player,
    amount: event.args.amount.toString(),
  }))
}

export function arcTxUrl(hash: Hex) {
  return `${ARC_TESTNET.blockExplorers.default.url}/tx/${hash}`
}

export function matchKeyFor(matchId: string) {
  return keccak256(stringToHex(matchId))
}
