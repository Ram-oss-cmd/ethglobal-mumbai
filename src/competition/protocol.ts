import type { Direction, GameState } from '../game/index.ts'

export const ENGINE_VERSION = 'wallet-rush-4'
export const MATCH_SOCKET_PATH = '/ws'
export type Seat = 0 | 1
export type RunView = Pick<GameState,
  'elapsedMs' | 'lives' | 'status' | 'carried' | 'banked' | 'player' | 'ghosts' |
  'dots' | 'pellets' | 'frightenedUntilMs' | 'invulnerableUntilMs' | 'respawnAtMs' | 'ghostPauseUntilMs'>

export type ClientMessage =
  | { type: 'join'; matchId: string; resumeToken?: string; prizeToken?: string }
  | { type: 'ready' }
  | { type: 'input'; direction: Direction }

export type Outcome = 'win' | 'loss' | 'draw' | 'canceled'
export type MatchResult =
  | { kind: 'win'; winner: Seat; reason: 'banked' | 'full-clear' }
  | { kind: 'draw'; reason: 'banked' | 'full-clear' }
  | { kind: 'canceled'; reason: 'disconnect'; refundEligible: true }

export interface RunRecord {
  matchId: string
  playerId: string
  seed: number
  alternateLayout: boolean
  engineVersion: typeof ENGINE_VERSION
  ticks: number
  inputs: { tick: number; direction: Direction }[]
  banking: { tick: number; banked: number }[]
  deaths: { tick: number; lives: number }[]
  finalBanked: number
  status: GameState['status']
  outcome: Outcome
  digest: string
}

export interface MatchRecord {
  matchId: string
  result: MatchResult
  runs: [RunRecord, RunRecord]
}

export interface PrizeState {
  stage: 'waiting' | 'opening' | 'funding' | 'settling' | 'settled' | 'error'
  matchKey?: `0x${string}`
  openTx?: `0x${string}`
  settlementTx?: `0x${string}`
  depositDeadline?: number
  refundAfter?: number
  historyKey?: string
  archiveTx?: `0x${string}`
  message?: string
}

export type ServerMessage =
  | { type: 'joined'; matchId: string; seat: Seat; resumeToken: string }
  | { type: 'state'; phase: 'lobby' | 'running' | 'paused' | 'finished'; tick: number;
      seats: [PlayerView | null, PlayerView | null]; reconnectBy?: number; result?: MatchResult; prize?: PrizeState }
  | { type: 'record'; record: MatchRecord }
  | { type: 'error'; message: string; fatal?: boolean }

export interface PlayerView {
  playerId: string
  connected: boolean
  ready: boolean
  run: RunView | null
}
