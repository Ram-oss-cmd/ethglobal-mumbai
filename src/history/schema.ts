import { addr, bytes, defineSchema, i32, str, u64 } from '@arkiv-network/sdk/schema'
import type { MatchRecord } from '../competition/protocol.ts'

export const Matches = defineSchema('wallet-rush.matches.v1', {
  matchId: str().indexed(),
  playerA: addr().indexed(),
  playerB: addr().indexed(),
  engineVersion: str(),
  seed: u64(),
  bankedA: i32(),
  bankedB: i32(),
  result: str().indexed(),
  settlementTx: str().optional(),
  publishedAt: u64(),
  replay: bytes(),
})

export function resultLabel(result: MatchRecord['result']) {
  return result.kind === 'win' ? (result.winner === 0 ? 'win-a' : 'win-b') : result.kind
}
