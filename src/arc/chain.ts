import { defineChain, keccak256, parseAbi, stringToHex, type Hex } from 'viem'

export const ARC_TESTNET = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'Test USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
  blockExplorers: { default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' } },
  testnet: true,
})

// Arc pays gas in 18-decimal native units. The ERC-20 interface takes six-decimal amounts.
export const ARC_USDC = '0x3600000000000000000000000000000000000000'
export const USDC_DECIMALS = 6
export const ENTRY_AMOUNT = 10_000_000n

export const ESCROW_ABI = parseAbi([
  'function openMatch(bytes32 matchId, address playerA, address playerB, uint64 depositDeadline, uint64 refundAfter)',
  'function deposit(bytes32 matchId)',
  'function settle(bytes32 matchId, uint8 outcome, uint32 scoreA, uint32 scoreB, uint64 validUntil, bytes32 replayDigest, bytes signature)',
  'function refundExpired(bytes32 matchId)',
  'function getMatch(bytes32 matchId) view returns (address playerA, address playerB, uint64 depositDeadline, uint64 refundAfter, bool depositedA, bool depositedB, bool finalized)',
  'event Settled(bytes32 indexed matchId, uint8 outcome, bytes32 replayDigest)',
])

export function arcTxUrl(hash: Hex) {
  return `${ARC_TESTNET.blockExplorers.default.url}/tx/${hash}`
}

export function matchKeyFor(matchId: string) {
  return keccak256(stringToHex(matchId))
}
